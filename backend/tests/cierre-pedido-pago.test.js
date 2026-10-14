const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');

// REGLA DE CIERRE (H-03, script 22): un pedido pasa a estado 'pagado' en el
// momento en que esta ENTREGADO Y totalmente pagado, en cualquiera de los dos
// ordenes.
//
// Los dos ordenes existen de verdad:
//   - primero se entrega y despues se cobra en caja: lo cierra registrarPago;
//   - primero se paga (pago en linea, o la caja cobrando por adelantado) y
//     despues sale la comida: lo cierra el PATCH a 'entregado'.
//
// Antes faltaban las dos mitades y cada una tenia su falla medida:
//   A. cobrar un pedido en 'listo' intentaba el UPDATE a 'pagado', el trigger
//      tr_validar_transicion_estado lo abortaba y el ROLLBACK se llevaba el
//      pago entero (409 y cero filas en transacciones);
//   B. un pedido pagado en linea nunca volvia a 'pagado', asi que la mesa
//      quedaba ocupada con su QR vivo para siempre.

const ID_PEDIDO = 87;
const ID_MESA = 5;
const TOTAL = 24000;

const jwtCajero = () => tokenStaff(4, 'cajero');
const jwtMesero = () => tokenStaff(3, 'mesero');

// ---------------------------------------------------------------------------
// A. La caja cobra un pedido que todavia no se entrego
// ---------------------------------------------------------------------------

/** Pedido en el estado que se le pase, con su total. */
function responderCobro(estado) {
  return (sql) => {
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      return { rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado, total: String(TOTAL) }] };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      return {
        rows: [
          {
            id_transaccion: 1,
            id_pedido: ID_PEDIDO,
            monto: String(TOTAL),
            estado_transaccion: 'completada',
          },
        ],
      };
    }
    return { rows: [] };
  };
}

const cobrar = () =>
  request(app)
    .post('/api/transacciones')
    .set('Authorization', `Bearer ${jwtCajero()}`)
    .send({ id_pedido: ID_PEDIDO, monto: TOTAL, metodo_pago: 'efectivo' });

