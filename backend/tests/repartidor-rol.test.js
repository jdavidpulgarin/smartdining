const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { ROLES_STAFF } = require('../src/middleware/auth.middleware');
const app = require('../server');

// D-20a: el rol `repartidor`. Es personal (está en ROLES_STAFF y en el CHECK
// usuarios_rol_check del script 36): se registra, se le cambia el rol e inicia
// sesión como cualquiera. En el resto del panel recibe 403: eso lo cubre la
// matriz (matriz-roles.test.js), que recorre TODAS las rutas con este rol.

test('repartidor: está en ROLES_STAFF, junto a los cuatro de siempre', () => {
  assert.deepStrictEqual(ROLES_STAFF, ['admin', 'mesero', 'cajero', 'cocina', 'repartidor']);
});

test('repartidor: el admin lo registra con rol repartidor (201)', async () => {
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('FROM usuarios WHERE email')) return { rows: [] };
    if (sql.includes('INSERT INTO usuarios')) {
      return { rows: [{ id_usuario: 40, nombre: params[0], email: params[1], rol: params[3], activo: true }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ nombre: 'Rafa Moto', email: 'rafa@smartdining.com', password: 'clave-segura-1', rol: 'repartidor' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.usuario.rol, 'repartidor');
    assert.strictEqual(db.buscar('INSERT INTO usuarios').params[3], 'repartidor');
  } finally {
    db.restaurar();
  }
});

test('repartidor: un rol que no existe sigue siendo 400 en el registro', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ nombre: 'Rafa Moto', email: 'rafa@smartdining.com', password: 'clave-segura-1', rol: 'motorizado' });
    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

test('repartidor: PATCH /usuarios/:id acepta rol repartidor (pasa la validación)', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .patch('/api/usuarios/40')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ rol: 'repartidor' });
    assert.notStrictEqual(res.status, 400, JSON.stringify(res.body));
  } finally {
    db.restaurar();
  }
});

test('repartidor: inicia sesión y su JWT lleva rol repartidor; con él, el panel da 403', async () => {
  const hash = bcrypt.hashSync('clave-segura-1', 10);
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM usuarios WHERE email')) {
      return { rows: [{ id_usuario: 40, nombre: 'Rafa', email: 'rafa@smartdining.com', rol: 'repartidor', activo: true, password_hash: hash }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app).post('/api/auth/login').send({ email: 'rafa@smartdining.com', password: 'clave-segura-1' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.usuario.rol, 'repartidor');
    assert.strictEqual(jwt.decode(res.body.token).rol, 'repartidor');

    for (const ruta of ['/api/pedidos/activos', '/api/kds/comandas', '/api/usuarios', '/api/transacciones?desde=hoy']) {
      const r = await request(app).get(ruta).set('Authorization', `Bearer ${res.body.token}`);
      assert.strictEqual(r.status, 403, `${ruta}: ${r.status}`);
      assert.strictEqual(r.body.motivo, 'prohibido');
    }
  } finally {
    db.restaurar();
  }
});
