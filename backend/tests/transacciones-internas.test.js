const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');

// POST /api/transacciones/internal (EVENTS.md §8.4): el socket-server registra
// un pago que Wompi ya cobro. El pago es DE LA MESA y se reparte entre sus
// pedidos abiertos, del mas viejo al mas nuevo, en una sola transaccion.

const RUTA = '/api/transacciones/internal';
const ID_MESA = 5;

const PAGO = {
  referencia_externa: 'SD-5-1760212345678-Qm9vX2E',
  id_transaccion_pasarela: '1132-903100443-27458',
  pasarela: 'wompi',
  id_mesa: ID_MESA,
  comensal: 'Ana',
  modo: 'igual',
  monto_centavos: 3000000,
  moneda: 'COP',
  metodo_pago: 'online',
};

const enviar = (cuerpo = PAGO) =>
  request(app).post(RUTA).set('x-internal-key', CLAVE_FALSA).send(cuerpo);

/**
 * Doble de la base para el reparto.
 *
 * @param {{pedidos?: Array<{id_pedido:number, estado:string, saldo_centavos:number}>,
 *          yaRegistrada?: boolean, saldoFinal?: number, chocaIndice?: boolean,
 *          mesaExiste?: boolean, pedidosAbiertosTrasPago?: number}} opciones
 */
function responderPagos(opciones = {}) {
  const {
    pedidos = [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 3000000 }],
    yaRegistrada = false,
    saldoFinal = null,
    chocaIndice = false,
    mesaExiste = true,
  } = opciones;

  // Saldo que se devuelve al final: si no se fija, el que quede de restar el
  // pago al saldo de los pedidos.
  const saldoInicial = pedidos.reduce((s, p) => s + p.saldo_centavos, 0);

  let yaPago = false;

  return (sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return mesaExiste ? { rows: [{ id_mesa: ID_MESA }] } : { rows: [] };
    }
    if (sql.includes('SELECT 1 FROM transacciones WHERE referencia_externa')) {
      return yaRegistrada ? { rows: [{ '?column?': 1 }] } : { rows: [] };
    }
    // El saldo de la mesa (con SUM) va antes que el listado de pedidos: las dos
    // consultas mencionan obtener_saldo_pendiente.
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente')) {
      if (saldoFinal !== null) return { rows: [{ saldo_centavos: String(saldoFinal) }] };
      const restante = yaPago ? Math.max(0, saldoInicial - PAGO.monto_centavos) : saldoInicial;
      return { rows: [{ saldo_centavos: String(restante) }] };
    }
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return {
        rows: pedidos.map((p) => ({
          id_pedido: p.id_pedido,
          estado: p.estado,
          saldo_centavos: String(p.saldo_centavos),
        })),
      };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      if (chocaIndice) {
        const err = new Error(
          'duplicate key value violates unique constraint "uq_transacciones_referencia_externa"'
        );
        err.code = '23505';
        throw err;
      }
      yaPago = true;
      return { rows: [] };
    }
    return { rows: [] };
  };
}

// ---------------------------------------------------------------------------
// Pago total de un pedido entregado
// ---------------------------------------------------------------------------

