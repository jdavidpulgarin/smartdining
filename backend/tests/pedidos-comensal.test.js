const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenComensal, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

// Responde lo mínimo que necesita crearConDetalles para llegar al COMMIT.
// El subtotal y el total ya no los calcula el backend: los ponen los triggers,
// así que el pedido se relee y es esa relectura la que trae el total.
const PEDIDO = { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-260925-ABC12', estado: 'recibido' };

function responderCreacionOk(sql) {
  if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
  if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '56000.00' }] };
  return { rows: [] };
}

test('un comensal no puede crear un pedido para otra mesa: se usa el id_mesa del token', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        id_mesa: 9, // intento de pedir a nombre de la mesa 9
        items: [{ id_plato: 12, cantidad: 2, apodo: 'Ana' }],
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id_mesa, 5, 'el pedido queda en la mesa del token');

    const insert = db.buscar('INSERT INTO pedidos');
    assert.ok(insert, 'debe insertarse el pedido');
    assert.strictEqual(insert.params[0], 5, 'el id_mesa del body (9) se ignora');
    assert.ok(!insert.params.includes(9));
  } finally {
    db.restaurar();
  }
});

test('el apodo del comensal se guarda en detalles_pedido.notas_especiales', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 2, apodo: 'Ana', notas: 'sin cebolla' }] });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.codigo_pedido, 'el pedido trae un codigo_pedido');
    assert.strictEqual(res.body.total, '56000.00', 'el total viene de la relectura, no de JS');

    const detalle = db.buscar('INSERT INTO detalles_pedido');
    assert.ok(detalle);
    // (id_pedido, id_plato, cantidad, notas_especiales) — el backend ya no manda
    // precio_unitario ni subtotal: el precio sale de una subconsulta a platos y
    // el subtotal lo calcula el trigger tr_validar_detalle_pedido.
    assert.deepStrictEqual(detalle.params, [87, 12, 2, 'Ana: sin cebolla']);
    assert.ok(
      detalle.sql.includes('(SELECT precio FROM platos WHERE id_plato = $2)'),
      'el precio lo congela la base en el propio INSERT'
    );
    assert.ok(!detalle.sql.includes('subtotal'), 'el backend no manda subtotal');
  } finally {
    db.restaurar();
  }
});

test('el pedido de un comensal deja id_usuario null en historial_estados', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, apodo: 'Ana' }] });

    const historial = db.buscar('INSERT INTO historial_estados');
    assert.ok(historial);
    assert.strictEqual(historial.params[1], null, 'un comensal no tiene id_usuario');
  } finally {
    db.restaurar();
  }
});

test('un mesero debe mandar el id_mesa en el body', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ items: [{ id_plato: 12, cantidad: 1 }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /id_mesa/);
  } finally {
    db.restaurar();
  }
});

test('un cajero no puede crear pedidos', async () => {
  const res = await request(app)
    .post('/api/pedidos')
    .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
    .send({ id_mesa: 5, items: [{ id_plato: 12, cantidad: 1 }] });

  assert.strictEqual(res.status, 403);
});

test('un comensal no puede consultar un pedido de otra mesa', async () => {
  const db = instalarFakeDb((sql) =>
    sql.includes('FROM pedidos') ? { rows: [{ id_pedido: 99, id_mesa: 9, estado: 'recibido' }] } : { rows: [] }
  );
  try {
    const res = await request(app)
      .get('/api/pedidos/99')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});
