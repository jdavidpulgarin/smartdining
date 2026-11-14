const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// POST /api/pedidos/:id/items/:id_detalle/cancelar — D-13 por el comensal
// (J-14): el comensal quita UNA línea suya. Lo que hace la base (devolver el
// stock, recalcular el total) está en tests/integracion/quitar-item-sql.test.js.

const MESA = 5;
const PEDIDO = 87;
const DETALLE = 3;

/** JWT de comensal CON alias, y el token_qr que el doble dará por vigente. */
function sesionComensal(alias, idMesa = MESA) {
  const { token, sid } = construirTokenQr(idMesa);
  const jwtComensal = jwt.sign(
    // alias null: un JWT de comensal SIN el campo `comensal`.
    { id_mesa: idMesa, sid, rol: 'comensal', ...(alias === null ? {} : { comensal: alias }) },
    process.env.JWT_SECRET,
    { expiresIn: '3h' }
  );
  return { jwtComensal, tokenQr: token };
}

const ITEM = {
  id_detalle: DETALLE, id_pedido: PEDIDO, id_plato: 12, cantidad: 2, subtotal: 30000,
  comensal: 'Ana', estado_item: 'cancelado', plato_nombre: 'Bandeja', personalizable: false, ingredientes: [],
};

/**
 * Doble de la base para la transacción del servicio. `linea` y `pedido` son lo
 * que hay ANTES; `vivas` las líneas no canceladas que quedan después.
 */
function fakeQuitar({
  tokenQr,
  pedido = { id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'PED-261111-ABCDE', estado: 'recibido', total: 50000, creado_en: new Date() },
  linea = { id_detalle: DETALLE, id_plato: 12, comensal: 'Ana', estado_item: 'pendiente', subtotal: 30000, nombre: 'Bandeja' },
  pagoBloquea = false,
  vivas = 1,
} = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('total, creado_en') && sql.includes('FOR UPDATE')) return { rows: pedido ? [pedido] : [] };
    if (sql.includes('FOR UPDATE OF dp')) return { rows: linea ? [linea] : [] };
    if (sql.includes('SELECT sesion_iniciada_en FROM mesas')) return { rows: [{ sesion_iniciada_en: null }] };
    if (sql.includes('FROM transacciones t')) return { rows: [{ bloquea: pagoBloquea }] };
    if (sql.includes('count(*)::int AS n FROM detalles_pedido')) return { rows: [{ n: vivas }] };
    if (sql.includes('total FROM pedidos WHERE id_pedido')) {
      return { rows: [{ ...pedido, total: pedido.total - linea.subtotal, estado: vivas === 0 ? 'cancelado' : pedido.estado }] };
    }
    if (sql.includes('json_agg')) return { rows: [ITEM] };
    return { rows: [] };
  }, { tokenQrDeMesa: tokenQr });
}

const quitar = (jwtToken, { pedido = PEDIDO, detalle = DETALLE, cuerpo } = {}) => {
  let r = request(app).post(`/api/pedidos/${pedido}/items/${detalle}/cancelar`);
  if (jwtToken) r = r.set('Authorization', `Bearer ${jwtToken}`);
  return cuerpo === undefined ? r : r.send(cuerpo);
};

/** Instala base y socket con lo indicado; `restaurar` deshace todo. */
function escenario(alias = 'Ana', opcionesDb = {}, responderSocket = () => ({ ok: true })) {
  const s = sesionComensal(alias);
  const socket = instalarFakeSocket(responderSocket);
  const db = fakeQuitar({ tokenQr: s.tokenQr, ...opcionesDb });
  return { ...s, db, socket, restaurar() { db.restaurar(); socket.restaurar(); } };
}

const sinCancelar = (e) => {
  assert.strictEqual(e.db.buscar('UPDATE detalles_pedido'), undefined, 'la línea no se toca');
  assert.strictEqual(e.db.buscar('UPDATE pedidos'), undefined);
  assert.ok(e.db.buscar('ROLLBACK'));
};

// --- Quién --------------------------------------------------------------------

test('quitar plato: sin sesión -> 401', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await quitar(null)).status, 401);
  } finally {
    e.restaurar();
  }
});

// Desde D-13 por el personal la ruta también acepta admin y mesero (sus
// pruebas están en pedidos-personal-cancela-item.test.js). Cocina sigue fuera.
test('quitar plato: cocina no entra en esta ruta -> 403', async () => {
  const e = escenario();
  try {
    const res = await quitar(tokenStaff(1, 'cocina'));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(e.db.buscar('BEGIN'), undefined);
  } finally {
    e.restaurar();
  }
});

