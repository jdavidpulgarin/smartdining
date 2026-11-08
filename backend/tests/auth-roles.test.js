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

// ---------------------------------------------------------------------------
// S-26: GET /api/pedidos/:id ya no esta abierto a cualquier rol autenticado
//
// Devuelve el pedido COMPLETO: total, y por cada item el alias del comensal que
// lo pidio y lo que lleva. La cocina no necesita nada de eso (trabaja con sus
// comandas en /api/kds/comandas, que no pasan por esta ruta), asi que podia leer
// la cuenta y quien pidio que de cualquier mesa del local sin motivo.
// ---------------------------------------------------------------------------

/** Pedido 87 de la mesa 5, con su detalle, como lo da obtenerConDetalles. */
const dbPedido = () => (sql) => {
  if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
    return { rows: [{ id_pedido: 87, id_mesa: 5, estado: 'entregado', total: '24000.00' }] };
  }
  // Alias en el fragmento (dp) para no pisar lo que capturan otras pruebas.
  if (sql.includes('FROM detalles_pedido dp')) {
    return { rows: [{ id_detalle: 1, id_pedido: 87, comensal: 'Ana', ingredientes: [] }] };
  }
  return { rows: [] };
};

test('s-26: GET /api/pedidos/:id con rol cocina responde 403', async () => {
  const db = instalarFakeDb(dbPedido());
  try {
    const res = await request(app)
      .get('/api/pedidos/87')
      .set('Authorization', `Bearer ${tokenStaff(7, 'cocina')}`);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      db.buscar('SELECT * FROM pedidos WHERE id_pedido'),
      undefined,
      'se corta en el control de roles: el pedido no se llega a leer'
    );
  } finally {
    db.restaurar();
  }
});

for (const rol of ['admin', 'cajero', 'mesero']) {
  test(`s-26: GET /api/pedidos/:id sigue abierto para ${rol}`, async () => {
    const db = instalarFakeDb(dbPedido());
    try {
      const res = await request(app)
        .get('/api/pedidos/87')
        .set('Authorization', `Bearer ${tokenStaff(1, rol)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.id_pedido, 87);
    } finally {
      db.restaurar();
    }
  });
}

test('s-26: el comensal sigue viendo el pedido de su propia mesa', async () => {
  const db = instalarFakeDb(dbPedido());
  try {
    const res = await request(app)
      .get('/api/pedidos/87')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    // Es el dueno del pedido: lo que puede ver lo acotan las guardas del
    // controller (su mesa y solo su visita), no el control de roles.
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_pedido, 87);
  } finally {
    db.restaurar();
  }
});
