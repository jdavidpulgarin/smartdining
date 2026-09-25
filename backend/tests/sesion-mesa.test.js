const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { instalarFakeDb, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado: 'ocupada' };

test('POST /api/mesas/qr/:token/sesion con un token_qr inexistente responde 404 y no emite JWT', async () => {
  // La mesa no existe: la query por token_qr no devuelve filas.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app).post('/api/mesas/qr/token-que-no-existe/sesion');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Token de mesa inválido');
    assert.strictEqual(res.body.token, undefined);

    const consulta = db.buscar('token_qr');
    assert.ok(consulta, 'debe consultarse la mesa por token_qr');
    assert.deepStrictEqual(consulta.params, ['token-que-no-existe']);
  } finally {
    db.restaurar();
  }
});

test('POST /api/mesas/qr/:token/sesion con token_qr valido emite un JWT de comensal a 3 h', async () => {
  const db = instalarFakeDb((sql) => (sql.includes('token_qr') ? { rows: [MESA] } : { rows: [] }));
  try {
    const res = await request(app).post('/api/mesas/qr/qr-mesa-5/sesion');

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.mesa.id_mesa, 5);

    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.strictEqual(payload.rol, 'comensal');
    assert.strictEqual(payload.id_mesa, 5);
    assert.strictEqual(payload.id_usuario, undefined, 'el comensal no existe en la tabla usuarios');

    // 3 h de vigencia (se tolera el segundo de diferencia al firmar).
    assert.ok(Math.abs(payload.exp - payload.iat - 3 * 60 * 60) <= 1);
  } finally {
    db.restaurar();
  }
});

test('GET /api/pedidos/mesa sin token responde 401', async () => {
  const res = await request(app).get('/api/pedidos/mesa');
  assert.strictEqual(res.status, 401);
});

test('GET /api/pedidos/historial ya no existe: cae en /:id y no devuelve lista', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/pedidos/historial')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.pedidos, undefined);
  } finally {
    db.restaurar();
  }
});
