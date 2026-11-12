// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// Prueba mesas-feria.sh con un "docker" falso que guarda el SQL que recibe.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'mesas-feria.sh');

// Doble de docker: anota los argumentos y añade el SQL (stdin) a FALSO_SQL.
const DOCKER_FALSO = `#!/bin/sh
printf '%s\\n' "$*" >> "$FALSO_ARGS"
cat >> "$FALSO_SQL"
printf -- '---\\n' >> "$FALSO_SQL"
`;

function correr(args, extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-mesas-'));
  const docker = path.join(raiz, 'docker');
  fs.writeFileSync(docker, DOCKER_FALSO, { mode: 0o755 });
  const sql = path.join(raiz, 'sql.txt');
  const argsArchivo = path.join(raiz, 'args.txt');
  fs.writeFileSync(sql, '');
  fs.writeFileSync(argsArchivo, '');
  const r = spawnSync('sh', [SCRIPT, ...args], {
    env: {
      ...process.env, DOCKER: docker, FALSO_SQL: sql, FALSO_ARGS: argsArchivo, ...extra,
    },
    encoding: 'utf8',
  });
  const leer = (f) => fs.readFileSync(f, 'utf8');
  return { ...r, sql: leer(sql), args: leer(argsArchivo) };
}

test('ver: solo consulta el plan (sin INSERT ni UPDATE), mesas 1..6 y capacidad 8 por defecto', () => {
  const r = correr(['ver']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /generate_series\(1, 6\)/);
  assert.match(r.sql, /m\.capacidad < 8/);
  assert.doesNotMatch(r.sql, /INSERT|UPDATE|BEGIN/);
  assert.match(r.args, /compose -f docker-compose\.prod\.yml --env-file infra\/\.env exec -T postgres/);
});

test('aplicar: crea las que faltan y SOLO sube la capacidad, en una transacción', () => {
  const r = correr(['aplicar']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /BEGIN;[\s\S]*INSERT INTO mesas \(numero, capacidad, ubicacion, estado\)[\s\S]*COMMIT;/);
  assert.match(r.sql, /WHERE NOT EXISTS \(SELECT 1 FROM mesas m WHERE m\.numero = n\)/);
  assert.match(r.sql, /UPDATE mesas SET capacidad = 8\s+WHERE numero BETWEEN 1 AND 6 AND capacidad < 8;/);
  assert.doesNotMatch(r.sql, /SET estado|DELETE|capacidad > /, 'no toca el estado ni baja capacidades');
});

test('ENV_FILE, FERIA_MESAS y FERIA_CAPACIDAD cambian el destino y los números', () => {
  const r = correr(['aplicar'], { ENV_FILE: 'infra/.env.staging', FERIA_MESAS: '8', FERIA_CAPACIDAD: '10' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.args, /--env-file infra\/\.env\.staging/);
  assert.match(r.sql, /generate_series\(1, 8\)/);
  assert.match(r.sql, /UPDATE mesas SET capacidad = 10\s+WHERE numero BETWEEN 1 AND 8 AND capacidad < 10;/);
});

test('números inválidos: sale con 2 sin llamar a docker (nada de SQL inyectado)', () => {
  for (const [variable, valor] of [
    ['FERIA_MESAS', '0'], ['FERIA_MESAS', '51'], ['FERIA_MESAS', '6; DROP TABLE mesas'],
    ['FERIA_CAPACIDAD', 'ocho'], ['FERIA_CAPACIDAD', '-1'], ['FERIA_CAPACIDAD', '8.5'], ['FERIA_CAPACIDAD', '100'],
  ]) {
    const r = correr(['aplicar'], { [variable]: valor });
    assert.strictEqual(r.status, 2, `${variable}=${valor}`);
    assert.match(r.stderr, new RegExp(variable));
    assert.strictEqual(r.args, '', `${variable}=${valor}: no debe llamar a docker`);
  }
});

test('sin modo o con un modo desconocido: uso y sale con 2', () => {
  for (const args of [[], ['borrar']]) {
    const r = correr(args);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /Uso:/);
    assert.strictEqual(r.args, '');
  }
});

test('variable vacía: usa el valor por defecto, como el compose', () => {
  const r = correr(['ver'], { FERIA_MESAS: '', FERIA_CAPACIDAD: '' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.sql, /generate_series\(1, 6\)/);
  assert.match(r.sql, /m\.capacidad < 8/);
});
