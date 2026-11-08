const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, ES_UUID, CLAVE_FALSA } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// POST /internal/payment-confirmed (EVENTS.md §8.6): un cobro de CAJA —efectivo,
// datafono o abono parcial— que ya quedo guardado en la base. El socket-server
// lo reemite como payment:confirmed, el mismo evento que un pago de Wompi, para
// que todas las cajas y la mesa vean el saldo nuevo al instante.
//
// Lo que se comprueba aqui, mas alla de "sale el aviso":
//   - va en centavos ENTEROS (el contrato rechaza decimales con 400);
//   - el saldo es el de la MESA despues de ese cobro, no el del pedido;
//   - cuando la cuenta queda en cero, el ORDEN es payment-confirmed ->
//     order:status -> mesa-liberada, porque mesa-liberada desconecta a los
//     comensales y si saliera antes la mesa nunca veria su ultimo pago;
//   - si el socket-server falla, el cobro NO se revierte;
//   - no entra dinero nuevo => no hay aviso (H-22 y el pago fantasma).

const RUTA = '/api/transacciones';
const ID_PEDIDO = 87;
const ID_MESA = 5;
const TOTAL = 24000;

const jwtCajero = () => tokenStaff(4, 'cajero');

/**
 * Doble de la base para un cobro en caja.
 *
 * @param {{estadoPedido?: string, monto?: number, saldosMesaCentavos?: number[],
 *          saldoPedido?: number, comensal?: string|null,
 *          referencia?: string|null}} opciones
 *        saldosMesaCentavos lleva un saldo por cobro, en el orden en que se
 *        cobran: asi una prueba de dos abonos ve bajar el saldo de la mesa.
 */
function responderCaja(opciones = {}) {
  const {
    estadoPedido = 'entregado',
    monto = TOTAL,
    saldosMesaCentavos = [0],
    saldoPedido = 0,
    comensal = null,
    referencia = null,
  } = opciones;

  // Cuantos cobros van: elige el saldo de la mesa de este cobro y da un
  // id_transaccion distinto a cada fila, como haria la secuencia de la tabla.
  let cobros = 0;

  return (sql) => {
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      return {
        rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: estadoPedido, total: String(TOTAL) }],
      };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      return {
        rows: [
          {
            id_transaccion: 900 + cobros,
            id_pedido: ID_PEDIDO,
            // La base devuelve DECIMAL como cadena: se comprueba a proposito
            // con el tipo real, porque es de donde salen los centavos.
            monto: String(monto),
            estado_transaccion: 'completada',
            comensal,
            referencia_externa: referencia,
          },
        ],
      };
    }
    // Saldo de LA MESA. Va antes de la rama del saldo del pedido porque las dos
    // consultas mencionan obtener_saldo_pendiente.
    if (sql.includes('AS saldo_centavos')) {
      const saldo = saldosMesaCentavos[Math.min(cobros, saldosMesaCentavos.length - 1)];
      cobros += 1;
      return { rows: [{ saldo_centavos: String(saldo) }] };
    }
    if (sql.includes('obtener_saldo_pendiente($1) <= 0')) {
      return { rows: [{ liquidado: saldoPedido <= 0 }] };
    }
    return { rows: [] };
  };
}

const cobrar = (cuerpo = {}) =>
  request(app)
    .post(RUTA)
    .set('Authorization', `Bearer ${jwtCajero()}`)
    .send({ id_pedido: ID_PEDIDO, monto: TOTAL, metodo_pago: 'efectivo', ...cuerpo });

/**
 * Espera a que termine la cadena de avisos. El handler NO la espera —el 201
 * sale antes—, asi que sin esto la prueba miraria los avisos a medio enviar.
 * Es un flush de verdad, no un temporizador: no agrega tiempo a la suite.
 */
const avisosEnviados = () => socketNotifier.esperarAvisos();

// ---------------------------------------------------------------------------
// (A) Abono parcial: entra dinero pero la cuenta sigue abierta
// ---------------------------------------------------------------------------

