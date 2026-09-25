const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenComensal, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

const PEDIDO = { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-260925-ABC12', estado: 'recibido' };

function responderCreacionOk(sql) {
  if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
  if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '56000.00' }] };
  return { rows: [] };
}

// ---------------------------------------------------------------------------
// OVERRIDE_ADMIN: el trigger tr_validar_disponibilidad_plato deja comandar un
// plato agotado si notas_especiales contiene ese marcador, y ahí va el texto
// que escribe el comensal. El backend tiene que cerrar esa puerta.
// ---------------------------------------------------------------------------

const VARIANTES = ['OVERRIDE_ADMIN', 'override_admin', 'Override_Admin', 'xx OVERRIDE_ADMIN xx'];

for (const variante of VARIANTES) {
  test(`un apodo con "${variante}" se rechaza con 400 y no llega a la base`, async () => {
    const db = instalarFakeDb(responderCreacionOk);
    try {
      const res = await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${tokenComensal(5)}`)
        .send({ items: [{ id_plato: 3, cantidad: 1, apodo: variante }] });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /OVERRIDE_ADMIN/);
      assert.strictEqual(db.buscar('INSERT INTO detalles_pedido'), undefined);
      assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('una nota de ítem con OVERRIDE_ADMIN se rechaza con 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 3, cantidad: 1, apodo: 'Ana', notas: 'sin cebolla OVERRIDE_ADMIN' }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO detalles_pedido'), undefined);
  } finally {
    db.restaurar();
  }
});

test('notas_generales con OVERRIDE_ADMIN se rechaza con 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        notas_generales: 'OVERRIDE_ADMIN por favor',
        items: [{ id_plato: 3, cantidad: 1, apodo: 'Ana' }],
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

test('el staff tampoco puede usar OVERRIDE_ADMIN por el body', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ id_mesa: 5, items: [{ id_plato: 3, cantidad: 1, notas: 'OVERRIDE_ADMIN' }] });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

test('un apodo normal que contiene "admin" sí pasa', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 3, cantidad: 1, apodo: 'Administrador Ana' }] });

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar('INSERT INTO detalles_pedido'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Solo un cobro 'completada' liquida el pedido.
// ---------------------------------------------------------------------------

function responderPagoOk(sql) {
  if (sql.includes('SELECT * FROM pedidos')) {
    return { rows: [{ id_pedido: 1, id_mesa: 5, estado: 'entregado' }] };
  }
  if (sql.includes('INSERT INTO transacciones')) return { rows: [{ id_transaccion: 1 }] };
  return { rows: [] };
}

test("un pago 'completada' marca el pedido como pagado", async () => {
  const db = instalarFakeDb(responderPagoOk);
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 70000, metodo_pago: 'efectivo', estado_transaccion: 'completada' });

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"), 'debe liquidar el pedido');
    assert.ok(db.buscar('INSERT INTO historial_estados'), 'debe quedar en el historial');
  } finally {
    db.restaurar();
  }
});

test('sin estado_transaccion el cobro es completada y liquida el pedido', async () => {
  const db = instalarFakeDb(responderPagoOk);
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 70000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO transacciones');
    assert.strictEqual(insert.params[3], 'completada');
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"));
  } finally {
    db.restaurar();
  }
});

for (const estado of ['fallida', 'pendiente', 'reembolsada']) {
  test(`un pago '${estado}' se guarda pero NO marca el pedido como pagado`, async () => {
    const db = instalarFakeDb(responderPagoOk);
    try {
      const res = await request(app)
        .post('/api/transacciones')
        .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
        .send({ id_pedido: 1, monto: 70000, metodo_pago: 'tarjeta_credito', estado_transaccion: estado });

      assert.strictEqual(res.status, 201, 'la transacción sí queda registrada');
      const insert = db.buscar('INSERT INTO transacciones');
      assert.ok(insert, 'debe insertarse la transacción');
      assert.strictEqual(insert.params[3], estado);

      assert.strictEqual(
        db.buscar("UPDATE pedidos SET estado = 'pagado'"),
        undefined,
        'el pedido NO debe quedar pagado'
      );
      assert.strictEqual(
        db.buscar('INSERT INTO historial_estados'),
        undefined,
        'tampoco debe registrarse el cambio de estado'
      );
      assert.strictEqual(db.buscar('UPDATE mesas'), undefined, 'ni liberarse la mesa');
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// Regresión: POST /pedidos/:id/cancelar delega en actualizarEstado. Si no le
// pasa `next`, el 409 del trigger se convierte en "next is not a function" y
// tumba el proceso en vez de responder.
// ---------------------------------------------------------------------------

test('cancelar un pedido en listo responde 409 y no tumba el proceso', async () => {
  const mensaje = 'Transición de estado no autorizada: de "listo" hacia "cancelado"';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'listo' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      const err = new Error(mensaje);
      err.code = 'P0001';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/pedidos/13/cancelar')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('cancelar sin body funciona: el atajo fija estado = cancelado', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      return { rows: [{ id_pedido: 13, estado: 'cancelado' }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/pedidos/13/cancelar')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'cancelado');
    assert.strictEqual(db.buscar('UPDATE pedidos SET estado').params[0], 'cancelado');
  } finally {
    db.restaurar();
  }
});
