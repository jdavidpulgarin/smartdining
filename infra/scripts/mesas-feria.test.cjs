// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
//
// Prueba mesas-feria.sh con un "docker" falso:
// - `exec -T redis ...` responde las llaves de FALSO_ALIAS (o falla con FALSO_REDIS_FALLA=1);
// - `exec -T postgres ...` anota el SQL en FALSO_SQL o, si hay SD_PG_URL, lo
//   corre de verdad con psql en un esquema propio de la prueba.
// Las pruebas con PostgreSQL real se omiten sin SD_PG_URL (en el CI corren:
// el job infra levanta un postgres). En local, por ejemplo:
//   SD_PG_URL=postgresql://usuario:clave@localhost:5432/postgres node --test infra/scripts/mesas-feria.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'mesas-feria.sh');
const PG = process.env.SD_PG_URL;
const PSQL = process.env.SD_PSQL || 'psql';

const DOCKER_FALSO = `#!/bin/sh
printf '%s\\n' "$*" >> "$FALSO_ARGS"
case "$*" in
  *" exec -T redis "*)
    [ -z "\${FALSO_REDIS_FALLA:-}" ] || { echo "Error: redis no responde" >&2; exit 1; }
    for k in \${FALSO_ALIAS:-}; do echo "$k"; done ;;
  *" exec -T postgres "*)
    if [ -n "\${SD_PG_URL:-}" ]; then
      # La URL al final (-d): el psql de Windows ignora las opciones que van después de ella.
      exec "\${SD_PSQL:-psql}" -X -q -v ON_ERROR_STOP=1 -d "$SD_PG_URL"
    fi
    cat >> "$FALSO_SQL"; printf -- '---\\n' >> "$FALSO_SQL" ;;
esac
`;

function correr(args, extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-mesas-'));
  const docker = path.join(raiz, 'docker');
  fs.writeFileSync(docker, DOCKER_FALSO, { mode: 0o755 });
  const sql = path.join(raiz, 'sql.txt');
  const argsArchivo = path.join(raiz, 'args.txt');
  fs.writeFileSync(sql, '');
  fs.writeFileSync(argsArchivo, '');
  const env = {
    ...process.env, DOCKER: docker, FALSO_SQL: sql, FALSO_ARGS: argsArchivo, ...extra,
  };
  if (!('SD_PG_URL' in extra)) delete env.SD_PG_URL;
  const r = spawnSync('sh', [SCRIPT, ...args], { env, encoding: 'utf8' });
  const leer = (f) => fs.readFileSync(f, 'utf8');
  return { ...r, sql: leer(sql), args: leer(argsArchivo) };
}

// ---------------------------------------------------------------- sin base