test('a: un abono parcial avisa el pago y nada mas', async () => {
  const socket = instalarFakeSocket();
  // Se abonan 10.000 de una cuenta de 24.000: quedan 14.000 en la mesa.
  const db = instalarFakeDb(
    responderCaja({ monto: 10000, saldoPedido: 14000, saldosMesaCentavos: [1400000] })
  );
  try {
    const res = await cobrar({ monto: 10000 });
    assert.strictEqual(res.status, 201);
    await avisosEnviados();

    const pagos = socket.todos('/internal/payment-confirmed');
    assert.strictEqual(pagos.length, 1, 'un aviso por abono, ni mas ni menos');

    const { cuerpo, cabeceras } = pagos[0];
    assert.match(cuerpo.eventId, ES_UUID, 'eventId es un UUID v4');
    assert.strictEqual(cuerpo.id_mesa, ID_MESA);
    assert.strictEqual(cuerpo.monto_centavos, 1000000);
    assert.ok(Number.isSafeInteger(cuerpo.monto_centavos), 'entero: el contrato rechaza decimales');
    assert.strictEqual(cuerpo.saldo_restante_centavos, 1400000, 'el saldo de la MESA tras el abono');
    assert.strictEqual(cuerpo.id_transaccion, 900, 'la fila de transacciones, 2a guardia de idempotencia');
    assert.strictEqual(cuerpo.comensal, null, 'un cobro de la mesa completa no lleva alias');
    assert.strictEqual(cuerpo.referencia_externa, null);
    assert.strictEqual(cabeceras['x-internal-key'], CLAVE_FALSA);

    // La cuenta sigue abierta: no cambio el estado del pedido ni se fue nadie.
    assert.strictEqual(socket.buscar('/internal/order-status'), undefined);
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('a: dos abonos dan dos eventId distintos y el saldo baja', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderCaja({ monto: 10000, saldoPedido: 4000, saldosMesaCentavos: [1400000, 400000] })
  );
  try {
    await cobrar({ monto: 10000 });
    await avisosEnviados();
    await cobrar({ monto: 10000 });
    await avisosEnviados();

    const pagos = socket.todos('/internal/payment-confirmed');
    assert.strictEqual(pagos.length, 2, 'una llamada por abono');

    assert.notStrictEqual(
      pagos[0].cuerpo.eventId,
      pagos[1].cuerpo.eventId,
      'un eventId por cobro: con el mismo, el socket-server tomaria el segundo por duplicado'
    );
    assert.deepStrictEqual(
      pagos.map((p) => p.cuerpo.saldo_restante_centavos),
      [1400000, 400000],
      'el saldo de la mesa va bajando'
    );
    assert.deepStrictEqual(
      pagos.map((p) => p.cuerpo.id_transaccion),
      [900, 901],
      'cada abono es su propia fila'
    );
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('a: el alias y la referencia del voucher viajan en el aviso', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderCaja({
      monto: 10000,
      saldoPedido: 14000,
      saldosMesaCentavos: [1400000],
      comensal: 'Ana',
      referencia: 'CAJA-123',
    })
  );
  try {
    await cobrar({ monto: 10000, comensal: 'Ana', referencia_externa: 'CAJA-123' });
    await avisosEnviados();

    const { cuerpo } = socket.buscar('/internal/payment-confirmed');
    assert.strictEqual(cuerpo.comensal, 'Ana');
    assert.strictEqual(cuerpo.referencia_externa, 'CAJA-123');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// (B) El cobro liquida un pedido ya entregado: aqui el ORDEN es lo que importa
// ---------------------------------------------------------------------------

test('b: al liquidar, el orden es pago -> estado -> mesa liberada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCaja({ saldoPedido: 0, saldosMesaCentavos: [0] }));
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 201);
    await avisosEnviados();

    // Por INDICE, no con buscar(): lo que se esta comprobando es justamente el
    // orden. mesa-liberada desconecta a los comensales, asi que si saliera
    // antes que payment-confirmed la mesa no veria el pago que la cerro.
    assert.deepStrictEqual(
      socket.avisos.map((a) => a.ruta),
      ['/internal/payment-confirmed', '/internal/order-status', '/internal/mesa-liberada']
    );

    assert.strictEqual(socket.avisos[0].cuerpo.saldo_restante_centavos, 0, 'la cuenta queda cubierta');
    assert.strictEqual(socket.avisos[1].cuerpo.estado, 'pagado');
    assert.strictEqual(socket.avisos[1].cuerpo.estado_anterior, 'entregado');
    assert.deepStrictEqual(socket.avisos[2].cuerpo, { id_mesa: ID_MESA, motivo: 'pagada' });
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// (C) Cobrar un pedido que sigue en cocina (regla de cierre del PR #48)
// ---------------------------------------------------------------------------

test('c: cobrar un pedido aun en cocina avisa el pago pero no cierra nada', async () => {
  const socket = instalarFakeSocket();
  // Pagado del todo, pero la comida no ha salido: el pedido NO cambia de estado
  // y la mesa sigue ocupada, para no invalidar el QR de quien espera su plato.
  const db = instalarFakeDb(
    responderCaja({ estadoPedido: 'listo', saldoPedido: 0, saldosMesaCentavos: [0] })
  );
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 201);
    await avisosEnviados();

    assert.strictEqual(socket.todos('/internal/payment-confirmed').length, 1, 'el dinero si entro');
    assert.strictEqual(socket.buscar('/internal/order-status'), undefined, 'el pedido sigue en cocina');
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined, 'y la mesa, ocupada');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Aislamiento: el tiempo real nunca arrastra al cobro
// ---------------------------------------------------------------------------

test('con el socket-server caido el cobro responde 201 y queda guardado', async () => {
  const socket = socketCaido();
  const db = instalarFakeDb(responderCaja({ saldoPedido: 0, saldosMesaCentavos: [0] }));
  try {
    const res = await cobrar();

    assert.strictEqual(res.status, 201, 'el cobro no depende del tiempo real');
    await avisosEnviados();

    assert.ok(db.buscar('INSERT INTO transacciones'), 'la transaccion se registro');
    assert.ok(db.buscar('COMMIT'), 'y se confirmo');
    assert.strictEqual(db.buscar('ROLLBACK'), undefined, 'no se revierte por un aviso fallido');

    // Se intento igualmente, y en el orden de siempre: fallar no salta pasos.
    assert.deepStrictEqual(
      socket.avisos.map((a) => a.ruta),
      ['/internal/payment-confirmed', '/internal/order-status', '/internal/mesa-liberada']
    );
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server responde 400 el cobro tampoco se revierte', async () => {
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/internal/payment-confirmed'
      ? { __status: 400, ok: false, codigo: 'PAYLOAD_INVALIDO' }
      : { ok: true }
  );
  const db = instalarFakeDb(responderCaja({ saldoPedido: 0, saldosMesaCentavos: [0] }));
  try {
    const res = await cobrar();

    assert.strictEqual(res.status, 201);
    await avisosEnviados();

    assert.ok(db.buscar('COMMIT'));
    assert.strictEqual(db.buscar('ROLLBACK'), undefined);
    // Un 400 en el primer aviso no corta la cadena: el cambio de estado y la
    // liberacion ya ocurrieron en la base y hay que anunciarlos igual.
    assert.ok(socket.buscar('/internal/order-status'));
    assert.ok(socket.buscar('/internal/mesa-liberada'));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('un estado de transaccion que no sea completada no avisa nada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCaja());
  try {
    // H-07: el estado lo fija el servidor y esta ruta solo acepta 'completada',
    // asi que un reembolso ni siquiera llega a la base. La guardia del
    // controller (estadoTransaccion === 'completada') es la segunda linea.
    const res = await cobrar({ estado_transaccion: 'reembolsada' });

    assert.strictEqual(res.status, 400);
    await avisosEnviados();
    assert.strictEqual(socket.avisos.length, 0, 'sin dinero cobrado no hay nada que anunciar');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// (D) y (E) Cierres por PATCH de estado: no entra dinero nuevo
// ---------------------------------------------------------------------------

/**
 * Pedido en 'listo' que, al entregarse, se cierra porque ya estaba pagado.
 *
 * estado_pago = 'pagado' es la columna del trigger del script 22: es lo que
 * hace que actualizarEstado aplique la regla de cierre y cierre el pedido.
 */
function responderEntrega() {
  return (sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'listo' }] };
    if (sql.includes("UPDATE pedidos SET estado = 'pagado'")) {
      return {
        rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: 'pagado', estado_pago: 'pagado' }],
      };
    }
    if (sql.includes('UPDATE pedidos SET estado = $1')) {
      return {
        rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: params[0], estado_pago: 'pagado' }],
      };
    }
    return { rows: [] };
  };
}

test('d: entregar un pedido ya pagado cierra y libera, SIN avisar pago', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderEntrega());
  try {
    const res = await request(app)
      .patch(`/api/pedidos/${ID_PEDIDO}/estado`)
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ estado: 'entregado' });

    assert.strictEqual(res.status, 200);

    assert.ok(socket.buscar('/internal/order-status'), 'el pedido pasa a pagado');
    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada);
    assert.strictEqual(liberada.cuerpo.motivo, 'pagada', 'H-22: la mesa se libero por un pago');

    // Lo importante: el pago se registro ANTES, en su propio cobro, y ya se
    // anuncio entonces. Anunciarlo aqui seria dinero que no entro: un pago
    // fantasma que descuadraria el saldo de todas las cajas.
    assert.strictEqual(
      socket.todos('/internal/payment-confirmed').length,
      0,
      'no entra dinero nuevo, no hay pago que anunciar'
    );
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// (F) y (G) Sin pago de por medio: el motivo es 'liberada'
// ---------------------------------------------------------------------------

test('f: cancelar un pedido libera la mesa con motivo liberada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado = $1')) {
      return { rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: params[0] }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post(`/api/pedidos/${ID_PEDIDO}/cancelar`)
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200);

    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada);
    assert.strictEqual(liberada.cuerpo.motivo, 'liberada', 'se anulo, no se pago');
    assert.strictEqual(socket.buscar('/internal/payment-confirmed'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('g: liberar la mesa a mano no manda motivo y no avisa ningun pago', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    (sql) =>
      sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')
        ? { rows: [{ id_mesa: ID_MESA }] }
        : { rows: [] },
    { pedidosAbiertos: 0 }
  );
  try {
    const res = await request(app)
      .post(`/api/mesas/${ID_MESA}/liberar`)
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200);

    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada);
    // Se deja el cuerpo como estaba: 'liberada' es justo el valor por omision
    // del socket-server, asi que mandarlo no cambiaria nada en las pantallas.
    assert.deepStrictEqual(liberada.cuerpo, { id_mesa: ID_MESA });
    assert.strictEqual(socket.buscar('/internal/payment-confirmed'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// (H) Pago en linea: lo anuncia el socket-server, no el backend
// ---------------------------------------------------------------------------

test('h: el pago en linea no manda payment-confirmed desde el backend', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ id_mesa: ID_MESA }] };
    }
    if (sql.includes('SELECT 1 FROM transacciones WHERE referencia_externa')) return { rows: [] };
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente'))  return { rows: [{ saldo_centavos: '0' }] };
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return { rows: [{ id_pedido: ID_PEDIDO, estado: 'entregado', saldo_centavos: '2400000' }] };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      return { rows: [{ id_transaccion: 1, id_pedido: ID_PEDIDO, monto: String(TOTAL) }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/transacciones/internal')
      .set('x-internal-key', CLAVE_FALSA)
      .send({
        referencia_externa: 'SD-5-1760212345678-Qm9vX2E',
        id_transaccion_pasarela: '1132-903100443-27458',
        pasarela: 'wompi',
        id_mesa: ID_MESA,
        comensal: 'Ana',
        modo: 'igual',
        monto_centavos: 2400000,
        moneda: 'COP',
        metodo_pago: 'online',
      });

    assert.strictEqual(res.status, 201);
    await avisosEnviados();

    // El socket-server ya emitio payment:confirmed desde su propio webhook, y
    // lo hace sin pasar por su registro de idempotencia: avisar tambien desde
    // aqui mostraria el mismo pago dos veces en todas las pantallas.
    assert.strictEqual(socket.buscar('/internal/payment-confirmed'), undefined);
    assert.strictEqual(socket.buscar('/internal/mesa-liberada').cuerpo.motivo, 'pagada');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Guardias del notifier que la ruta HTTP no puede alcanzar
// ---------------------------------------------------------------------------

test('un monto de cero o negativo no se envia y queda en el log', async () => {
  const socket = instalarFakeSocket();
  const errores = [];
  const errorOriginal = console.error;
  console.error = (...args) => errores.push(args.join(' '));
  try {
    const r = await socketNotifier.notificarPagoConfirmado({
      id_mesa: ID_MESA,
      monto_centavos: 0,
      saldo_restante_centavos: 0,
    });

    assert.deepStrictEqual(r, { ok: false, motivo: 'MONTO_INVALIDO' });
    assert.strictEqual(socket.avisos.length, 0, 'ni se gasta la peticion: el contrato exige >= 1');
    assert.match(errores.join('\n'), /monto_centavos invalido/, 'queda por que no se envio');
  } finally {
    console.error = errorOriginal;
    socket.restaurar();
  }
});

test('una referencia mas larga que el tope va en null con un warn', async () => {
  const socket = instalarFakeSocket();
  const avisosLog = [];
  const warnOriginal = console.warn;
  console.warn = (...args) => avisosLog.push(args.join(' '));
  try {
    await socketNotifier.notificarPagoConfirmado({
      id_mesa: ID_MESA,
      monto_centavos: 1000000,
      saldo_restante_centavos: 0,
      referencia_externa: 'X'.repeat(socketNotifier.MAX_REFERENCIA_PAGO + 1),
    });

    const { cuerpo } = socket.buscar('/internal/payment-confirmed');
    // Vale mas perder el dato del voucher que el aviso entero: con la
    // referencia larga el socket-server responderia 400 y no emitiria nada. El
    // numero completo sigue en transacciones.referencia_externa.
    assert.strictEqual(cuerpo.referencia_externa, null);
    assert.strictEqual(cuerpo.monto_centavos, 1000000, 'el pago si se anuncia');
    assert.match(avisosLog.join('\n'), /referencia_externa de 256 caracteres/);
  } finally {
    console.warn = warnOriginal;
    socket.restaurar();
  }
});
