// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// Prueba respaldo.sh con un "docker" falso: no necesita Docker ni PostgreSQL.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'respaldo.sh');
const POSIX = process.platform !== 'win32';

// Doble de docker. Lo controlan las variables FALSO_*:
//   FALSO_PG_<proyecto con _>  id del postgres en marcha de ese proyecto
//   FALSO_DUMP_FALLA=1         pg_dump sale con error
//   FALSO_DUMP_VACIO=1         pg_dump no escribe nada
//   FALSO_LISTA_FALLA=1        pg_restore --list no puede leerlo
//   FALSO_SIN_MIGRACIONES=1    el TOC no trae schema_migraciones
const DOCKER_FALSO = `#!/bin/sh
case "$1" in
  ps)
    for a in "$@"; do
      case "$a" in
        label=com.docker.compose.project=smartdining) printf '%s' "\${FALSO_PG_smartdining:-}" ;;
        label=com.docker.compose.project=smartdining-staging) printf '%s' "\${FALSO_PG_smartdining_staging:-}" ;;
      esac
    done
    echo ;;
  inspect)
    eval "id=\\$$#"
    case "$id" in
      pg-prod*) echo smartdining ;;
      pg-stg*) echo smartdining-staging ;;
      pg-otro*) echo otra-cosa ;;
      *) echo "Error: No such object: $id" >&2; exit 1 ;;
    esac ;;
  exec)
    case "$*" in
      *pg_dump*)
        [ -z "\${FALSO_DUMP_FALLA:-}" ] || { echo "pg_dump: error: connection refused" >&2; exit 1; }
        [ -n "\${FALSO_DUMP_VACIO:-}" ] || printf 'PGDMP falso\\n' ;;
      *"pg_restore --list"*)
        cat > /dev/null
        [ -z "\${FALSO_LISTA_FALLA:-}" ] || { echo "pg_restore: error: input file does not appear to be a valid archive" >&2; exit 1; }
        echo "; Archive created at 2026-11-11"
        [ -n "\${FALSO_SIN_MIGRACIONES:-}" ] || echo "215; 1259 16385 TABLE public schema_migraciones smartdining" ;;
    esac ;;
esac
`;

function entorno(extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-respaldo-'));
  const bin = path.join(raiz, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'), DOCKER_FALSO, { mode: 0o755 });
  const respaldos = path.join(raiz, 'respaldos');
  fs.mkdirSync(path.join(respaldos, 'smartdining'), { recursive: true });
  fs.mkdirSync(path.join(respaldos, 'smartdining-staging'), { recursive: true });
  const env = {
    ...process.env, DOCKER: path.join(bin, 'docker'), RESPALDOS_DIR: respaldos, ...extra,
  };
  const correr = (...args) => spawnSync('sh', [SCRIPT, ...args], { env, encoding: 'utf8' });
  const archivos = (proyecto, tipo) => {
    const d = path.join(respaldos, proyecto, tipo);
    return fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
  };
  return {
    raiz, respaldos, correr, archivos, env,
  };
}

test('diario: respalda el proyecto que esté corriendo y lo valida', () => {
  const e = entorno({ FALSO_PG_smartdining_staging: 'pg-stg-1' });
  const r = e.correr('diario');
  assert.strictEqual(r.status, 0, r.stderr);
  const a = e.archivos('smartdining-staging', 'diario');
  assert.strictEqual(a.length, 1);
  assert.match(a[0], /^diario-\d{8}-\d{6}\.dump$/);
  assert.match(r.stdout, /smartdining-staging diario ->.*se conservan 7/);
  assert.deepStrictEqual(e.archivos('smartdining', 'diario'), []);
});

test('predeploy: lleva el sha corto en el nombre y el contenedor que pasa el workflow', () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-prod-1' });
  const r = e.correr('predeploy', '95ca756a1b2c3d4e5f60718293a4b5c6d7e8f901');
  assert.strictEqual(r.status, 0, r.stderr);
  const a = e.archivos('smartdining', 'predeploy');
  assert.strictEqual(a.length, 1);
  assert.match(a[0], /^predeploy-\d{8}-\d{6}-95ca756\.dump$/);
});

test('predeploy: sin sha válido no hace nada', () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-prod-1' });
  for (const sha of [[], ['main'], ['95CA756'], ['abc'], ['95ca756; rm -rf /']]) {
    const r = e.correr('predeploy', ...sha);
    assert.strictEqual(r.status, 1, String(sha));
    assert.match(r.stderr, /necesita el sha/);
  }
  assert.deepStrictEqual(e.archivos('smartdining', 'predeploy'), []);
});

test('uso: un tipo desconocido sale con 2', () => {
  const r = entorno().correr('semanal');
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /uso:/);
});

test('falla si no hay postgres, o si corren producción y staging a la vez', () => {
  let r = entorno().correr('diario');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /no hay ningún postgres/);
  r = entorno({ FALSO_PG_smartdining: 'pg-prod-1', FALSO_PG_smartdining_staging: 'pg-stg-1' }).correr('diario');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /están corriendo los postgres de smartdining y de smartdining-staging/);
});

test('falla si el contenedor no es de smartdining ni de staging', () => {
  const r = entorno({ RESPALDO_CONTENEDOR: 'pg-otro-1' }).correr('diario');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /proyecto 'otra-cosa'/);
});