test('quitar plato: un JWT de comensal de otra sesión (otro QR) -> 401', async () => {
  const e = escenario();
  try {
    const viejo = jwt.sign({ id_mesa: MESA, sid: 'sid-viejo', rol: 'comensal', comensal: 'Ana' }, process.env.JWT_SECRET);
    assert.strictEqual((await quitar(viejo)).status, 401);
  } finally {
    e.restaurar();
  }
});

for (const [caso, opcionesDb, alias] of [
  ['el pedido es de otra mesa', { pedido: { id_pedido: PEDIDO, id_mesa: 9, codigo_pedido: 'X', estado: 'recibido', total: 50000, creado_en: new Date() } }, 'Ana'],
  ['el plato es de otro comensal', { linea: { id_detalle: DETALLE, id_plato: 12, comensal: 'Beto', estado_item: 'pendiente', subtotal: 30000, nombre: 'B' } }, 'Ana'],
  ['el plato no tiene dueño (comensal NULL)', { linea: { id_detalle: DETALLE, id_plato: 12, comensal: null, estado_item: 'pendiente', subtotal: 30000, nombre: 'B' } }, 'Ana'],
  ['el JWT no trae alias', {}, null],
]) {
  test(`quitar plato: ${caso} -> 403 no_es_tuyo y no se toca nada`, async () => {
    const e = escenario(alias, opcionesDb);
    try {
      const res = await quitar(e.jwtComensal);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.motivo, 'no_es_tuyo');
      assert.ok(res.body.error);
      sinCancelar(e);
    } finally {
      e.restaurar();
    }
  });
}

test('quitar plato: el mismo comensal con otra mayúscula o tilde es el dueño (clave D-18b)', async () => {
  for (const [enLaLinea, enElJwt] of [['José', 'jose'], ['ana maría', 'Ana  María'], ['Ana', 'ANA']]) {
    const e = escenario(enElJwt, {
      linea: { id_detalle: DETALLE, id_plato: 12, comensal: enLaLinea, estado_item: 'pendiente', subtotal: 30000, nombre: 'B' },
    });
    try {
      const res = await quitar(e.jwtComensal);
      assert.strictEqual(res.status, 200, `${enLaLinea} / ${enElJwt}: ${JSON.stringify(res.body)}`);
    } finally {
      e.restaurar();
    }
  }
});

// --- Qué ----------------------------------------------------------------------

test('quitar plato: el pedido no existe -> 404', async () => {
  const e = escenario('Ana', { pedido: null });
  try {
    const res = await quitar(e.jwtComensal);
    assert.strictEqual(res.status, 404);
    assert.ok(res.body.motivo);
  } finally {
    e.restaurar();
  }
});

test('quitar plato: la línea no es de ese pedido -> 404', async () => {
  const e = escenario('Ana', { linea: null });
  try {
    const res = await quitar(e.jwtComensal);
    assert.strictEqual(res.status, 404);
    const linea = e.db.buscar('FOR UPDATE OF dp');
    assert.deepStrictEqual(linea.params, [DETALLE, PEDIDO], 'se busca la línea DENTRO de ese pedido');
    sinCancelar(e);
  } finally {
    e.restaurar();
  }
});

for (const [motivo, opcionesDb] of [
  ['item_ya_cancelado', { linea: { id_detalle: DETALLE, id_plato: 12, comensal: 'Ana', estado_item: 'cancelado', subtotal: 30000, nombre: 'B' } }],
  // Ya cancelada Y el pedido en cocina: manda item_ya_cancelado (va primero).
  ['item_ya_cancelado', {
    pedido: { id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'X', estado: 'en_preparacion', total: 50000, creado_en: new Date() },
    linea: { id_detalle: DETALLE, id_plato: 12, comensal: 'Ana', estado_item: 'cancelado', subtotal: 30000, nombre: 'B' },
  }],
  ['item_en_preparacion', { pedido: { id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'X', estado: 'en_preparacion', total: 50000, creado_en: new Date() } }],
  ['item_en_preparacion', { linea: { id_detalle: DETALLE, id_plato: 12, comensal: 'Ana', estado_item: 'cocinando', subtotal: 30000, nombre: 'B' } }],
  ['pago_registrado', { pagoBloquea: true }],
]) {
  test(`quitar plato: ${motivo} (${JSON.stringify(opcionesDb).slice(0, 60)}...) -> 409 y no se toca nada`, async () => {
    const e = escenario('Ana', opcionesDb);
    try {
      const res = await quitar(e.jwtComensal);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, motivo);
      assert.ok(res.body.error);
      sinCancelar(e);
    } finally {
      e.restaurar();
    }
  });
}

