// Modo red local: con NODE_ENV=development (escrito) se aceptan también los
// orígenes http://<IPv4 privada>:5173-5175. En producción o sin NODE_ENV,
// todo sigue igual que antes: solo CORS_ORIGINS.
const test = require('node:test');
const assert = require('node:assert');
const { levantar, ENV_BASE, ORIGEN } = require('./helpers');
const { cargarConfig } = require('../src/config');
const { esOrigenRedLocal, crearOrigenCors } = require('../src/origenes');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };

const ACEPTADOS = [
  'http://192.168.1.22:5173',
  'http://10.0.0.5:5175',
  'http://172.16.0.1:5174',
  'http://172.31.255.255:5173',
];
const RECHAZADOS = [
  'http://172.15.0.1:5173',
  'http://172.32.0.1:5173',
  'http://192.169.1.1:5173',
  'http://8.8.8.8:5173',
  'http://192.168.1.256:5173',
  'http://192.168.1.22:5176',
  'https://192.168.1.22:5173',
  'http://evil.com:5173',
  'http://192.168.1.22.evil.com:5173',
];
// Bordes que la regla exacta también debe cerrar.
const RECHAZADOS_EXTRA = [
  'http://192.168.1.22', // sin puerto
  'http://192.168.1.22:5173/', // con ruta
  'http://192.168.1.22:51730',
  'http://192.168.1.22:05173',
  'HTTP://192.168.1.22:5173',
  'http://192.168.01.22:5173', // octeto con cero a la izquierda
  'http://192.168.1:5173',
  'http://user@192.168.1.22:5173',
  'http://[::1]:5173',
  'http://localhost:5174',
  ' http://192.168.1.22:5173',
  'null',
  '',
  undefined,
];

// ---------------------------------------------------------------------------
// La regla (pura)
// ---------------------------------------------------------------------------

test('regla: acepta http + IPv4 privada + puerto 5173/5174/5175', () => {
  for (const o of ACEPTADOS) assert.strictEqual(esOrigenRedLocal(o), true, o);
});

test('regla: rechaza IP pública o fuera de rango, otro puerto, https y hostnames', () => {
  for (const o of [...RECHAZADOS, ...RECHAZADOS_EXTRA]) assert.strictEqual(esOrigenRedLocal(o), false, String(o));
});

test('regla: los límites de cada rango privado', () => {
  for (const o of ['http://10.255.255.255:5173', 'http://10.0.0.0:5173', 'http://192.168.0.0:5175', 'http://192.168.255.255:5174']) {
    assert.strictEqual(esOrigenRedLocal(o), true, o);
  }
  for (const o of ['http://11.0.0.1:5173', 'http://9.255.255.255:5173', 'http://192.167.255.255:5173', 'http://0.0.0.0:5173', 'http://127.0.0.1:5173']) {
    assert.strictEqual(esOrigenRedLocal(o), false, o);
  }
});

test('crearOrigenCors: fuera de red local devuelve la MISMA lista (comportamiento idéntico)', () => {
  const origenes = [ORIGEN];
  assert.strictEqual(crearOrigenCors({ origenes, redLocal: false }), origenes);
  const fn = crearOrigenCors({ origenes, redLocal: true });
  const resultado = (o) => new Promise((r) => fn(o, (err, ok) => r([err, ok])));
  return Promise.all([
    resultado(ORIGEN).then((r) => assert.deepStrictEqual(r, [null, true])),
    resultado('http://192.168.1.22:5173').then((r) => assert.deepStrictEqual(r, [null, true])),
    resultado('http://8.8.8.8:5173').then((r) => assert.deepStrictEqual(r, [null, false])),
  ]);
});

// ---------------------------------------------------------------------------
// Configuración: solo NODE_ENV=development escrito activa el modo
// ---------------------------------------------------------------------------

test('config: redLocal solo con NODE_ENV=development explícito', () => {
  const base = { CORS_ORIGINS: ORIGEN, ...ENV_BASE };
  assert.strictEqual(cargarConfig({ ...base, NODE_ENV: 'development' }).redLocal, true);
  const sinNodeEnv = cargarConfig(base);
  assert.deepStrictEqual([sinNodeEnv.entorno, sinNodeEnv.redLocal], ['development', false], 'el valor por defecto no lo activa');
  for (const NODE_ENV of ['production', 'test', 'Development', ' development', '']) {
    const extra = NODE_ENV === 'production' ? { REDIS_URL: 'redis://falso:6379' } : {};
    assert.strictEqual(cargarConfig({ ...base, ...extra, NODE_ENV }).redLocal, false, JSON.stringify(NODE_ENV));
  }
});

// ---------------------------------------------------------------------------
// De punta a punta: HTTP (/health y preflight) y handshake de Socket.io
// ---------------------------------------------------------------------------

async function servidorCon(t, entorno) {
  const env = {};
  const deps = {};
  if (entorno) env.NODE_ENV = entorno;
  if (entorno === 'production') {
    // Producción exige Redis: se usa el doble, sin salir a la red.
    env.REDIS_URL = 'redis://falso:6379';
    deps.redis = crearConexionRedis({ url: env.REDIS_URL, crearCliente: crearRedisFalso().crearCliente, log: silencioso });
  }
  const s = await levantar(env, deps);
  t.after(() => s.cerrar());
  const acao = async (url, init) => {
    const r = await fetch(url, init);
    await r.arrayBuffer();
    return { origen: r.headers.get('access-control-allow-origin'), credenciales: r.headers.get('access-control-allow-credentials') };
  };
  return {
    http: (origin) => acao(`${s.url}/health`, { headers: { Origin: origin } }),
    preflight: (origin) => acao(`${s.url}/health`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    }),
    socket: (origin) => acao(`${s.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } }),
  };
}

test('development: HTTP y Socket.io aceptan las IP privadas, reflejando el origen exacto', async (t) => {
  const s = await servidorCon(t, 'development');
  for (const o of [...ACEPTADOS, ORIGEN]) {
    for (const canal of ['http', 'preflight', 'socket']) {
      assert.deepStrictEqual(await s[canal](o), { origen: o, credenciales: 'true' }, `${canal} ${o}`);
    }
  }
});

test('development: HTTP y Socket.io rechazan todo lo que no cumple la regla (sin ACAO, nunca "*")', async (t) => {
  const s = await servidorCon(t, 'development');
  for (const o of RECHAZADOS) {
    for (const canal of ['http', 'preflight', 'socket']) {
      assert.strictEqual((await s[canal](o)).origen, null, `${canal} ${o}`);
    }
  }
});

for (const entorno of ['production', undefined]) {
  const nombre = entorno ? `NODE_ENV=${entorno}` : 'sin NODE_ENV';
  test(`${nombre}: una IP privada se rechaza en HTTP y en Socket.io; CORS_ORIGINS sigue igual`, async (t) => {
    const s = await servidorCon(t, entorno);
    for (const o of ACEPTADOS) {
      for (const canal of ['http', 'preflight', 'socket']) {
        assert.strictEqual((await s[canal](o)).origen, null, `${canal} ${o}`);
      }
    }
    for (const canal of ['http', 'preflight', 'socket']) {
      assert.deepStrictEqual(await s[canal](ORIGEN), { origen: ORIGEN, credenciales: 'true' }, canal);
    }
  });
}
