const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');

test('POST /api/auth/register sin token responde 401', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nombre: 'Ana Ríos', email: 'ana@mail.com', password: '123456', rol: 'mesero' });

  assert.strictEqual(res.status, 401);
});

test('POST /api/auth/register con token de mesero responde 403: solo admin registra', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
    .send({ nombre: 'Ana Ríos', email: 'ana@mail.com', password: '123456', rol: 'cajero' });

  assert.strictEqual(res.status, 403);
});

test('el rol cliente ya no se acepta al registrar', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ nombre: 'Ana Ríos', email: 'ana@mail.com', password: '123456', rol: 'cliente' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO usuarios'), undefined);
  } finally {
    db.restaurar();
  }
});

test('el rol comensal no se puede registrar: solo existe dentro del JWT', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ nombre: 'Ana Ríos', email: 'ana@mail.com', password: '123456', rol: 'comensal' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO usuarios'), undefined);
  } finally {
    db.restaurar();
  }
});

test('GET /api/kds/comandas con rol cocina pasa el control de roles', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${tokenStaff(7, 'cocina')}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.comandas, []);
  } finally {
    db.restaurar();
  }
});

test('GET /api/kds/comandas con rol mesero responde 403', async () => {
  const res = await request(app)
    .get('/api/kds/comandas')
    .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

  assert.strictEqual(res.status, 403);
});

test('un comensal no puede entrar al KDS', async () => {
  const res = await request(app)
    .get('/api/kds/comandas')
    .set('Authorization', `Bearer ${tokenComensal(5)}`);

  assert.strictEqual(res.status, 403);
});