test('quitar plato: pago_registrado es ESTRICTO, cualquier transacción completada (no compara con el total)', async () => {
  const e = escenario('Ana', { pagoBloquea: true });
  try {
    assert.strictEqual((await quitar(e.jwtComensal)).status, 409);
    const pago = e.db.buscar('FROM transacciones t');
    assert.ok(pago.sql.includes('EXISTS'), 'basta con que exista una');
    assert.ok(pago.sql.includes("estado_transaccion = 'completada'"));
    assert.deepStrictEqual(pago.params, [PEDIDO], 'ni el total ni el subtotal entran en la regla');
    // Decisión de producto: el comensal NO usa la regla del personal (pagado
    // contra el total nuevo), y con un pago ni siquiera llega a tocar la línea.
    assert.strictEqual(e.db.buscar('pagado_centavos'), undefined);
    assert.strictEqual(e.db.buscar('UPDATE detalles_pedido'), undefined);
  } finally {
    e.restaurar();
  }
});

test('t4: el comensal sigue ESTRICTO: su mensaje de siempre y sin la regla del dueño que pagó (es del personal)', async () => {
  const e = escenario('Ana', { pagoBloquea: true });
  try {
    const res = await quitar(e.jwtComensal);
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, {
      error: 'El pedido ya tiene un pago registrado: pídeselo al mesero',
      motivo: 'pago_registrado',
    });
    assert.strictEqual(e.db.buscar('SELECT DISTINCT t.comensal'), undefined);
  } finally {
    e.restaurar();
  }
});

test('t4: el comensal no toma el bloqueo de la mesa (solo el camino del personal)', async () => {
  const e = escenario('Ana');
  try {
    assert.strictEqual((await quitar(e.jwtComensal)).status, 200);
    assert.strictEqual(e.db.buscar('SELECT m.id_mesa FROM mesas m'), undefined);
  } finally {
    e.restaurar();
  }
});