test('proyecto sin carpeta preparada: falla con el comando exacto (desde el clon) y sin dejar nada', () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-prod-1' });
  fs.rmSync(path.join(e.respaldos, 'smartdining'), { recursive: true });
  const r = e.correr('predeploy', '95ca756');
  assert.strictEqual(r.status, 1);
  const raiz = path.resolve(__dirname, '..', '..');
  assert.match(r.stderr, /no existe .*smartdining: no se respaldó nada/);
  assert.ok(r.stderr.includes('sudo sh infra/scripts/instalar-respaldos.sh'), r.stderr);
  // La ruta real del clon desde el que corre (en Git Bash llega como /c/...).
  const rutaSh = raiz.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, l) => `/${l.toLowerCase()}`);
  assert.ok(r.stderr.includes(`cd ${rutaSh} &&`) || r.stderr.includes(`cd ${raiz} &&`), r.stderr);
  assert.ok(!fs.existsSync(path.join(e.respaldos, 'smartdining')), 'no crea la carpeta del proyecto');
});

test('proyecto sin carpeta, corriendo desde la copia instalada (timer): da los dos clones del VPS', () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-stg-1' });
  fs.rmSync(path.join(e.respaldos, 'smartdining-staging'), { recursive: true });
  // Como /usr/local/lib/smartdining/respaldo.sh: fuera de cualquier clon.
  const copia = path.join(e.raiz, 'lib', 'respaldo.sh');
  fs.mkdirSync(path.dirname(copia));
  fs.copyFileSync(SCRIPT, copia);
  const r = spawnSync('sh', [copia, 'diario'], { env: e.env, encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.ok(r.stderr.includes('cd /home/deploy/smartdining && sudo sh infra/scripts/instalar-respaldos.sh'), r.stderr);
  assert.ok(r.stderr.includes('/srv/smartdining-staging'), r.stderr);
});

test('predeploy/ y diario/ se crean solos y heredan setgid y grupo de la carpeta del proyecto', { skip: !POSIX && 'sin permisos POSIX en Windows' }, () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-prod-1' });
  const proyecto = path.join(e.respaldos, 'smartdining');
  fs.chmodSync(proyecto, 0o2750); // como la deja instalar-respaldos.sh
  for (const [tipo, args] of [['predeploy', ['predeploy', '95ca756']], ['diario', ['diario']]]) {
    const r = e.correr(...args);
    assert.strictEqual(r.status, 0, r.stderr);
    const st = fs.statSync(path.join(proyecto, tipo));
    assert.strictEqual(st.mode & 0o7777, 0o2750, `${tipo}: 2750`);
    assert.strictEqual(st.gid, fs.statSync(proyecto).gid, `${tipo}: mismo grupo que el proyecto`);
  }
});

for (const [caso, variable, mensaje] of [
  ['pg_dump falla', 'FALSO_DUMP_FALLA', /pg_dump falló/],
  ['pg_dump no escribe nada', 'FALSO_DUMP_VACIO', /no escribió nada/],
  ['pg_restore no lo puede leer', 'FALSO_LISTA_FALLA', /no puede leer el respaldo/],
  ['no trae schema_migraciones', 'FALSO_SIN_MIGRACIONES', /no trae la tabla schema_migraciones/],
]) {
  test(`si ${caso}: sale con 1 y no deja archivo ni .tmp`, () => {
    const e = entorno({ RESPALDO_CONTENEDOR: 'pg-stg-1', [variable]: '1' });
    const r = e.correr('predeploy', '95ca756');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, mensaje);
    assert.deepStrictEqual(e.archivos('smartdining-staging', 'predeploy'), []);
  });
}

test('rotación: conserva solo los más nuevos de su tipo y no toca lo demás', () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-stg-1', CONSERVAR_DIARIO: '3' });
  const d = path.join(e.respaldos, 'smartdining-staging', 'diario');
  fs.mkdirSync(d, { recursive: true });
  const viejos = ['diario-20260101-033000.dump', 'diario-20260102-033000.dump', 'diario-20260103-033000.dump', 'diario-20260104-033000.dump'];
  for (const v of [...viejos, 'notas.txt', 'predeploy-20260101-000000-1234567.dump']) fs.writeFileSync(path.join(d, v), 'x');
  const r = e.correr('diario');
  assert.strictEqual(r.status, 0, r.stderr);
  const a = e.archivos('smartdining-staging', 'diario');
  const dumps = a.filter((f) => /^diario-/.test(f));
  assert.strictEqual(dumps.length, 3);
  assert.deepStrictEqual(dumps.slice(0, 2), ['diario-20260103-033000.dump', 'diario-20260104-033000.dump']);
  assert.ok(a.includes('notas.txt') && a.includes('predeploy-20260101-000000-1234567.dump'));
});

test('rechaza una cantidad a conservar que no es un entero positivo', () => {
  const r = entorno({ RESPALDO_CONTENEDOR: 'pg-stg-1', CONSERVAR_DIARIO: '0' }).correr('diario');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /entero mayor que 0/);
});

test('permisos: archivo 640 y carpeta 750 (nadie fuera del grupo los lee)', { skip: !POSIX && 'sin permisos POSIX en Windows' }, () => {
  const e = entorno({ RESPALDO_CONTENEDOR: 'pg-stg-1' });
  const r = e.correr('diario');
  assert.strictEqual(r.status, 0, r.stderr);
  const d = path.join(e.respaldos, 'smartdining-staging', 'diario');
  const [f] = e.archivos('smartdining-staging', 'diario');
  assert.strictEqual(fs.statSync(path.join(d, f)).mode & 0o777, 0o640);
  assert.strictEqual(fs.statSync(d).mode & 0o777, 0o750);
});
