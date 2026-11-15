// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// ENTORNO=staging|produccion es obligatorio en los scripts del VPS que antes
// traían fija la ruta de staging. Aquí se prueba la parte que no necesita
// root, Docker ni el VPS: sin ENTORNO, o con otro valor, salen con 2 sin tocar
// nada; y con uno válido, no siguen fuera de su clon (/srv/smartdining o
// /srv/smartdining-staging). respaldo.sh tiene su propia prueba (respaldo.test.cjs).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const INVALIDOS = [null, '', 'prod', 'Staging', 'PRODUCCION', 'produccion ', 'smartdining', 'staging;rm'];
const esRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// Un docker falso que no tiene nada en marcha (para el simulacro).
function dockerVacio() {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-entorno-'));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return path.join(bin, 'docker');
}

function correr(script, valor, args = [], extra = {}) {
  const env = { ...process.env, DOCKER: dockerVacio(), ...extra };
  delete env.ENTORNO;
  delete env.ENV_FILE;
  if (valor !== null) env.ENTORNO = valor;
  return spawnSync('sh', [path.join(dir, script), ...args], { env, encoding: 'utf8' });
}

for (const [script, prefijo] of [
  ['instalar-respaldos.sh', 'instalar-respaldos'],
  ['simulacro-restauracion.sh', 'simulacro'],
  ['primer-certificado.sh', 'primer-certificado'],
]) {
  test(`${script}: sin ENTORNO o con otro valor sale con 2 y dice qué falta`, () => {
    for (const valor of INVALIDOS) {
      const r = correr(script, valor);
      assert.strictEqual(r.status, 2, `${script} ENTORNO=${JSON.stringify(valor)}: ${r.stderr}`);
      assert.match(r.stderr, new RegExp(`${prefijo}: ERROR: ENTORNO debe ser 'staging' o 'produccion'`));
      assert.match(r.stderr, /uso:/);
    }
  });

  test(`${script}: --entorno con un valor inválido o sin valor también sale con 2`, () => {
    for (const args of [['--entorno', 'otro'], ['--entorno']]) {
      const r = correr(script, null, args);
      assert.strictEqual(r.status, 2, `${script} ${args.join(' ')}: ${r.stderr}`);
    }
  });
}

test('primer-certificado.sh: con ENTORNO válido, fuera de su clon no sigue', () => {
  for (const [valor, ruta] of [['staging', '/srv/smartdining-staging'], ['produccion', '/srv/smartdining']]) {
    const r = correr('primer-certificado.sh', valor);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes(`ENTORNO=${valor} se corre desde su clon, ${ruta}`), r.stdout + r.stderr);
  }
  const r = correr('primer-certificado.sh', null, ['--entorno', 'produccion']);
  assert.strictEqual(r.status, 1);
  assert.ok((r.stdout + r.stderr).includes('/srv/smartdining '), r.stdout + r.stderr);
});

test('instalar-respaldos.sh: con ENTORNO válido, sin root pide sudo antes de tocar nada', { skip: esRoot && 'corriendo como root' }, () => {
  for (const valor of ['staging', 'produccion']) {
    const r = correr('instalar-respaldos.sh', valor);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, /córrelo con sudo/);
  }
});

test('simulacro-restauracion.sh: con ENTORNO válido usa el proyecto de ese entorno', () => {
  for (const [valor, proyecto] of [['staging', 'smartdining-staging'], ['produccion', 'smartdining']]) {
    const r = correr('simulacro-restauracion.sh', valor);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, new RegExp(`no hay postgres de ${proyecto} en marcha`));
  }
});
