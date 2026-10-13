const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido } = require('./helpers/fake-socket');
const app = require('../server');

// POST /api/transacciones admite abonos parciales: la cuenta se cierra cuando el
// saldo llega a cero, no cuando entra el primer pago. El trigger
// tr_validar_transaccion_financiera solo rechaza que se pague de MAS, asi que
// quien tiene que distinguir "abono" de "cuenta liquidada" es este backend,
// preguntandole el saldo a la base.

const TOTAL = 56000;
const PEDIDO = { id_pedido: 87, id_mesa: 5, estado: 'entregado', total: String(TOTAL) };

function responderCobro(sql) {
  if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [{ ...PEDIDO }] };
  if (sql.includes('INSERT INTO transacciones')) {
    return { rows: [{ id_transaccion: 1, id_pedido: 87, monto: '0.00', estado_transaccion: 'completada' }] };
  }
  return { rows: [] };
}

const jwtCajero = () => tokenStaff(4, 'cajero');

const cobrar = (cuerpo) =>
  request(app).post('/api/transacciones').set('Authorization', `Bearer ${jwtCajero()}`).send(cuerpo);

const PAGO_COMPLETO = { id_pedido: 87, monto: TOTAL, metodo_pago: 'efectivo' };

// ---------------------------------------------------------------------------
// Abono parcial
// ---------------------------------------------------------------------------

test('un abono parcial se registra sin marcar el pedido pagado', async () => {
  const socket = instalarFakeSocket();
  // Quedan 46.000 por cobrar despues del abono.
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    const res = await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 201, 'el abono queda registrado');
    assert.ok(db.buscar('INSERT INTO transacciones'));
    assert.strictEqual(
      db.buscar("UPDATE pedidos SET estado = 'pagado'"),
      undefined,
      'con saldo pendiente el pedido sigue abierto'
    );
    assert.strictEqual(db.buscar('INSERT INTO historial_estados'), undefined);
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un abono parcial no libera la mesa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(
      db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'),
      undefined,
      'el grupo no ha terminado: la mesa sigue ocupada y su QR vale'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un abono parcial no avisa nada al socket-server', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(socket.buscar('/internal/order-status'), undefined, 'el pedido no cambio de estado');
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el saldo se consulta a la base dentro de la transaccion del cobro', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    const consulta = db.buscar('obtener_saldo_pendiente');
    assert.ok(consulta, 'el saldo lo calcula la base, no el backend');
    assert.deepStrictEqual(consulta.params, [87]);
    assert.ok(
      consulta.sql.includes('<= 0 AS liquidado'),
      'la comparacion con cero se hace en SQL, sin floats en JavaScript'
    );

    const orden = db.ejecutadas.map((q) => q.sql);
    const indice = (f) => orden.findIndex((s) => s.includes(f));
    assert.ok(
      indice('INSERT INTO transacciones') < indice('obtener_saldo_pendiente'),
      'se pregunta DESPUES de insertar el pago, para que lo vea'
    );
    assert.ok(indice('obtener_saldo_pendiente') < indice('COMMIT'), 'y dentro de la transaccion');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Pago que liquida la cuenta (comportamiento de siempre)
// ---------------------------------------------------------------------------

test('un pago que deja el saldo en cero marca el pedido pagado y libera la mesa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"));

    const historial = db.buscar('INSERT INTO historial_estados');
    assert.ok(historial);
    assert.strictEqual(historial.params[1], 4, 'queda el cajero que cobro');
    assert.strictEqual(historial.params[2], 'entregado', 'estado_anterior');
    assert.ok(historial.sql.includes('Pago registrado'));

    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), 'la mesa se libera');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el pago que liquida avisa al socket-server tras el commit', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    await cobrar(PAGO_COMPLETO);

    const estado = socket.buscar('/internal/order-status');
    assert.ok(estado);
    assert.strictEqual(estado.cuerpo.id_pedido, 87);
    assert.strictEqual(estado.cuerpo.estado, 'pagado');

    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada);
    assert.strictEqual(liberada.cuerpo.id_mesa, 5);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('si queda otro pedido abierto en la mesa, el pedido se paga pero la mesa no se libera', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0, pedidosAbiertos: 1 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"));
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('si falla el aviso al socket el cobro queda firme', async () => {
  const socket = instalarFakeSocket(socketCaido);
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar('COMMIT'));
    assert.strictEqual(db.buscar('ROLLBACK'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Dos abonos que suman el total
// ---------------------------------------------------------------------------

test('dos abonos parciales: el primero no liquida y el segundo si', async () => {
  const socket = instalarFakeSocket();

  // Doble con memoria: va descontando los pagos del total, como la base.
  let cobrado = 0;
  const responder = (sql, params) => {
    if (sql.includes('INSERT INTO transacciones')) {
      cobrado += Number(params[2]);
      return { rows: [{ id_transaccion: 1, id_pedido: 87, monto: params[2] }] };
    }
    if (sql.includes('obtener_saldo_pendiente')) {
      const saldo = TOTAL - cobrado;
      return { rows: [{ liquidado: saldo <= 0, saldo_pendiente: saldo.toFixed(2) }] };
    }
    return responderCobro(sql);
  };

  const primero = instalarFakeDb(responder);
  try {
    const res = await cobrar({ id_pedido: 87, monto: 20000, metodo_pago: 'efectivo' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      primero.buscar("UPDATE pedidos SET estado = 'pagado'"),
      undefined,
      'faltan 36.000: el pedido sigue abierto'
    );
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    primero.restaurar();
  }

  const segundo = instalarFakeDb(responder);
  try {
    const res = await cobrar({ id_pedido: 87, monto: 36000, metodo_pago: 'tarjeta_debito' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(cobrado, TOTAL, 'los dos abonos suman el total');
    assert.ok(segundo.buscar("UPDATE pedidos SET estado = 'pagado'"), 'ahora si se liquida');
    assert.ok(segundo.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'));
    assert.ok(socket.buscar('/internal/mesa-liberada'), 'y ahora si se avisa');
  } finally {
    segundo.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lo que no cambia
// ---------------------------------------------------------------------------

test('un pago que excede el saldo sigue saliendo como 409 del trigger', async () => {
  const socket = instalarFakeSocket();
  const mensaje = 'Pago excede monto debido. Total: 56000.00, Pagado previo: 50000.00, Intento: 10000.00';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO transacciones')) {
      const err = new Error(mensaje);
      err.code = 'P0001';
      throw err;
    }
    return responderCobro(sql);
  });
  try {
    const res = await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

for (const estado of ['pendiente', 'fallida', 'reembolsada']) {
  test(`una transaccion '${estado}' no consulta el saldo ni cambia el pedido`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
    try {
      const res = await cobrar({
        id_pedido: 87,
        monto: TOTAL,
        metodo_pago: 'efectivo',
        estado_transaccion: estado,
      });

      assert.strictEqual(res.status, 201, 'la transaccion se registra igual');
      assert.strictEqual(
        db.buscar('obtener_saldo_pendiente'),
        undefined,
        'un pago no efectivo no liquida nada, asi que no hace falta el saldo'
      );
      assert.strictEqual(db.buscar("UPDATE pedidos SET estado = 'pagado'"), undefined);
      assert.strictEqual(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), undefined);
      assert.strictEqual(socket.buscar('/internal/order-status'), undefined);
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('un pedido inexistente sigue respondiendo 404', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [] };
    return responderCobro(sql);
  });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('la respuesta sigue siendo la transaccion registrada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    const res = await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id_transaccion, 1, 'la forma de la respuesta no cambia');
    assert.strictEqual(res.body.id_pedido, 87);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