test('un pago que liquida un pedido entregado lo marca pagado y libera la mesa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, {
      ok: true,
      duplicado: false,
      saldo_restante_centavos: 0,
      mesa_liberada: true,
    });

    const insert = db.buscar('INSERT INTO transacciones');
    assert.ok(insert);
    assert.strictEqual(insert.params[0], 87, 'id_pedido');
    assert.strictEqual(insert.params[1], 'online', 'metodo_pago');
    assert.strictEqual(insert.params[2], 3000000, 'el monto viaja en centavos');
    assert.strictEqual(insert.params[3], PAGO.referencia_externa, 'la primera fila lleva la referencia tal cual');
    assert.strictEqual(insert.params[4], 'Ana', 'comensal');
    assert.ok(
      insert.sql.includes('($3::bigint)::numeric / 100'),
      'los pesos se calculan en SQL desde los centavos'
    );
    assert.ok(insert.sql.includes("'completada'"), 'la transaccion queda completada');

    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"));
    const historial = db.buscar('INSERT INTO historial_estados');
    assert.strictEqual(historial.params[1], 'entregado', 'estado_anterior');
    assert.ok(historial.sql.includes('NULL'), 'id_usuario va NULL: no lo cobro una persona');
    assert.ok(historial.sql.includes('Pago en linea'));

    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('los avisos al socket salen despues del COMMIT', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    await enviar();

    const estado = socket.buscar('/internal/order-status');
    assert.ok(estado, 'se avisa el cambio a pagado');
    assert.strictEqual(estado.cuerpo.id_pedido, 87);
    assert.strictEqual(estado.cuerpo.id_mesa, ID_MESA);
    assert.strictEqual(estado.cuerpo.estado, 'pagado');
    assert.strictEqual(estado.cuerpo.estado_anterior, 'entregado');

    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada, 'se avisa la liberacion de la mesa');
    assert.strictEqual(liberada.cuerpo.id_mesa, ID_MESA);
    assert.strictEqual(liberada.cuerpo.motivo, 'pagada', 'el motivo del contrato §8.3');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('si el socket-server esta caido el pago queda registrado igual', async () => {
  const socket = instalarFakeSocket(socketCaido);
  const db = instalarFakeDb(responderPagos());
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201, 'el tiempo real no decide si el pago vale');
    assert.strictEqual(res.body.mesa_liberada, true);
    assert.ok(db.buscar('COMMIT'), 'el pago se confirmo en la base');
    assert.strictEqual(db.buscar('ROLLBACK'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Pago parcial
// ---------------------------------------------------------------------------

test('un pago parcial se registra pero no marca el pedido pagado ni libera la mesa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({ pedidos: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 9000000 }] })
  );
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.saldo_restante_centavos, 6000000, 'quedan 60.000 pesos');
    assert.strictEqual(res.body.mesa_liberada, false);

    assert.ok(db.buscar('INSERT INTO transacciones'), 'el pago parcial se guarda');
    assert.strictEqual(
      db.buscar("UPDATE pedidos SET estado = 'pagado'"),
      undefined,
      'con saldo pendiente el pedido sigue abierto'
    );
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un pedido que llega a cero pero no esta entregado no pasa a pagado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({ pedidos: [{ id_pedido: 87, estado: 'en_preparacion', saldo_centavos: 3000000 }] })
  );
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201, 'el pago se registra');
    assert.strictEqual(res.body.mesa_liberada, false);
    assert.strictEqual(
      db.buscar("UPDATE pedidos SET estado = 'pagado'"),
      undefined,
      'el trigger solo deja pagado desde entregado: no se intenta'
    );
    assert.strictEqual(socket.buscar('/internal/order-status'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reparto entre varios pedidos
// ---------------------------------------------------------------------------

test('un pago se reparte entre dos pedidos, del mas viejo al mas nuevo', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({
      pedidos: [
        { id_pedido: 80, estado: 'entregado', saldo_centavos: 1000000 },
        { id_pedido: 87, estado: 'entregado', saldo_centavos: 5000000 },
      ],
      saldoFinal: 3000000,
    }),
    { pedidosAbiertos: 1 }
  );
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201);

    const inserts = db.todas('INSERT INTO transacciones');
    assert.strictEqual(inserts.length, 2, 'una fila por pedido');

    assert.strictEqual(inserts[0].params[0], 80, 'primero el pedido mas viejo');
    assert.strictEqual(inserts[0].params[2], 1000000, 'se le aplica todo su saldo');
    assert.strictEqual(inserts[0].params[3], PAGO.referencia_externa);

    assert.strictEqual(inserts[1].params[0], 87);
    assert.strictEqual(inserts[1].params[2], 2000000, 'al siguiente, el resto');
    assert.strictEqual(
      inserts[1].params[3],
      `${PAGO.referencia_externa}#2`,
      'el indice unico de la referencia obliga a sufijar las filas siguientes'
    );

    assert.strictEqual(
      inserts[0].params[2] + inserts[1].params[2],
      PAGO.monto_centavos,
      'el reparto suma exactamente el monto cobrado'
    );

    // El pedido viejo queda liquidado; el nuevo conserva saldo.
    assert.strictEqual(db.todas("UPDATE pedidos SET estado = 'pagado'").length, 1);
    assert.strictEqual(res.body.mesa_liberada, false, 'queda un pedido abierto');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un monto no divisible se reparte completo, llenando primero el pedido mas antiguo', async () => {
  const socket = instalarFakeSocket();
  // Tres pedidos abiertos con saldos que no dividen el monto de forma exacta.
  const db = instalarFakeDb(
    responderPagos({
      pedidos: [
        { id_pedido: 70, estado: 'entregado', saldo_centavos: 1000033 },
        { id_pedido: 80, estado: 'entregado', saldo_centavos: 1000033 },
        { id_pedido: 87, estado: 'entregado', saldo_centavos: 1000034 },
      ],
      saldoFinal: 1,
    }),
    { pedidosAbiertos: 1 }
  );
  try {
    // 30.000,99 pesos: un tercio exacto no existe en centavos.
    const monto = 3000099;
    const res = await enviar({ ...PAGO, monto_centavos: monto });

    assert.strictEqual(res.status, 201);

    const inserts = db.todas('INSERT INTO transacciones');
    const repartido = inserts.map((q) => q.params[2]);

    assert.strictEqual(
      repartido.reduce((suma, x) => suma + x, 0),
      monto,
      'la suma de lo repartido es EXACTAMENTE el monto cobrado: ni un centavo de mas ni de menos'
    );

    // El mas antiguo se llena hasta su saldo antes de pasar al siguiente, asi
    // que el "sobrante" cae siempre hacia los primeros, no se promedia.
    assert.deepStrictEqual(
      inserts.map((q) => q.params[0]),
      [70, 80, 87],
      'del mas viejo al mas nuevo'
    );
    assert.deepStrictEqual(repartido, [1000033, 1000033, 1000033]);

    // Y las referencias no se repiten, por el indice unico.
    assert.deepStrictEqual(
      inserts.map((q) => q.params[3]),
      [PAGO.referencia_externa, `${PAGO.referencia_externa}#2`, `${PAGO.referencia_externa}#3`]
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un monto que cubre dos pedidos y parte del tercero no deja centavos sueltos', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({
      pedidos: [
        { id_pedido: 70, estado: 'entregado', saldo_centavos: 777 },
        { id_pedido: 80, estado: 'entregado', saldo_centavos: 333 },
        { id_pedido: 87, estado: 'entregado', saldo_centavos: 10000 },
      ],
      saldoFinal: 9889,
    }),
    { pedidosAbiertos: 1 }
  );
  try {
    const monto = 1221; // 777 + 333 + 111
    const res = await enviar({ ...PAGO, monto_centavos: monto });

    assert.strictEqual(res.status, 201);

    const inserts = db.todas('INSERT INTO transacciones');
    assert.deepStrictEqual(
      inserts.map((q) => [q.params[0], q.params[2]]),
      [[70, 777], [80, 333], [87, 111]],
      'cada pedido recibe hasta su saldo y el resto pasa al siguiente'
    );
    assert.strictEqual(
      inserts.reduce((suma, q) => suma + q.params[2], 0),
      monto
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un monto de un solo centavo va al pedido mas antiguo', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({
      pedidos: [
        { id_pedido: 70, estado: 'entregado', saldo_centavos: 5000 },
        { id_pedido: 87, estado: 'entregado', saldo_centavos: 5000 },
      ],
      saldoFinal: 9999,
    }),
    { pedidosAbiertos: 1 }
  );
  try {
    const res = await enviar({ ...PAGO, monto_centavos: 1 });

    assert.strictEqual(res.status, 201);
    const inserts = db.todas('INSERT INTO transacciones');
    assert.strictEqual(inserts.length, 1, 'no se abren filas de 0 centavos para los demas pedidos');
    assert.deepStrictEqual([inserts[0].params[0], inserts[0].params[2]], [70, 1]);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el ordenamiento del reparto lo hace la base, por fecha de creacion', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    await enviar();
    const consulta = db.buscar('obtener_saldo_pendiente(p.id_pedido) * 100');
    assert.ok(consulta.sql.includes('ORDER BY p.creado_en ASC, p.id_pedido ASC'));
    assert.ok(consulta.sql.includes("p.estado <> 'cancelado'"), 'los cancelados no cuentan');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test('la misma referencia_externa responde 200 duplicado sin registrar nada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos({ yaRegistrada: true, saldoFinal: 6000000 }));
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 200, 'un reintento de Wompi no es un error');
    assert.deepStrictEqual(res.body, {
      ok: true,
      duplicado: true,
      saldo_restante_centavos: 6000000,
      mesa_liberada: false,
    });
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined, 'no se cobra dos veces');
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(socket.buscar('/internal/order-status'), undefined, 'ya se aviso la primera vez');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('si el INSERT choca con el indice unico (23505) cuenta como duplicado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos({ chocaIndice: true, saldoFinal: 6000000 }));
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 200, 'la carrera la resuelve el indice, no es un 500');
    assert.strictEqual(res.body.duplicado, true);
    assert.strictEqual(res.body.saldo_restante_centavos, 6000000);
    assert.ok(db.buscar('ROLLBACK'), 'lo escrito a medias se revierte');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Rechazos