test('ver: solo consulta (sin INSERT, UPDATE ni BEGIN), mesas 1..15 y alias de Redis', () => {
  const r = correr(['ver'], { FALSO_ALIAS: 'sd:mesa:4:alias sd:mesa:12:alias sd:mesa:x:alias otra:llave' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /generate_series\(1, 15\)/);
  assert.match(r.sql, /ARRAY\[2, 4, 4, 6, 8\]/);
  assert.match(r.sql, /'\{4,12\}'::int\[\]/, 'solo las llaves sd:mesa:<número>:alias');
  assert.doesNotMatch(r.sql, /INSERT|UPDATE|BEGIN/);
  assert.match(r.args, /--env-file infra\/\.env exec -T redis/);
  assert.match(r.args, /--env-file infra\/\.env exec -T postgres/);
});

test('aplicar: una transacción con LOCK; nunca baja capacidades ni libera una mesa con sesión real', () => {
  const r = correr(['aplicar']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /BEGIN;\s*LOCK TABLE mesas IN SHARE ROW EXCLUSIVE MODE;[\s\S]*INSERT INTO mesas[\s\S]*COMMIT;/);
  assert.match(r.sql, /GREATEST\(COALESCE\(m\.capacidad, 0\), o\.capacidad\)/);
  assert.match(r.sql, /p\.capacidad_final > p\.capacidad_actual/);
  assert.match(r.sql, /p\.pedidos_abiertos = 0 AND NOT p\.alias_reservados/);
  assert.match(r.sql, /'\{\}'::int\[\]/, 'sin alias: arreglo vacío');
  assert.doesNotMatch(r.sql, /DELETE/);
});

test('Redis no responde: sale con 1 sin tocar la base', () => {
  const r = correr(['aplicar'], { FALSO_REDIS_FALLA: '1' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No pude leer los alias reservados de Redis/);
  assert.strictEqual(r.sql, '');
  assert.doesNotMatch(r.args, /exec -T postgres/);
});

test('FERIA_MESAS inválido: sale con 2 sin llamar a docker; vacío usa 15', () => {
  for (const valor of ['0', '51', '-1', '8.5', 'quince', '6; DROP TABLE mesas']) {
    const r = correr(['aplicar'], { FERIA_MESAS: valor });
    assert.strictEqual(r.status, 2, valor);
    assert.match(r.stderr, /FERIA_MESAS/);
    assert.strictEqual(r.args, '', `${valor}: no debe llamar a docker`);
  }
  const r = correr(['ver'], { FERIA_MESAS: '' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /generate_series\(1, 15\)/);
});

test('ENV_FILE elige staging', () => {
  const r = correr(['ver'], { ENV_FILE: 'infra/.env.staging' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.args, /--env-file infra\/\.env\.staging exec -T redis/);
});

test('sin modo o con un modo desconocido: uso y sale con 2', () => {
  for (const args of [[], ['borrar']]) {
    const r = correr(args);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /Uso:/);
    assert.strictEqual(r.args, '');
  }
});

// ------------------------------------------------- con PostgreSQL real

const sinPg = PG ? false : 'sin SD_PG_URL (en el CI corre contra un postgres real)';

/** Corre SQL en el esquema de la prueba y devuelve las filas (tuplas, sin alinear). */
function sqlEn(esquema, consulta) {
  // El SQL por stdin y no con -c: en Windows los argumentos pierden las tildes
  // (pasan por la página de códigos) y la URL va al final con -d.
  const r = spawnSync(PSQL, ['-X', '-q', '-tA', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', PG], {
    input: consulta,
    env: { ...process.env, PGOPTIONS: `-c search_path=${esquema}`, PGCLIENTENCODING: 'UTF8' },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.replace(/\r\n/g, '\n').trim();
}

/**
 * Esquema mínimo con las columnas y CHECK que usa el script (database/schema.sql):
 *   1  cap 2, disponible                       → sin cambio (ya es 2)
 *   2  cap 8, disponible                       → capacidad MAYOR ya existente: se queda en 8
 *   3  cap 4, ocupada, token falso, sin nada   → disponible, token NULL (la mesa 3 del seed)
 *   4  cap 2, ocupada, pedido 'entregado'      → sesión REAL: no se toca (pero sube a 6)
 *   5  cap 8, ocupada, alias en Redis          → sesión REAL: no se toca
 *   6  cap 4, ocupada, pedidos pagado/cancelado → disponible (nada abierto)
 *   7  cap 8, ocupada, sesión nueva y un pedido abierto de la visita ANTERIOR → disponible
 *   8  cap 4, mantenimiento                    → no se toca
 *   9..15 no existen                           → se crean con el ciclo (9 → 6, 10 → 8, 11 → 2...)
 *
 * La limpieza se registra JUSTO después de crear el esquema: si algo de lo que
 * sigue falla, el esquema no queda suelto en la base.
 */
function prepararBase(t) {
  const esquema = `prueba_mesas_${process.pid}_${Date.now()}`;
  sqlEn('public', `CREATE SCHEMA ${esquema}`);
  t.after(() => sqlEn('public', `DROP SCHEMA ${esquema} CASCADE`));
  sqlEn(esquema, `
    CREATE TABLE mesas (
      id_mesa SERIAL PRIMARY KEY,
      numero INTEGER NOT NULL UNIQUE CHECK (numero > 0),
      capacidad INTEGER NOT NULL DEFAULT 4 CHECK (capacidad > 0),
      ubicacion VARCHAR(50) NOT NULL DEFAULT 'Principal',
      estado VARCHAR(20) NOT NULL DEFAULT 'disponible'
        CHECK (estado IN ('disponible', 'ocupada', 'reservada', 'mantenimiento')),
      token_qr VARCHAR(255) UNIQUE,
      sesion_iniciada_en TIMESTAMPTZ);
    CREATE TABLE pedidos (
      id_pedido SERIAL PRIMARY KEY,
      id_mesa INTEGER NOT NULL REFERENCES mesas(id_mesa),
      estado VARCHAR(20) NOT NULL,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now());
    INSERT INTO mesas (id_mesa, numero, capacidad, ubicacion, estado, token_qr, sesion_iniciada_en) VALUES
      (101, 1, 2, 'Terraza', 'disponible', NULL, NULL),
      (102, 2, 8, 'Terraza', 'disponible', NULL, NULL),
      (103, 3, 4, 'Salón', 'ocupada', 'qr-token-mesa-03-i9j0k1l2', NULL),
      (104, 4, 2, 'Salón', 'ocupada', 'v1.real-4', now() - interval '1 hour'),
      (105, 5, 8, 'VIP', 'ocupada', 'v1.real-5', now() - interval '10 minutes'),
      (106, 6, 4, 'Salón', 'ocupada', 'v1.viejo-6', now() - interval '3 hours'),
      (107, 7, 8, 'Salón', 'ocupada', 'v1.viejo-7', now() - interval '5 minutes'),
      (108, 8, 4, 'Bodega', 'mantenimiento', NULL, NULL);
    SELECT setval('mesas_id_mesa_seq', 200);
    INSERT INTO pedidos (id_mesa, estado, creado_en) VALUES
      (104, 'entregado', now() - interval '30 minutes'),
      (106, 'pagado', now() - interval '2 hours'),
      (106, 'cancelado', now() - interval '2 hours'),
      (107, 'entregado', now() - interval '1 day');`);
  return esquema;
}

const foto = (esquema) => sqlEn(esquema,
  "SELECT numero, capacidad, estado, COALESCE(token_qr, 'NULL'), ubicacion FROM mesas ORDER BY numero");

const conBase = (esquema, args, extra = {}) => correr(args, {
  SD_PG_URL: PG, PGOPTIONS: `-c search_path=${esquema}`, PGCLIENTENCODING: 'UTF8', FALSO_ALIAS: 'sd:mesa:105:alias', ...extra,
});

test('PG real · ver no cambia nada y muestra el plan y los avisos', { skip: sinPg }, (t) => {
  const esquema = prepararBase(t);
  const antes = foto(esquema);
  const r = conBase(esquema, ['ver']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(foto(esquema), antes, 'ver no toca la base');
  assert.match(r.stdout, /Mesas con alias reservados \(id_mesa\): 105\./);
  assert.match(r.stdout, /3 \| 4\s+\| ocupada sin sesión → disponible, sin QR/);
  assert.match(r.stdout, /4 \| 2 → 6\s+\| ocupada CON SESIÓN REAL: no se toca \(1 pedido\(s\) abierto\(s\)\)/);
  assert.match(r.stdout, /5 \| 8\s+\| ocupada CON SESIÓN REAL: no se toca \(alias reservados\)/);
  assert.match(r.stdout, /15 \| nueva: 8\s+\| se crea disponible, sin QR/);
  assert.match(r.stdout, /AVISO: la mesa 4 está ocupada con una sesión real \(1 pedido\(s\) abierto\(s\)\): no se tocó/);
  assert.match(r.stdout, /AVISO: la mesa 5 está ocupada con una sesión real \(alias reservados\): no se tocó/);
});

test('PG real · aplicar: ocupada falsa se libera, la real no, la capacidad mayor se queda; idempotente', { skip: sinPg }, (t) => {
  const esquema = prepararBase(t);
  const r = conBase(esquema, ['aplicar']);
  assert.strictEqual(r.status, 0, r.stderr);
  const esperado = [
    '1|2|disponible|NULL|Terraza', //       ya era 2
    '2|8|disponible|NULL|Terraza', //       mayor que 4: no se baja
    '3|4|disponible|NULL|Salón', //         ocupada falsa → disponible, sin token
    '4|6|ocupada|v1.real-4|Salón', //       sesión real (pedido entregado): solo sube la capacidad
    '5|8|ocupada|v1.real-5|VIP', //         sesión real (alias): no se toca
    '6|4|disponible|NULL|Salón', //         solo pedidos pagado/cancelado
    '7|8|disponible|NULL|Salón', //         el abierto es de la visita anterior
    '8|4|mantenimiento|NULL|Bodega', //     no estaba ocupada: no se toca
    // Nuevas, con el ciclo 2, 4, 4, 6, 8 según el número.
    '9|6|disponible|NULL|Feria', '10|8|disponible|NULL|Feria', '11|2|disponible|NULL|Feria',
    '12|4|disponible|NULL|Feria', '13|4|disponible|NULL|Feria', '14|6|disponible|NULL|Feria',
    '15|8|disponible|NULL|Feria',
  ].join('\n');
  assert.strictEqual(foto(esquema), esperado);
  assert.match(r.stdout, /AVISO: la mesa 4 está ocupada con una sesión real/);
  assert.match(r.stdout, /AVISO: la mesa 5 está ocupada con una sesión real/);

  const otra = conBase(esquema, ['aplicar']);
  assert.strictEqual(otra.status, 0, otra.stderr);
  assert.strictEqual(foto(esquema), esperado, 'la segunda vez no cambia nada');
});

test('PG real · si el SQL falla a mitad, no queda nada a medias (transacción)', { skip: sinPg }, (t) => {
  const esquema = prepararBase(t);
  // Un CHECK que hace fallar el último UPDATE (liberar la mesa 3), después del INSERT y de las capacidades.
  sqlEn(esquema, "ALTER TABLE mesas ADD CONSTRAINT sin_liberar CHECK (numero <> 3 OR estado = 'ocupada')");
  const antes = foto(esquema);
  const r = conBase(esquema, ['aplicar']);
  assert.notStrictEqual(r.status, 0, 'debe fallar');
  assert.strictEqual(foto(esquema), antes, 'ni las mesas nuevas ni las capacidades quedaron');
});