for (const [caso, cuerpo] of [['un campo', { motivo: 'no lo quiero' }], ['un arreglo', [1]]]) {
  test(`quitar plato: cuerpo con ${caso} -> 400 cuerpo_invalido`, async () => {
    const e = escenario();
    try {
      const res = await quitar(e.jwtComensal, { cuerpo });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

for (const [pedido, detalle] of [['0', '3'], ['87', '-1'], ['abc', '3'], ['87', '1.5'], ['99999999999', '3']]) {
  test(`quitar plato: params ${pedido}/${detalle} -> 400`, async () => {
    const e = escenario();
    try {
      const res = await quitar(e.jwtComensal, { pedido, detalle });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'parametro_invalido');
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

// --- Camino feliz y avisos ------------------------------------------------------

test('quitar plato: 200 con el pedido; bloquea pedido y después línea; cancela la línea COMPLETA', async () => {
  const e = escenario('Ana', {}, () => ({ ok: true }));
  try {
    const res = await quitar(e.jwtComensal, { cuerpo: {} });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(Object.keys(res.body), ['pedido']);
    assert.deepStrictEqual(Object.keys(res.body.pedido).sort(), ['codigo_pedido', 'estado', 'id_pedido', 'items', 'total']);
    assert.strictEqual(res.body.pedido.total, 20000);
    assert.strictEqual(typeof res.body.pedido.total, 'number');
    assert.strictEqual(res.body.pedido.estado, 'recibido');
    assert.strictEqual(res.body.pedido.items[0].estado_item, 'cancelado');
    assert.ok(Array.isArray(res.body.pedido.items[0].ingredientes), 'misma forma que el seguimiento');

    const sqls = e.db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    assert.ok(i('BEGIN') < i('total, creado_en'));
    assert.ok(i('total, creado_en') < i('FOR UPDATE OF dp'), 'pedido ANTES que la línea');
    assert.ok(i('FOR UPDATE OF dp') < i('UPDATE detalles_pedido'));
    assert.ok(i('UPDATE detalles_pedido') < i('COMMIT'));
    // La línea entera, sin tocar la cantidad.
    const update = e.db.buscar('UPDATE detalles_pedido');
    assert.ok(update.sql.includes("estado_item = 'cancelado'"));
    assert.ok(!/cantidad/.test(update.sql));
    assert.deepStrictEqual(update.params, [DETALLE]);
    // Quedan líneas vivas: el pedido no se cancela, y nunca se libera la mesa.
    assert.strictEqual(e.db.buscar('UPDATE pedidos'), undefined);
    assert.strictEqual(e.db.buscar('UPDATE mesas'), undefined);

    await socketNotifier.esperarAvisos();
    const aviso = e.socket.buscar('/internal/item-cancelado');
    assert.ok(aviso, 'se manda el aviso');
    const { eventId, ...resto } = aviso.cuerpo;
    assert.match(eventId, /^[0-9a-f-]{36}$/);
    assert.deepStrictEqual(resto, {
      id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'PED-261111-ABCDE', id_detalle: DETALLE, id_plato: 12,
      nombre: 'Bandeja', comensal: 'Ana', total: 20000, estado_pedido: 'recibido', origen: 'comensal',
    });
    assert.strictEqual(aviso.cuerpo.origen, 'comensal', 'el aviso del comensal dice que lo quitó el comensal');
    assert.strictEqual(e.socket.buscar('/internal/order-status'), undefined, 'el pedido sigue vivo');
  } finally {
    e.restaurar();
  }
});

test('quitar el último plato vivo: el pedido pasa a cancelado con historial, avisa order-status y NO libera la mesa', async () => {
  const e = escenario('Ana', { vivas: 0 });
  try {
    const res = await quitar(e.jwtComensal);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.pedido.estado, 'cancelado');

    assert.ok(e.db.buscar("UPDATE pedidos SET estado = 'cancelado'"));
    const hist = e.db.buscar('INSERT INTO historial_estados');
    assert.deepStrictEqual(hist.params, [PEDIDO, 'recibido', 'Cancelado por el comensal']);
    assert.ok(hist.sql.includes('NULL'), 'id_usuario NULL');
    assert.strictEqual(e.db.buscar('UPDATE mesas'), undefined, 'la mesa no se libera');

    await socketNotifier.esperarAvisos();
    const rutas = e.socket.avisos.map((a) => a.ruta);
    assert.deepStrictEqual(rutas.filter((r) => r.startsWith('/internal/')), ['/internal/item-cancelado', '/internal/order-status']);
    const estado = e.socket.buscar('/internal/order-status').cuerpo;
    assert.strictEqual(estado.estado, 'cancelado');
    assert.strictEqual(estado.estado_anterior, 'recibido');
    assert.strictEqual(estado.origen, 'comensal', '#180: el comensal quitó la última línea');
    assert.strictEqual(e.socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    e.restaurar();
  }
});

test('quitar plato: un 404 del socket-server (ruta pendiente de Roberto) no rompe la respuesta ni se reintenta', async () => {
  const e = escenario('Ana', {}, (ruta) => (
    ruta === '/internal/item-cancelado' ? { __status: 404, ok: false, codigo: 'NO_ENCONTRADO' } : { ok: true }
  ));
  const errores = [];
  const consoleError = console.error;
  console.error = (...a) => errores.push(a.join(' '));
  try {
    const res = await quitar(e.jwtComensal);
    assert.strictEqual(res.status, 200);
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.socket.avisos.filter((a) => a.ruta === '/internal/item-cancelado').length, 1, 'un 404 no se reintenta');
    assert.ok(errores.some((m) => m.includes('/internal/item-cancelado') && m.includes('Roberto')), 'queda en el log');
  } finally {
    console.error = consoleError;
    e.restaurar();
  }
});

test('quitar plato: un 503 ERROR_INTERNO se reintenta con el MISMO eventId', async () => {
  let intentos = 0;
  const e = escenario('Ana', {}, (ruta) => {
    if (ruta !== '/internal/item-cancelado') return { ok: true };
    intentos += 1;
    return intentos < 3 ? { __status: 503, ok: false, codigo: 'ERROR_INTERNO' } : { ok: true };
  });
  const consoleError = console.error;
  console.error = () => {};
  try {
    assert.strictEqual((await quitar(e.jwtComensal)).status, 200);
    await socketNotifier.esperarAvisos();
    const envios = e.socket.avisos.filter((a) => a.ruta === '/internal/item-cancelado');
    assert.strictEqual(envios.length, 3);
    assert.strictEqual(new Set(envios.map((a) => a.cuerpo.eventId)).size, 1);
  } finally {
    console.error = consoleError;
    e.restaurar();
  }
});