// ---------------------------------------------------------------------------

test('un pago que excede el saldo de la mesa responde 409 y no registra nada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({ pedidos: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 1000000 }] })
  );
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /excede el saldo/);
    assert.strictEqual(res.body.saldo_centavos, 1000000, 'se dice cual es el saldo real');
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('una mesa inexistente responde 404', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos({ mesaExiste: false }));
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('una mesa sin cuenta abierta responde 409', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos({ pedidos: [], saldoFinal: 0 }));
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /no tiene una cuenta abierta/);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('los pedidos sin saldo no reciben parte del pago', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    responderPagos({
      pedidos: [
        { id_pedido: 80, estado: 'pagado', saldo_centavos: 0 },
        { id_pedido: 87, estado: 'entregado', saldo_centavos: 3000000 },
      ],
      saldoFinal: 0,
    })
  );
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 201);
    const inserts = db.todas('INSERT INTO transacciones');
    assert.strictEqual(inserts.length, 1, 'solo el pedido con saldo');
    assert.strictEqual(inserts[0].params[0], 87);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un error de trigger de la base sale como 409 con su mensaje', async () => {
  const socket = instalarFakeSocket();
  const mensaje = 'El monto de la transacción debe ser mayor a 0 (recibido: 0.00)';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO transacciones')) {
      const err = new Error(mensaje);
      err.code = 'P0001';
      throw err;
    }
    return responderPagos()(sql);
  });
  try {
    const res = await enviar();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Validacion del cuerpo
// ---------------------------------------------------------------------------

test('sin la clave interna responde 401 aunque el cuerpo sea valido', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    const res = await request(app).post(RUTA).send(PAGO);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

for (const [caso, parche] of [
  ['moneda distinta de COP', { moneda: 'USD' }],
  ['monto_centavos en cero', { monto_centavos: 0 }],
  ['monto_centavos negativo', { monto_centavos: -100 }],
  ['monto_centavos con decimales', { monto_centavos: 150.5 }],
  ['sin referencia_externa', { referencia_externa: undefined }],
  ['metodo_pago inexistente', { metodo_pago: 'cripto' }],
]) {
  test(`${caso}: 400 y no se toca la base`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderPagos());
    try {
      const res = await enviar({ ...PAGO, ...parche });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('comensal puede venir null (pago de la mesa completa)', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    const res = await enviar({ ...PAGO, comensal: null });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[4], null);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('metodo_pago por omision es online', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderPagos());
  try {
    const { metodo_pago, ...sinMetodo } = PAGO;
    const res = await enviar(sinMetodo);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[1], 'online');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
