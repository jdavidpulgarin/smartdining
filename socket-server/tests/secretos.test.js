const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { revisarSecretos, LARGO_MINIMO } = require('../src/secretos');
const { cargarConfig } = require('../src/config');
const { aleatorio, ENV_BASE, ORIGEN } = require('./helpers');

test('una configuración con tres secretos propios, largos y distintos es válida', () => {
  assert.deepStrictEqual(revisarSecretos(ENV_BASE), []);
  const config = cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE });
  assert.strictEqual(config.internalApiKey, ENV_BASE.INTERNAL_API_KEY);
  assert.strictEqual(config.qrSecret, ENV_BASE.QR_SECRET);
});

test('cada secreto es obligatorio, también solo con espacios', () => {
  for (const nombre of ['JWT_SECRET', 'QR_SECRET', 'INTERNAL_API_KEY']) {
    for (const valor of [undefined, '', '   ']) {
      const env = { ...ENV_BASE, [nombre]: valor };
      assert.match(revisarSecretos(env).join('\n'), new RegExp(`${nombre} es obligatoria`));
    }
  }
});

test('se rechazan los valores de ejemplo aunque sean largos', () => {
  const ejemplos = [
    'cambia-esto-por-un-secreto-largo-y-aleatorio',
    'cambia-esto-por-una-clave-interna-larga',
    'CAMBIA-ESTO-por-otro-secreto-largo-de-verdad-1234',
    'dev-key-dev-key-dev-key-dev-key-dev-key',
    'changeme-changeme-changeme-changeme',
  ];
  for (const valor of ejemplos) {
    const problemas = revisarSecretos({ ...ENV_BASE, INTERNAL_API_KEY: valor });
    assert.match(problemas.join('\n'), /INTERNAL_API_KEY todavía tiene un valor de ejemplo/, valor);
  }
});

test(`se rechaza un secreto de menos de ${LARGO_MINIMO} caracteres`, () => {
  const corto = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d'; // 31
  const problemas = revisarSecretos({ ...ENV_BASE, QR_SECRET: corto });
  assert.match(problemas.join('\n'), /QR_SECRET es demasiado corta \(31 caracteres/);
  assert.deepStrictEqual(revisarSecretos({ ...ENV_BASE, QR_SECRET: `${corto}e` }), []);
});

test('dos secretos iguales se rechazan (separación de claves)', () => {
  const repetido = aleatorio();
  const problemas = revisarSecretos({ JWT_SECRET: repetido, QR_SECRET: aleatorio(), INTERNAL_API_KEY: repetido });
  assert.deepStrictEqual(problemas, ['INTERNAL_API_KEY no puede ser igual a JWT_SECRET']);
});

test('los mensajes nunca incluyen el valor del secreto', () => {
  const corto = 'muy-secreto-pero-corto';
  const problemas = revisarSecretos({ ...ENV_BASE, JWT_SECRET: corto });
  assert.ok(problemas.length > 0);
  assert.ok(!problemas.join('\n').includes(corto));
});

test('cargarConfig lanza un único error con todos los problemas', () => {
  assert.throws(
    () => cargarConfig({ CORS_ORIGINS: ORIGEN, JWT_SECRET: 'corto' }),
    (err) => err.codigo === 'SECRETOS_INVALIDOS'
      && /JWT_SECRET es demasiado corta/.test(err.message)
      && /QR_SECRET es obligatoria/.test(err.message)
      && /INTERNAL_API_KEY es obligatoria/.test(err.message)
      && /randomBytes\(32\)/.test(err.message),
  );
});

test('el proceso termina con código 1 y un mensaje claro si los secretos son débiles', () => {
  const raiz = path.join(__dirname, '..');
  // dotenv no pisa variables ya definidas: las de este entorno ganan a un .env local.
  const r = spawnSync(process.execPath, ['server.js'], {
    cwd: raiz,
    env: {
      PATH: process.env.PATH,
      CORS_ORIGINS: ORIGEN,
      JWT_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio',
      QR_SECRET: ENV_BASE.QR_SECRET,
      INTERNAL_API_KEY: 'dev-key',
      PORT: '0',
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.strictEqual(r.status, 1);
  const linea = JSON.parse(r.stderr.trim().split('\n').pop());
  assert.strictEqual(linea.nivel, 'error');
  assert.match(linea.msg, /No se puede iniciar el socket-server/);
  assert.match(r.stderr, /JWT_SECRET todavía tiene un valor de ejemplo/);
  assert.match(r.stderr, /INTERNAL_API_KEY todavía tiene un valor de ejemplo/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, 'sin traza de pila');
  assert.ok(!r.stderr.includes('cambia-esto-por-un-secreto'), 'el log nunca repite el valor de un secreto');
});
