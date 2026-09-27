const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');

test('GET /api/health responde ok', async () => {
  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('POST /api/categorias sin token responde 401', async () => {
  const res = await request(app).post('/api/categorias').send({ nombre: 'Bebidas' });
  assert.strictEqual(res.status, 401);
});

test('POST /api/auth/login con body inválido responde 400', async () => {
  const res = await request(app).post('/api/auth/login').send({ email: 'no-es-un-email' });
  assert.strictEqual(res.status, 400);
});

test('GET /api/kds/comandas sin token responde 401', async () => {
  const res = await request(app).get('/api/kds/comandas');
  assert.strictEqual(res.status, 401);
});

test('POST /api/transacciones sin token responde 401', async () => {
  const res = await request(app).post('/api/transacciones').send({ pedido_id: 1, monto: 1000 });
  assert.strictEqual(res.status, 401);
});