for (const estado of ['recibido', 'en_preparacion', 'listo']) {
  test(`a: cobrar un pedido en '${estado}' guarda el pago y no lo pierde`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro(estado));
    try {
      const res = await cobrar();

      assert.strictEqual(res.status, 201, 'el pago entra: es lo que antes se perdia con un 409');
      assert.ok(db.buscar('INSERT INTO transacciones'), 'la transaccion queda registrada');
      assert.ok(db.buscar('COMMIT'), 'y se confirma, no se revierte');
      assert.strictEqual(
        db.buscar("UPDATE pedidos SET estado = 'pagado'"),
        undefined,
        'no se intenta la transicion que el trigger rechaza desde este estado'
      );
      assert.strictEqual(
        db.buscar('INSERT INTO historial_estados'),
        undefined,
        'no hubo cambio de estado que registrar'
      );
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('a: cobrar antes de entregar no libera la mesa ni invalida el QR', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro('listo'));
  try {
    await cobrar();

    assert.strictEqual(
      db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'),
      undefined,
      'el comensal sigue esperando su plato: su sesion no puede caerse'
    );
    assert.strictEqual(
      db.buscar('count(*)::int AS n FROM pedidos'),
      undefined,
      'ni se pregunta: el pedido no se cerro'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('a: cobrar antes de entregar no anuncia el pedido como pagado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro('listo'));
  try {
    await cobrar();

    assert.strictEqual(
      socket.buscar('/internal/order-status'),
      undefined,
      'anunciar pagado le diria al KDS y al comensal algo que no paso'
    );
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('a: cobrar un pedido ya entregado si lo cierra y libera la mesa', async () => {
  // El otro orden, el de siempre: control de que el guard no rompio el camino
  // normal de la caja.
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro('entregado'));
  try {
    const res = await cobrar();

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"), 'entregado y sin saldo: se cierra');
    assert.ok(db.buscar('INSERT INTO historial_estados'));
    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), 'y la mesa se libera');

    const aviso = socket.buscar('/internal/order-status');
    assert.ok(aviso, 'esto si se anuncia');
    assert.strictEqual(aviso.cuerpo.estado, 'pagado');
    assert.ok(socket.buscar('/internal/mesa-liberada'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// B. El mesero entrega un pedido que ya estaba pagado
// ---------------------------------------------------------------------------

/**
 * @param {string} estadoPago  valor de pedidos.estado_pago que mantiene el
 *        trigger tr_sincronizar_estado_pago_pedido (script 22).
 * @param {boolean} liquidado  lo que contesta obtener_saldo_pendiente; se deja
 *        en false para el caso en que las dos fuentes no coinciden.
 */
function responderEntrega(estadoPago, liquidado = true) {
  return (sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'listo' }] };
    if (sql.includes('UPDATE pedidos SET estado = $1')) {
      return {
        rows: [
          { id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: params[0], estado_pago: estadoPago },
        ],
      };
    }
    // El doble solo deja pasar la respuesta propia si trae filas, asi que el
    // caso liquidado=true se deja en manos de su valor por omision.
    if (sql.includes('obtener_saldo_pendiente') && !liquidado) {
      return { rows: [{ liquidado: false }] };
    }
    if (sql.includes("UPDATE pedidos SET estado = 'pagado'")) {
      return {
        rows: [
          { id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: 'pagado', estado_pago: estadoPago },
        ],
      };
    }
    return { rows: [] };
  };
}

const entregar = () =>
  request(app)
    .patch(`/api/pedidos/${ID_PEDIDO}/estado`)
    .set('Authorization', `Bearer ${jwtMesero()}`)
    .send({ estado: 'entregado' });

test('b: entregar un pedido con la cuenta cubierta lo cierra en pagado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado'));
  try {
    const res = await entregar();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'pagado', 'se pidio entregado y termino cerrado');
    assert.strictEqual(res.body.estado_anterior, 'listo', 'de donde venia de verdad');
    assert.strictEqual(res.body.cerradoPorPago, true);

    const pasos = db.ejecutadas.map((q) => q.sql);
    assert.ok(
      pasos.some((s) => s.includes('UPDATE pedidos SET estado = $1')),
      'primero el entregado que se pidio'
    );
    assert.ok(
      pasos.some((s) => s.includes("UPDATE pedidos SET estado = 'pagado'")),
      'y despues el cierre'
    );
    assert.ok(db.buscar('COMMIT'), 'las dos cosas en la misma transaccion');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('b: el cierre al entregar queda en historial_estados como entregado -> pagado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado'));
  try {
    await entregar();

    const historial = db.todas('INSERT INTO historial_estados');
    assert.strictEqual(historial.length, 2, 'dos cambios, dos filas: no se pierde la auditoria');
    assert.deepStrictEqual(historial[0].params.slice(2, 4), ['listo', 'entregado']);
    assert.strictEqual(historial[1].params[2], 'entregado', 'el cierre parte de entregado');
    assert.ok(
      historial[1].sql.includes("'pagado'"),
      'y llega a pagado, que es la unica transicion legal'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('b: al cerrarse por entrega la mesa se libera y se avisa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado'));
  try {
    const res = await entregar();

    assert.ok(
      db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'),
      'esto es lo que antes no pasaba nunca: la mesa se quedaba ocupada para siempre'
    );
    assert.strictEqual(res.body.mesaLiberada, true);

    const estado = socket.buscar('/internal/order-status');
    assert.strictEqual(estado.cuerpo.estado, 'pagado', 'el KDS lo saca del tablero');
    assert.ok(socket.buscar('/internal/mesa-liberada'), 'y el socket cierra la sesion de la mesa');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('b: la mesa se bloquea antes del UPDATE, tambien al entregar', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado'));
  try {
    await entregar();

    const indice = (f) => db.ejecutadas.findIndex((q) => q.sql.includes(f));
    const bloqueo = db.buscar('FROM mesas m');
    assert.ok(bloqueo, 'marcar entregado ahora puede liberar la mesa: hay que bloquearla');
    assert.ok(bloqueo.sql.includes('FOR UPDATE'));
    assert.ok(
      indice('FROM mesas m') < indice('UPDATE pedidos SET estado = $1'),
      'mesa -> pedido, el mismo orden de los pagos: al reves vuelve el interbloqueo 40P01'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

for (const estadoPago of ['pendiente', 'parcial']) {
  test(`b: con estado_pago '${estadoPago}' entregar deja el pedido en entregado`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderEntrega(estadoPago));
    try {
      const res = await entregar();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.estado, 'entregado', 'falta cobrar: lo cerrara la caja');
      assert.strictEqual(res.body.cerradoPorPago, false);
      assert.strictEqual(db.buscar("UPDATE pedidos SET estado = 'pagado'"), undefined);
      assert.strictEqual(
        db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'),
        undefined,
        'la mesa sigue ocupada: hay cuenta pendiente'
      );
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('b: si estado_pago dice pagado pero queda saldo, el pedido NO se cierra', async () => {
  // estado_pago se recalcula al tocar transacciones, asi que es esa columna la
  // que podria quedarse atras respecto del total. Antes de mover dinero se pide
  // que las dos fuentes digan lo mismo.
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado', false));
  try {
    const res = await entregar();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'entregado');
    assert.ok(db.buscar('obtener_saldo_pendiente'), 'se confirma con el saldo, no solo con la columna');
    assert.strictEqual(
      db.buscar("UPDATE pedidos SET estado = 'pagado'"),
      undefined,
      'cerrar aqui dejaria una cuenta viva como cobrada'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('b: el saldo solo se consulta si estado_pago dice que esta cubierto', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pendiente'));
  try {
    await entregar();

    assert.strictEqual(
      db.buscar('obtener_saldo_pendiente'),
      undefined,
      'una entrega corriente no paga una consulta extra por cada comanda'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('b: marcar listo no mira la cuenta ni cierra nada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega('pagado'));
  try {
    const res = await request(app)
      .patch(`/api/pedidos/${ID_PEDIDO}/estado`)
      .set('Authorization', `Bearer ${jwtMesero()}`)
      .send({ estado: 'listo' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'listo', 'pagado o no, la comida todavia no salio');
    assert.strictEqual(db.buscar('obtener_saldo_pendiente'), undefined);
    assert.strictEqual(db.buscar("UPDATE pedidos SET estado = 'pagado'"), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
