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
  // El doble de base es necesario desde H-09: el middleware comprueba en cada
  // peticion del personal que la cuenta siga activa, antes de mirar el rol. Sin
  // el, la consulta va a PostgreSQL de verdad y en un entorno sin base (el CI)
  // la peticion falla con 500 en vez de llegar al control de roles.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ nombre: 'Ana Ríos', email: 'ana@mail.com', password: '123456', rol: 'cajero' });

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
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
  // El doble de base es necesario desde H-09: el middleware comprueba en cada
  // peticion del personal que la cuenta siga activa, antes de mirar el rol. Sin
  // el, la consulta va a PostgreSQL de verdad y en un entorno sin base (el CI)
  // la peticion falla con 500 en vez de llegar al control de roles.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});

test('un comensal con sesión vigente no puede entrar al KDS', async () => {
  // Con BD simulada para que el middleware pueda comprobar la sesión de mesa:
  // así se verifica el 403 por rol y no un 401 por sesión.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});
