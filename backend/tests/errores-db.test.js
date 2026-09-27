const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');

/** Simula el error que node-postgres entrega ante un RAISE EXCEPTION. */
function errorTrigger(mensaje) {
  const err = new Error(mensaje);
  err.code = 'P0001';
  return err;
}

/** Simula una violación de CHECK: no debe filtrarse al cliente. */
function errorCheck() {
  const err = new Error(
    'el nuevo registro para la relación «transacciones» viola la restricción «check» «transacciones_metodo_pago_check»'
  );
  err.code = '23514';
  return err;
}

test('una transicion no permitida por el trigger responde 409 con el mensaje del trigger', async () => {
  const mensaje = 'Transición de estado no autorizada: de "en_preparacion" hacia "pagado"';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'en_preparacion' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorTrigger(mensaje);
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/pedidos/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ estado: 'pagado' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un plato no disponible responde 409 con el mensaje del trigger', async () => {
  const mensaje = 'El plato "Hamburguesa Smart Angus" no se encuentra disponible actualmente en la cocina';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ id_pedido: 87, id_mesa: 5 }] };
    if (sql.includes('INSERT INTO detalles_pedido')) throw errorTrigger(mensaje);
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 3, cantidad: 1, apodo: 'Ana' }] });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un error de CHECK responde 500 genérico y no expone el mensaje interno', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: 1, id_mesa: 5, estado: 'entregado' }] };
    if (sql.includes('INSERT INTO transacciones')) throw errorCheck();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 56000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
    assert.ok(!/restricción|check|transacciones_metodo_pago/i.test(JSON.stringify(res.body)));
  } finally {
    db.restaurar();
  }
});

test('metodo_pago solo acepta los valores del CHECK del schema', async () => {
  const res = await request(app)
    .post('/api/transacciones')
    .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
    .send({ id_pedido: 1, monto: 1000, metodo_pago: 'tarjeta' });

  assert.strictEqual(res.status, 400, "'tarjeta' no existe en el schema: se rechaza en el body");
});

test('el pago no toca la tabla mesas: liberarla es del trigger tr_regenerar_token_qr', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: 1, id_mesa: 5, estado: 'entregado' }] };
    if (sql.includes('INSERT INTO transacciones')) return { rows: [{ id_transaccion: 1 }] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 56000, metodo_pago: 'tarjeta_credito' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('UPDATE mesas'), undefined, 'el backend ya no libera la mesa');
  } finally {
    db.restaurar();
  }
});

test('el codigo_pedido generado cabe en el VARCHAR(16) del schema', () => {
  const { generarCodigoPedido } = require('../src/services/pedidos.service');
  for (let i = 0; i < 200; i++) {
    const codigo = generarCodigoPedido();
    assert.ok(codigo.length <= 16, `"${codigo}" mide ${codigo.length}`);
  }
});
