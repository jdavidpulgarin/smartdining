const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');
const ctrl = require('../src/controllers/transacciones.controller');
const autorInexistente = require('../src/services/autor-inexistente');

// POST /api/transacciones/mesa: la caja cobra un monto A LA MESA y se reparte
// entre sus pedidos con saldo, del mas viejo al mas nuevo, con el mismo nucleo
// que el pago en linea. Pedido de Jarrison tras la prueba de punta a punta: la
// Caja cobraba siempre al primer pedido.
//
// Aqui: roles, validacion, centavos sin coma flotante, mapeo de cada salida y
// los avisos. El reparto real, la idempotencia, las carreras y el autor contra
// PostgreSQL estan en tests/integracion/transacciones-mesa-sql.test.js.

const RUTA = '/api/transacciones/mesa';
const ID_MESA = 5;
const ID_COBRO = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';

const CUERPO = { id_mesa: ID_MESA, monto: 30000, metodo_pago: 'efectivo', id_cobro: ID_COBRO };

const cajero = () => tokenStaff(4, 'cajero');

const cobrar = (cuerpo = CUERPO, token = cajero()) => {
  const req = request(app).post(RUTA).send(cuerpo);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

/**
 * Doble de la base para el nucleo del reparto.
 * @param {{pedidos?: Array<{id_pedido:number, estado:string, saldo_centavos:number}>,
 *          yaRegistrada?: boolean, mesaExiste?: boolean, error?: Error, fallaEn?: string}} o
 */
function fakeCobro(o = {}) {
  const {
    pedidos = [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 3000000 }],
    yaRegistrada = false,
    mesaExiste = true,
    error = null,
    fallaEn = 'INSERT INTO historial_estados',
    // Consumo y pagos por comensal (SQL_CUENTA_POR_COMENSAL), en centavos.
    // Por omisión Ana consumió todo el saldo de la mesa y no ha pagado nada.
    cuentaPorComensal = null,
  } = o;
  const saldoInicial = pedidos.reduce((s, p) => s + p.saldo_centavos, 0);
  const filasCuenta = cuentaPorComensal || [{ tipo: 'consumo', comensal: 'Ana', centavos: saldoInicial }];
  let cobrado = 0;
  let siguienteId = 500;

  return instalarFakeDb((sql, params) => {
    if (error && sql.includes(fallaEn)) throw error;
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return mesaExiste ? { rows: [{ id_mesa: ID_MESA }] } : { rows: [] };
    }
    if (sql.includes('SELECT 1 FROM transacciones WHERE referencia_externa')) {
      return yaRegistrada ? { rows: [{ '?column?': 1 }] } : { rows: [] };
    }
    if (sql.includes("'consumo'::text AS tipo")) {
      return { rows: filasCuenta.map((f) => ({ ...f, centavos: String(f.centavos) })) };
    }
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente')) {
      return { rows: [{ saldo_centavos: String(saldoInicial - cobrado) }] };
    }
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return { rows: pedidos.map((p) => ({ ...p, saldo_centavos: String(p.saldo_centavos) })) };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      cobrado += params[2];
      siguienteId += 1;
      return { rows: [{ id_transaccion: siguienteId, id_pedido: params[0], monto: String(params[2] / 100), comensal: params[4] }] };
    }
    // liberarSiNoQuedanPedidosAbiertos: cero pedidos abiertos, y la mesa cambia.
    if (sql.includes('count(*)::int AS n FROM pedidos')) return { rows: [{ n: 0 }] };
    if (sql.includes('UPDATE mesas SET estado')) return { rows: [{ id_mesa: ID_MESA }] };
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('cobro de mesa: sin token responde 401', async () => {
  const db = fakeCobro();
  try {
    assert.strictEqual((await cobrar(CUERPO, null)).status, 401);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['mesero', 'cocina']) {
  test(`cobro de mesa: ${rol} responde 403 y no toca la base`, async () => {
    const db = fakeCobro();
    try {
      assert.strictEqual((await cobrar(CUERPO, tokenStaff(3, rol))).status, 403);
      assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
    } finally {
      db.restaurar();
    }
  });
}

test('cobro de mesa: un comensal responde 403', async () => {
  const db = fakeCobro();
  try {
    assert.strictEqual((await cobrar(CUERPO, tokenComensal(ID_MESA))).status, 403);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['admin', 'cajero']) {
  test(`cobro de mesa: ${rol} responde 201 con la forma del contrato`, async () => {
    const socket = instalarFakeSocket(() => ({ ok: true }));
    const db = fakeCobro();
    try {
      const res = await cobrar(CUERPO, tokenStaff(rol === 'admin' ? 1 : 4, rol));

      assert.strictEqual(res.status, 201);
      assert.deepStrictEqual(Object.keys(res.body).sort(), ['duplicado', 'mesa_liberada', 'pagados', 'saldo_restante', 'transacciones']);
      assert.strictEqual(res.body.duplicado, false);
      assert.strictEqual(res.body.saldo_restante, 0);
      assert.strictEqual(typeof res.body.saldo_restante, 'number');
      assert.strictEqual(res.body.mesa_liberada, true);
      assert.deepStrictEqual(res.body.pagados, [87]);
      assert.deepStrictEqual(res.body.transacciones, [
        // voucher: script 35; en efectivo siempre null.
        { id_transaccion: 501, id_pedido: 87, monto: 30000, comensal: null, voucher: null },
      ]);
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// Validacion del cuerpo
// ---------------------------------------------------------------------------

for (const [caso, cuerpo] of [
  ['monto con 3 decimales', { ...CUERPO, monto: 10.123 }],
  ['monto 0', { ...CUERPO, monto: 0 }],
  ['monto negativo', { ...CUERPO, monto: -5 }],
  ['monto como texto', { ...CUERPO, monto: '30000' }],
  ['monto mayor que DECIMAL(10,2)', { ...CUERPO, monto: 100000000 }],
  ["metodo 'online' (es de Wompi)", { ...CUERPO, metodo_pago: 'online' }],
  ['metodo inventado', { ...CUERPO, metodo_pago: 'bitcoin' }],
  ['id_cobro que no es UUID', { ...CUERPO, id_cobro: 'cobro-1' }],
  ['sin id_cobro', { id_mesa: ID_MESA, monto: 1000, metodo_pago: 'efectivo' }],
  ['id_mesa 0', { ...CUERPO, id_mesa: 0 }],
  ['id_mesa decimal', { ...CUERPO, id_mesa: 1.5 }],
  ['comensal vacio', { ...CUERPO, comensal: '' }],
  ['comensal de 41 caracteres', { ...CUERPO, comensal: 'A'.repeat(41) }],
  ['un campo extra', { ...CUERPO, propina: 3000 }],
  ['un id_pedido (no es por pedido)', { ...CUERPO, id_pedido: 87 }],
]) {
  test(`cobro de mesa: ${caso} -> 400 cuerpo_invalido sin tocar la base`, async () => {
    const db = fakeCobro();
    try {
      const res = await cobrar(cuerpo);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(typeof res.body.error, 'string');
      assert.strictEqual(res.body.motivo, ctrl.MOTIVO_CUERPO_INVALIDO);
      assert.strictEqual(db.todas('BEGIN').length, 0);
    } finally {
      db.restaurar();
    }
  });
}

test('cobro de mesa: los metodos de la caja son los de la tabla menos online', () => {
  assert.deepStrictEqual(ctrl.METODOS_CAJA, ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia']);
});

// ---------------------------------------------------------------------------
// Centavos sin coma flotante
// ---------------------------------------------------------------------------

test('cobro de mesa: pesos -> centavos enteros sin errores de coma flotante', () => {
  // Todos estos fallan con Math.floor(x * 100) y varios con x * 100 a secas.
  assert.strictEqual(1.15 * 100 === 115, false, 'la trampa existe: 1.15 * 100 no es 115');
  assert.strictEqual(ctrl.montoACentavos(1.15), 115);
  assert.strictEqual(ctrl.montoACentavos(0.29), 29);
  assert.strictEqual(ctrl.montoACentavos(0.1 + 0.2 === 0.3 ? 0.3 : 0.3), 30);
  assert.strictEqual(ctrl.montoACentavos(4.35), 435);
  assert.strictEqual(ctrl.montoACentavos(1005.1), 100510);
  assert.strictEqual(ctrl.montoACentavos(0.01), 1);
  assert.strictEqual(ctrl.montoACentavos(30000), 3000000);
  assert.strictEqual(ctrl.montoACentavos(99999999.99), 9999999999);
  // 0.1 + 0.2 como numero es 0.30000000000000004: tiene mas de 2 decimales.
  assert.strictEqual(ctrl.montoACentavos(0.1 + 0.2), null);
  assert.strictEqual(ctrl.montoACentavos(10.123), null);
  assert.strictEqual(ctrl.montoACentavos(1e21), null);
  assert.strictEqual(ctrl.montoACentavos(100000000), null);
});

test('cobro de mesa: el monto viaja a la base en centavos enteros (1005.1 -> 100510)', async () => {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = fakeCobro({ pedidos: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 200000 }] });
  try {
    const res = await cobrar({ ...CUERPO, monto: 1005.1 });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO transacciones');
    assert.strictEqual(insert.params[2], 100510);
    assert.ok(insert.sql.includes('($3::bigint)::numeric / 100'), 'los pesos se calculan en SQL');
    assert.strictEqual(res.body.transacciones[0].monto, 1005.1);
    assert.strictEqual(res.body.saldo_restante, 994.9);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lo que se manda a la base
// ---------------------------------------------------------------------------

test("cobro de mesa: referencia 'caja:' + id_cobro, autor del JWT y 'Pago en caja'", async () => {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = fakeCobro();
  try {
    await cobrar({ ...CUERPO, comensal: 'Ana' }, tokenStaff(4, 'cajero'));

    const insert = db.buscar('INSERT INTO transacciones');
    assert.strictEqual(insert.params[3], `caja:${ID_COBRO}`);
    assert.strictEqual(insert.params[4], 'Ana');
    assert.strictEqual(insert.params[1], 'efectivo');
    const historial = db.buscar('INSERT INTO historial_estados');
    assert.deepStrictEqual(historial.params, [87, 'entregado', 4], 'id_pedido, estado_anterior, id_usuario del JWT');
    assert.ok(historial.sql.includes("'Pago en caja'"));
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Mapeo de cada salida
// ---------------------------------------------------------------------------

test('cobro de mesa: mesa inexistente -> 404 mesa_inexistente', async () => {
  const db = fakeCobro({ mesaExiste: false });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.motivo, 'mesa_inexistente');
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

test('cobro de mesa: sin pedidos con saldo -> 409 sin_cuenta', async () => {
  const db = fakeCobro({ pedidos: [] });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVO_SIN_CUENTA);
    assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
  } finally {
    db.restaurar();
  }
});

test('cobro de mesa: mas que el saldo -> 409 excede con el saldo en pesos', async () => {
  const db = fakeCobro({ pedidos: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 2000050 }] });
  try {
    const res = await cobrar({ ...CUERPO, monto: 30000 });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVO_EXCEDE);
    assert.strictEqual(res.body.saldo, 20000.5);
    assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
    assert.strictEqual(db.todas('COMMIT').length, 0);
  } finally {
    db.restaurar();
  }
});

test('cobro de mesa: el mismo id_cobro otra vez -> 200 duplicado sin cobrar ni avisar', async () => {
  const llamadas = [];
  const socket = instalarFakeSocket((ruta) => { llamadas.push(ruta); return { ok: true }; });
  const db = fakeCobro({ yaRegistrada: true });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { duplicado: true, saldo_restante: 30000 });
    assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(llamadas, [], 'ningun aviso');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('cobro de mesa: carrera con el mismo id_cobro (23505) -> 200 duplicado', async () => {
  const choque = new Error('duplicate key value violates unique constraint "uq_transacciones_referencia_externa"');
  choque.code = '23505';
  const db = fakeCobro({ error: choque, fallaEn: 'INSERT INTO transacciones' });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.duplicado, true);
  } finally {
    db.restaurar();
  }
});

test('cobro de mesa: autor borrado (23503 fk_historial_usuario) -> 409 autor_inexistente', async () => {
  const err = new Error('viola la llave foranea «fk_historial_usuario»');
  err.code = '23503';
  err.constraint = 'fk_historial_usuario';
  const db = fakeCobro({ error: err });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
    assert.strictEqual(res.body.error, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(db.todas('COMMIT').length, 0, 'la transaccion se deshace entera');
  } finally {
    db.restaurar();
  }
});

test('cobro de mesa: otro 23503 sigue siendo el 409 generico, sin motivo de autor', async () => {
  const err = new Error('viola la llave foranea «fk_transacciones_pedido»');
  err.code = '23503';
  err.constraint = 'fk_transacciones_pedido';
  const db = fakeCobro({ error: err, fallaEn: 'INSERT INTO transacciones' });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 409);
    assert.notStrictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Avisos de tiempo real: los mismos que el cobro en caja de POST /transacciones
// ---------------------------------------------------------------------------

test('cobro de mesa: payment:confirmed, order:status por pedido pagado y mesa:liberada, en ese orden', async () => {
  const llamadas = [];
  const socket = instalarFakeSocket((ruta, cuerpo) => { llamadas.push({ ruta, cuerpo }); return { ok: true }; });
  const db = fakeCobro({
    pedidos: [
      { id_pedido: 87, estado: 'entregado', saldo_centavos: 1000000 },
      { id_pedido: 88, estado: 'entregado', saldo_centavos: 2000000 },
    ],
  });
  try {
    const res = await cobrar({ ...CUERPO, comensal: 'Ana' });
    assert.strictEqual(res.status, 201);
    for (let i = 0; i < 20 && llamadas.length < 4; i++) await new Promise((r) => setImmediate(r));

    assert.deepStrictEqual(llamadas.map((l) => l.ruta), [
      '/internal/payment-confirmed',
      '/internal/order-status',
      '/internal/order-status',
      '/internal/mesa-liberada',
    ]);
    const pago = llamadas[0].cuerpo;
    assert.strictEqual(pago.id_mesa, ID_MESA);
    assert.strictEqual(pago.monto_centavos, 3000000, 'UN aviso por el cobro entero');
    assert.strictEqual(pago.saldo_restante_centavos, 0);
    assert.strictEqual(pago.comensal, 'Ana');
    assert.strictEqual(pago.referencia_externa, `caja:${ID_COBRO}`);
    assert.strictEqual(pago.id_transaccion, 501, 'la primera fila del reparto');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('cobro de mesa: un pago parcial avisa el pago y nada mas', async () => {
  const llamadas = [];
  const socket = instalarFakeSocket((ruta) => { llamadas.push(ruta); return { ok: true }; });
  const db = fakeCobro();
  try {
    const res = await cobrar({ ...CUERPO, monto: 10000 });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body.pagados, []);
    assert.strictEqual(res.body.mesa_liberada, false);
    assert.strictEqual(res.body.saldo_restante, 20000);
    for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(llamadas, ['/internal/payment-confirmed']);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// «Pagar lo mío»: el monto no supera el saldo PROPIO de ese comensal
// ---------------------------------------------------------------------------

// Mesa con 52.000 por cobrar: Caro 28.000 y Beto 24.000 vivos. Ana tenía
// 12.000, pero el mesero le canceló el plato (la consulta ya no lo trae).
const MESA_JARRISON = [{ id_pedido: 87, estado: 'entregado', saldo_centavos: 5200000 }];
const SIN_PLATOS_DE_ANA = [
  { tipo: 'consumo', comensal: 'Caro', centavos: 2800000 },
  { tipo: 'consumo', comensal: 'Beto', centavos: 2400000 },
];
const CON_ANA = [
  { tipo: 'consumo', comensal: 'Ana', centavos: 1200000 },
  ...SIN_PLATOS_DE_ANA,
];

for (const [caso, opciones, monto, saldo] of [
  ['Ana sin platos vivos (saldo propio 0)', { cuentaPorComensal: SIN_PLATOS_DE_ANA }, 12000, 0],
  ['Ana debe 12.000 y se cobran 15.000', { cuentaPorComensal: CON_ANA }, 15000, 12000],
  ['Ana debe 12.000 pero ya pagó 5.000 y se cobran 12.000',
    { cuentaPorComensal: [...CON_ANA, { tipo: 'pagado', comensal: 'Ana', centavos: 500000 }] }, 12000, 7000],
]) {
  test(`lo mio: ${caso} -> 409 excede_saldo_comensal con su saldo, sin escribir`, async () => {
    const db = fakeCobro({ pedidos: MESA_JARRISON, ...opciones });
    try {
      const res = await cobrar({ ...CUERPO, monto, comensal: 'Ana' });
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body, {
        error: 'El pago excede lo que debe ese comensal',
        motivo: 'excede_saldo_comensal',
        saldo,
      });
      assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
      assert.ok(db.buscar('ROLLBACK'));
    } finally {
      db.restaurar();
    }
  });
}

test('lo mio: Ana debe 12.000 y se cobran 12.000 -> 201', async () => {
  const db = fakeCobro({ pedidos: MESA_JARRISON, cuentaPorComensal: CON_ANA });
  try {
    const res = await cobrar({ ...CUERPO, monto: 12000, comensal: 'Ana' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(db.todas('INSERT INTO transacciones').length, 1);
  } finally {
    db.restaurar();
  }
});

test('lo mio: el alias se compara por su clave (« aná » en la base, «Ana» en el cobro)', async () => {
  const db = fakeCobro({
    pedidos: MESA_JARRISON,
    cuentaPorComensal: [{ tipo: 'consumo', comensal: ' aná ', centavos: 1200000 }, ...SIN_PLATOS_DE_ANA],
  });
  try {
    assert.strictEqual((await cobrar({ ...CUERPO, monto: 12000, comensal: 'Ana' })).status, 201);
  } finally {
    db.restaurar();
  }
});

for (const [caso, comensal] of [['sin comensal (mesa completa)', undefined], ['a «General»', 'General'], ['comensal null', null]]) {
  test(`lo mio: un cobro ${caso} sigue igual: solo el saldo de la mesa, sin mirar la cuenta por comensal`, async () => {
    const db = fakeCobro({ pedidos: MESA_JARRISON, cuentaPorComensal: SIN_PLATOS_DE_ANA });
    try {
      const cuerpo = { ...CUERPO, monto: 52000 };
      if (comensal !== undefined) cuerpo.comensal = comensal;
      const res = await cobrar(cuerpo);
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(db.buscar("'consumo'::text AS tipo"), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('lo mio: la cuenta por comensal se lee DESPUES de bloquear la mesa y los pedidos, y sin lineas canceladas', async () => {
  const db = fakeCobro({ pedidos: MESA_JARRISON, cuentaPorComensal: CON_ANA });
  try {
    assert.strictEqual((await cobrar({ ...CUERPO, monto: 12000, comensal: 'Ana' })).status, 201);
    const sqls = db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    const iCuenta = i("'consumo'::text AS tipo");
    assert.ok(i('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE') < i('ORDER BY id_pedido ASC'), 'mesa antes que pedidos');
    assert.ok(i('ORDER BY id_pedido ASC') < iCuenta, 'pedidos bloqueados antes de leer la cuenta');
    assert.ok(iCuenta < i('INSERT INTO transacciones'));
    const q = db.ejecutadas[iCuenta];
    assert.match(q.sql, /dp\.estado_item <> 'cancelado'/);
    assert.match(q.sql, /t\.estado_transaccion = 'completada'/);
    assert.match(q.sql, /p\.creado_en >= m\.sesion_iniciada_en/, 'la visita actual');
    assert.deepStrictEqual(q.params, [ID_MESA]);
  } finally {
    db.restaurar();
  }
});

test('lo mio: el pago en linea (registrarPagoInterno) no cambia: solo el saldo de la mesa', async () => {
  const transacciones = require('../src/services/transacciones.service');
  const db = fakeCobro({ pedidos: MESA_JARRISON, cuentaPorComensal: SIN_PLATOS_DE_ANA });
  try {
    const r = await transacciones.registrarPagoInterno({
      referencia_externa: 'wompi-ref-1', id_mesa: ID_MESA, comensal: 'Ana', monto_centavos: 1200000,
    });
    assert.strictEqual(r.duplicado, false);
    assert.strictEqual(db.buscar("'consumo'::text AS tipo"), undefined);
  } finally {
    db.restaurar();
  }
});
