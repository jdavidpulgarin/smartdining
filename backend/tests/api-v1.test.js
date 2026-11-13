const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const { TABLA, INTERNA } = require('./helpers/catalogo-rutas');
const { montarApi, esCanalInterno } = require('../src/routes/montaje');
const { crearLimitadorGlobal, crearLimitadorLogin } = require('../src/middleware/limites.middleware');
const routes = require('../src/routes');
const app = require('../server');

// D-19 parte A: la API también en /api/v1, con el mismo router y los mismos
// límites. Ver src/routes/montaje.js.

/** Doble de BD que contesta lo justo para las rutas de la muestra. */
function fakeMuestra() {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM categorias ORDER BY')) {
      return { rows: [{ id_categoria: 1, nombre: 'Entradas', orden_visualizacion: 1 }] };
    }
    return { rows: [] };
  });
}

/** Pide lo mismo por /api y por /api/v1 y devuelve las dos respuestas. */
async function porLosDosPrefijos(metodo, ruta, { token, cuerpo } = {}) {
  const pedir = (prefijo) => {
    let r = request(app)[metodo](`${prefijo}${ruta}`);
    if (token) r = r.set('Authorization', `Bearer ${token}`);
    return cuerpo === undefined ? r : r.send(cuerpo);
  };
  return [await pedir('/api'), await pedir('/api/v1')];
}

for (const [caso, metodo, ruta, opciones] of [
  ['health (pública, exenta del límite)', 'get', '/health', {}],
  ['GET /categorias (pública)', 'get', '/categorias', {}],
  ['GET /pedidos/activos (staff: mesero)', 'get', '/pedidos/activos', { token: () => tokenStaff(1, 'mesero') }],
  ['GET /pedidos/mesa (comensal)', 'get', '/pedidos/mesa', { token: () => tokenComensal(5) }],
  ['una ruta que no existe (404)', 'get', '/no-existe', {}],
  ['una ruta protegida sin token (401)', 'get', '/pedidos/activos', {}],
  ['un rol que no toca (403: cocina en /pedidos/activos)', 'get', '/pedidos/activos', { token: () => tokenStaff(1, 'cocina') }],
]) {
  test(`v1: ${caso} responde igual en /api/v1 que en /api`, async () => {
    const db = fakeMuestra();
    try {
      const token = opciones.token ? opciones.token() : undefined;
      const [api, v1] = await porLosDosPrefijos(metodo, ruta, { token });
      assert.strictEqual(v1.status, api.status, `${ruta}: ${api.status} vs ${v1.status}`);
      assert.deepStrictEqual(v1.body, api.body);
    } finally {
      db.restaurar();
    }
  });
}

test('v1: los códigos esperados de la muestra (para que "igual" no sea "igual de roto")', async () => {
  const db = fakeMuestra();
  try {
    assert.strictEqual((await request(app).get('/api/v1/health')).status, 200);
    assert.strictEqual((await request(app).get('/api/v1/categorias')).body.categorias[0].nombre, 'Entradas');
    assert.strictEqual((await request(app).get('/api/v1/no-existe')).status, 404);
    assert.strictEqual((await request(app).get('/api/v1/pedidos/activos')).status, 401);
    const mesero = await request(app).get('/api/v1/pedidos/activos').set('Authorization', `Bearer ${tokenStaff(1, 'mesero')}`);
    assert.strictEqual(mesero.status, 200);
  } finally {
    db.restaurar();
  }
});

test('v1: el canal interno NO está en v1 (404, aun con la clave buena); en /api sigue igual', async () => {
  const socket = instalarFakeSocket();
  const db = fakeMuestra();
  try {
    const internas = [
      ['post', '/transacciones/internal'],
      ['get', '/mesas/5/cuenta/interno'],
      ['post', '/mesas/5/token-qr/interno'],
      ['post', '/pagos/intentos-fallidos/interno'],
    ];
    for (const [metodo, ruta] of internas) {
      const enV1 = await request(app)[metodo](`/api/v1${ruta}`).set('x-internal-key', CLAVE_FALSA).send({});
      assert.strictEqual(enV1.status, 404, `v1${ruta}`);
      assert.deepStrictEqual(enV1.body, { error: 'Ruta no encontrada', motivo: 'no_encontrado' }, 'el 404 de siempre');

      const enApiSinClave = await request(app)[metodo](`/api${ruta}`).send({});
      assert.strictEqual(enApiSinClave.status, 401, `/api${ruta} sigue exigiendo la clave`);
    }
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('v1: monta la MISMA instancia del router agregador que /api (mismos limitadores de login y QR)', () => {
  const capas = app._router.stack.filter((c) => c.handle && Array.isArray(c.handle.stack));
  const deApi = capas.filter((c) => c.handle === routes);
  assert.strictEqual(deApi.length, 1, '/api monta el agregador');
  const v1 = capas.find((c) => c.handle !== routes && c.handle.stack.some((s) => s.handle === routes));
  assert.ok(v1, '/api/v1 monta un router que contiene ESE mismo agregador, no una copia');
  assert.ok(app._router.stack.indexOf(v1) < app._router.stack.indexOf(deApi[0]), '/api/v1 va antes que /api');
});

test('v1: la regla que deja fuera de v1 coincide EXACTAMENTE con las rutas internas del catálogo', () => {
  for (const fila of TABLA) {
    assert.strictEqual(
      esCanalInterno(fila.patron),
      fila.acceso === INTERNA,
      `${fila.metodo} ${fila.patron}`
    );
  }
});

// --- Límites compartidos -------------------------------------------------------

/** App mínima con el mismo montaje y un router de mentira (sin base). */
function appConLimites({ limitadorGlobal, limitadorLogin }) {
  const rutas = express.Router();
  rutas.get('/x', (req, res) => res.json({ ok: true }));
  // Un login que siempre falla: el limitador de login solo cuenta los fallidos.
  rutas.post('/auth/login', limitadorLogin, (req, res) => res.status(401).json({ error: 'no' }));
  const mini = express();
  if (limitadorGlobal) mini.use(limitadorGlobal);
  mini.use(express.json());
  montarApi(mini, rutas);
  mini.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  return mini;
}

// Fuera del modo pruebas, para que los limitadores cuenten de verdad.
const PRODUCCION = { NODE_ENV: 'production' };

test('v1: el límite GLOBAL es compartido: alternar /api y /api/v1 no duplica el cupo', async () => {
  const mini = appConLimites({
    limitadorGlobal: crearLimitadorGlobal({ ...PRODUCCION, RATE_LIMIT_GLOBAL_MAX: '3' }),
    limitadorLogin: (req, res, next) => next(),
  });
  const estados = [];
  for (const ruta of ['/api/x', '/api/v1/x', '/api/x', '/api/v1/x', '/api/x']) {
    estados.push((await request(mini).get(ruta)).status);
  }
  assert.deepStrictEqual(estados, [200, 200, 200, 429, 429]);
});

test('v1: el límite de LOGIN es compartido: el mismo email por /api y /api/v1 gasta un solo cupo', async () => {
  const mini = appConLimites({
    limitadorLogin: crearLimitadorLogin({ ...PRODUCCION, RATE_LIMIT_LOGIN_MAX: '2' }),
  });
  const cuerpo = { email: 'ana@local.co', password: 'x' };
  const estados = [];
  for (const ruta of ['/api/auth/login', '/api/v1/auth/login', '/api/auth/login', '/api/v1/auth/login']) {
    estados.push((await request(mini).post(ruta).send(cuerpo)).status);
  }
  assert.deepStrictEqual(estados, [401, 401, 429, 429]);
});
