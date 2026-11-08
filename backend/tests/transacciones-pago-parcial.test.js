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

// H-07: el body ya no puede traer estos estados, asi que ni se llega a abrir la
// transaccion. La regla de "un pago no efectivo no liquida el pedido" sigue
// viva en el service para el canal interno y para un 'completada' parcial.
for (const estado of ['pendiente', 'fallida', 'reembolsada']) {
  test(`una transaccion '${estado}' se rechaza con 400 y no toca la base`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
    try {
      const res = await cobrar({
        id_pedido: 87,
        monto: TOTAL,
        metodo_pago: 'efectivo',
        estado_transaccion: estado,
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
      assert.strictEqual(db.buscar('obtener_saldo_pendiente'), undefined);
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

// ---------------------------------------------------------------------------
// H-01: el pago se serializa con bloqueos, y siempre en el mismo orden
// ---------------------------------------------------------------------------

test('h-01: el pedido se bloquea con FOR UPDATE antes de insertar el pago', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);
    assert.strictEqual(res.status, 201);

    const bloqueo = db
      .todas('SELECT * FROM pedidos WHERE id_pedido')
      .find((q) => q.sql.includes('FOR UPDATE'));
    assert.ok(bloqueo, 'se bloquea la fila del pedido');

    const orden = db.ejecutadas.map((q) => q.sql);
    const iBloqueo = orden.findIndex((s) => s.includes('FROM pedidos WHERE id_pedido = $1 FOR UPDATE'));
    const iInsert = orden.findIndex((s) => s.includes('INSERT INTO transacciones'));
    const iSaldo = orden.findIndex((s) => s.includes('obtener_saldo_pendiente'));

    assert.ok(iBloqueo >= 0, 'hay bloqueo del pedido');
    assert.ok(iBloqueo < iInsert, 'el bloqueo va ANTES del INSERT del pago');
    assert.ok(iBloqueo < iSaldo, 'y antes de calcular el saldo');
    assert.ok(orden.findIndex((s) => s.includes('BEGIN')) < iBloqueo, 'dentro de la transaccion');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('h-01: el orden de bloqueos es mesa y despues pedido', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    await cobrar(PAGO_COMPLETO);

    const orden = db.ejecutadas.map((q) => q.sql);
    const iMesa = orden.findIndex((s) => s.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE'));
    const iPedido = orden.findIndex((s) => s.includes('FROM pedidos WHERE id_pedido = $1 FOR UPDATE'));

    assert.ok(iMesa >= 0, 'se bloquea la mesa');
    assert.ok(
      iMesa < iPedido,
      'mesa primero y pedido despues: el mismo orden que el pago en linea, para no interbloquearse'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('h-01: un pedido inexistente sigue dando 404 sin bloquear nada', async () => {
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

test('h-01: el estado del historial sale de la relectura bajo bloqueo', async () => {
  const socket = instalarFakeSocket();
  // La primera lectura dice 'listo' y la relectura (ya bloqueada) 'entregado':
  // mientras se esperaba el bloqueo, otro cobro movio el pedido. Lo que vale es
  // lo segundo.
  let leidas = 0;
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      leidas += 1;
      const estado = leidas === 1 ? 'listo' : 'entregado';
      return { rows: [{ ...PEDIDO, estado }] };
    }
    return responderCobro(sql);
  }, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      db.buscar('INSERT INTO historial_estados').params[2],
      'entregado',
      'estado_anterior es el de la fila bloqueada, no el que se vio antes de esperar'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// H-07: el estado de la transaccion lo fija el servidor
// ---------------------------------------------------------------------------

for (const estado of ['reembolsada', 'fallida', 'pendiente']) {
  test(`h-07: estado_transaccion '${estado}' se rechaza con 400`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
    try {
      const res = await cobrar({ ...PAGO_COMPLETO, estado_transaccion: estado });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /El estado del pago lo fija el servidor/);
      assert.match(res.body.error, /reembolso no se registra por esta ruta/);
      assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test("h-07: 'completada' se sigue aceptando por compatibilidad", async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar({ ...PAGO_COMPLETO, estado_transaccion: 'completada' });

    assert.strictEqual(res.status, 201, 'es lo que ya manda el panel');
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[3], 'completada');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('h-07: sin el campo se registra como completada, igual que antes', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[3], 'completada');
    assert.ok(db.buscar("UPDATE pedidos SET estado = 'pagado'"), 'y liquida el pedido');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('h-07: un valor inventado tambien se rechaza', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar({ ...PAGO_COMPLETO, estado_transaccion: 'anulada_por_el_cajero' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('h-07: el abono parcial sigue funcionando sin tocar el estado', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 46000 });
  try {
    const res = await cobrar({ id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 201, 'lo de #35 no se rompe');
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[3], 'completada');
    assert.strictEqual(db.buscar("UPDATE pedidos SET estado = 'pagado'"), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-11: quién puede cobrar
//
// La matriz de roles (tests/matriz-roles.test.js) ya comprueba el 401 y el 403
// de estas dos rutas. Lo que se añade aquí es lo que la matriz no puede decir:
// que la guarda para ANTES de tocar la base. En una ruta que mueve dinero no
// basta con que la respuesta sea 403; importa que no se haya abierto una
// transacción, leído un pedido ni insertado nada en el camino.
// ---------------------------------------------------------------------------

/** Roles que NO pueden cobrar: solo admin y cajero manejan dinero. */
const ROLES_SIN_CAJA = ['mesero', 'cocina'];

for (const rol of ROLES_SIN_CAJA) {
  test(`d-11: ${rol} no puede cobrar y no se toca la base`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro);
    try {
      const res = await request(app)
        .post('/api/transacciones')
        .set('Authorization', `Bearer ${tokenStaff(6, rol)}`)
        .send(PAGO_COMPLETO);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined, 'no se registró el cobro');
      assert.strictEqual(db.buscar('SELECT * FROM pedidos WHERE id_pedido'), undefined, 'no se leyó el pedido');
      assert.strictEqual(db.buscar('BEGIN'), undefined, 'no se abrió transacción');
      assert.strictEqual(socket.avisos.length, 0, 'no se avisó al socket-server');
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });

  test(`d-11: ${rol} tampoco puede leer las transacciones de un pedido`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responderCobro);
    try {
      const res = await request(app)
        .get('/api/transacciones/pedido/87')
        .set('Authorization', `Bearer ${tokenStaff(6, rol)}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(db.buscar('FROM transacciones'), undefined, 'no se consultó nada');
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('d-11: sin token no se cobra y no se toca la base', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const res = await request(app).post('/api/transacciones').send(PAGO_COMPLETO);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
    assert.strictEqual(db.buscar('BEGIN'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('d-11: la ruta del personal no se abre con la clave interna', async () => {
  // POST /api/transacciones y POST /api/transacciones/internal son dos puertas
  // distintas al mismo recurso: la del personal pide JWT y la del socket-server
  // pide la clave compartida. Cada una exige SU credencial, no la otra.
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('x-internal-key', 'clave-interna-de-prueba')
      .send(PAGO_COMPLETO);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Token no proporcionado');
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('d-11: el cajero sigue pudiendo cobrar', async () => {
  // Control de la batería: si los 403 de arriba vinieran de otra causa, esto
  // lo delata.
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro, { saldoTrasPago: 0 });
  try {
    const res = await cobrar(PAGO_COMPLETO);

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar('INSERT INTO transacciones'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
