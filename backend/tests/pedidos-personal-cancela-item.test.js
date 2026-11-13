const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// POST /api/pedidos/:id/items/:id_detalle/cancelar — D-13 por el PERSONAL: la
// misma ruta del comensal (J-14), con sesión de admin o mesero. Lo que
// hace la base (devolución o merma, total, historial) está en
// tests/integracion/personal-cancela-item-sql.test.js. El camino del comensal
// sigue en pedidos-quitar-item.test.js.

const PEDIDO = 87;
const DETALLE = 3;
const USUARIO = 7;

const ITEM = {
  id_detalle: DETALLE, id_pedido: PEDIDO, id_plato: 12, cantidad: 1, subtotal: 30000,
  comensal: null, estado_item: 'cancelado', plato_nombre: 'Bandeja', personalizable: false, ingredientes: [],
};

const pedidoEn = (estado, extra = {}) => ({
  id_pedido: PEDIDO, id_mesa: 9, codigo_pedido: 'PED-261111-ABCDE', estado, total: 50000, creado_en: new Date(), ...extra,
});
const lineaEn = (estado_item, extra = {}) => ({
  id_detalle: DETALLE, id_plato: 12, comensal: null, estado_item, subtotal: 30000, nombre: 'Bandeja', ...extra,
});

/**
 * Doble de la base para la transacción del servicio. Mesa 9 y línea SIN dueño
 * a propósito: el personal no tiene regla de dueño.
 */
function fakePersonal({
  pedido = pedidoEn('en_preparacion'),
  linea = lineaEn('cocinando'),
  pagoBloquea = false,
  // pago_registrado del personal: lo pagado y el total NUEVO (sin la línea) en
  // centavos, como los devuelve pg (bigint -> texto). Por omisión, sin pagos.
  pagadoCentavos = 0,
  totalNuevoCentavos = null,
  vivas = 1,
  transicionValida = true,
  falloEn = null,
} = {}) {
  const totalNuevo = totalNuevoCentavos ?? (pedido && linea ? (pedido.total - linea.subtotal) * 100 : 0);
  return instalarFakeDb((sql) => {
    if (falloEn && sql.includes(falloEn.sql)) throw falloEn.error;
    if (sql.includes('total, creado_en') && sql.includes('FOR UPDATE')) return { rows: pedido ? [pedido] : [] };
    if (sql.includes('FOR UPDATE OF dp')) return { rows: linea ? [linea] : [] };
    if (sql.includes('pagado_centavos')) {
      return { rows: [{ total_centavos: String(totalNuevo), pagado_centavos: String(pagadoCentavos) }] };
    }
    if (sql.includes('FROM transacciones t')) return { rows: [{ bloquea: pagoBloquea }] };
    if (sql.includes('count(*)::int AS n FROM detalles_pedido')) return { rows: [{ n: vivas }] };
    if (sql.includes('FROM transiciones_validas')) return { rows: [{ ok: transicionValida }] };
    if (sql.includes('total FROM pedidos WHERE id_pedido')) {
      return { rows: [{ ...pedido, total: pedido.total - linea.subtotal, estado: vivas === 0 ? 'cancelado' : pedido.estado }] };
    }
    if (sql.includes('json_agg')) return { rows: [ITEM] };
    return { rows: [] };
  });
}

// El motivo es OBLIGATORIO para el personal: por omisión se manda uno.
// `sinCuerpo: true` no manda nada.
const cancelar = (rol, { cuerpo = { motivo: 'Se acabó' }, id = USUARIO, sinCuerpo = false } = {}) => {
  const r = request(app)
    .post(`/api/pedidos/${PEDIDO}/items/${DETALLE}/cancelar`)
    .set('Authorization', `Bearer ${tokenStaff(id, rol)}`);
  return sinCuerpo ? r : r.send(cuerpo);
};

function escenario(opcionesDb = {}, responderSocket = () => ({ ok: true })) {
  const socket = instalarFakeSocket(responderSocket);
  const db = fakePersonal(opcionesDb);
  return { db, socket, restaurar() { db.restaurar(); socket.restaurar(); } };
}

const sinCancelar = (e) => {
  assert.strictEqual(e.db.buscar('UPDATE pedidos'), undefined);
  assert.ok(e.db.buscar('ROLLBACK'));
  assert.strictEqual(e.db.buscar('COMMIT'), undefined);
};

// --- Quién --------------------------------------------------------------------

test('personal cancela plato: admin y mesero pueden; sin regla de dueño (otra mesa, línea sin comensal)', async () => {
  for (const rol of ['admin', 'mesero']) {
    const e = escenario();
    try {
      const res = await cancelar(rol);
      assert.strictEqual(res.status, 200, `${rol}: ${JSON.stringify(res.body)}`);
      assert.ok(e.db.buscar("UPDATE detalles_pedido SET estado_item = 'cancelado'"));
      assert.strictEqual(e.db.buscar('SELECT sesion_iniciada_en FROM mesas'), undefined, 'no mira la mesa del JWT');
    } finally {
      e.restaurar();
    }
  }
});

for (const rol of ['cajero', 'cocina']) {
  test(`personal cancela plato: ${rol} -> 403 y no toca la base (solo admin y mesero)`, async () => {
    const e = escenario();
    try {
      const res = await cancelar(rol);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('personal cancela plato: fija app.id_usuario con set_config DENTRO de la transacción, antes de bloquear', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await cancelar('mesero')).status, 200);
    const sqls = e.db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    const conf = e.db.buscar('set_config');
    assert.deepStrictEqual(conf.params, ['app.id_usuario', String(USUARIO)]);
    assert.ok(conf.sql.includes('true'), 'local a la transacción');
    assert.ok(i('BEGIN') < i('set_config'));
    assert.ok(i('set_config') < i('total, creado_en'));
    assert.ok(i('total, creado_en') < i('FOR UPDATE OF dp'), 'pedido ANTES que la línea');
  } finally {
    e.restaurar();
  }
});

// --- Cuerpo -------------------------------------------------------------------

for (const [caso, opciones, codigo] of [
  // El motivo es obligatorio (revisión de Jarrison): falta, vacío o fuera de rango.
  ['sin cuerpo', { sinCuerpo: true }, 'motivo_requerido'],
  ['cuerpo {} (sin motivo)', { cuerpo: {} }, 'motivo_requerido'],
  ['motivo vacío', { cuerpo: { motivo: '' } }, 'motivo_requerido'],
  ['motivo solo espacios', { cuerpo: { motivo: '   ' } }, 'motivo_requerido'],
  ['motivo de 201 caracteres', { cuerpo: { motivo: 'x'.repeat(201) } }, 'motivo_requerido'],
  ['motivo que no es texto', { cuerpo: { motivo: 5 } }, 'motivo_requerido'],
  // Lo demás del cuerpo sigue siendo el cuerpo_invalido de siempre.
  ['un campo extra', { cuerpo: { motivo: 'se acabó', forzar: true } }, 'cuerpo_invalido'],
  ['un arreglo', { cuerpo: ['se acabó'] }, 'cuerpo_invalido'],
]) {
  test(`personal cancela plato: ${caso} -> 400 ${codigo}, sin tocar la base`, async () => {
    const e = escenario();
    try {
      const res = await cancelar('admin', opciones);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, codigo);
      assert.ok(res.body.error);
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('personal cancela plato: motivo de 200 caracteres (con espacios a los lados) vale', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await cancelar('admin', { cuerpo: { motivo: `  ${'x'.repeat(200)}  ` } })).status, 200);
  } finally {
    e.restaurar();
  }
});

// --- 404 y 409 ----------------------------------------------------------------

test('personal cancela plato: pedido inexistente o línea de otro pedido -> 404', async () => {
  for (const opciones of [{ pedido: null }, { linea: null }]) {
    const e = escenario(opciones);
    try {
      const res = await cancelar('mesero');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.motivo, 'no_encontrado');
    } finally {
      e.restaurar();
    }
  }
});

for (const [motivo, opcionesDb, nota] of [
  ['item_ya_cancelado', { linea: lineaEn('cancelado') }, 'línea ya cancelada'],
  ['item_ya_cancelado', { linea: lineaEn('cancelado'), pedido: pedidoEn('entregado') }, 'va antes que item_no_cancelable'],
  ['item_no_cancelable', { linea: lineaEn('servido') }, 'línea servida'],
  ['item_no_cancelable', { pedido: pedidoEn('entregado'), linea: lineaEn('pendiente') }, 'pedido entregado'],
  ['item_no_cancelable', { pedido: pedidoEn('pagado'), linea: lineaEn('pendiente') }, 'pedido pagado'],
  ['item_no_cancelable', { pedido: pedidoEn('cancelado'), linea: lineaEn('pendiente') }, 'pedido cancelado'],
]) {
  test(`personal cancela plato: ${nota} -> 409 ${motivo} y no se toca nada`, async () => {
    const e = escenario(opcionesDb);
    try {
      const res = await cancelar('mesero');
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, motivo);
      assert.ok(res.body.error);
      assert.strictEqual(e.db.buscar('UPDATE detalles_pedido'), undefined, 'la línea no se toca');
      sinCancelar(e);
    } finally {
      e.restaurar();
    }
  });
}

// --- pago_registrado del personal: lo pagado contra el total NUEVO ------------------
// Pedido de 50.000 y línea de 30.000: el total nuevo es 20.000 (2.000.000 centavos).

for (const [caso, pagadoCentavos] of [
  ['sin pagos', 0],
  ['pagado < total nuevo', 1500000],
  ['pagado == total nuevo (igual vale)', 2000000],
]) {
  test(`personal cancela plato: ${caso} -> 200 y COMMIT`, async () => {
    const e = escenario({ pagadoCentavos });
    try {
      const res = await cancelar('mesero');
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.ok(e.db.buscar('COMMIT'));
      assert.strictEqual(e.db.buscar('ROLLBACK'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('personal cancela plato: el pago se compara DESPUÉS de cancelar la línea, en centavos que calcula la base', async () => {
  const e = escenario({ pagadoCentavos: 1500000 });
  try {
    assert.strictEqual((await cancelar('admin')).status, 200);
    const cuenta = e.db.buscar('pagado_centavos');
    assert.ok(cuenta, 'lee total y pagado');
    assert.ok(cuenta.sql.includes('ROUND(p.total * 100)::bigint'), 'total en centavos enteros');
    assert.ok(cuenta.sql.includes('ROUND(SUM(t.monto) * 100)'), 'pagado en centavos enteros');
    assert.ok(cuenta.sql.includes("estado_transaccion = 'completada'"));
    assert.deepStrictEqual(cuenta.params, [PEDIDO]);
    const sqls = e.db.todas('').map((c) => c.sql);
    const iLinea = sqls.findIndex((s) => s.includes("UPDATE detalles_pedido SET estado_item = 'cancelado'"));
    const iCuenta = sqls.findIndex((s) => s.includes('pagado_centavos'));
    const iVivas = sqls.findIndex((s) => s.includes('count(*)::int AS n FROM detalles_pedido'));
    assert.ok(iLinea >= 0 && iCuenta > iLinea, 'primero se cancela la línea (el trigger deja el total nuevo)');
    assert.ok(iVivas > iCuenta, 'y se compara antes de decidir si el pedido se cancela');
    assert.strictEqual(e.db.buscar('EXISTS (SELECT 1 FROM transacciones'), undefined, 'el personal no usa la regla estricta');
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: pagado > total nuevo -> 409 pago_registrado, ROLLBACK y sin avisos', async () => {
  const e = escenario({ pagadoCentavos: 2000001 });
  try {
    const res = await cancelar('mesero');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'pago_registrado');
    assert.ok(res.body.error);
    assert.ok(e.db.buscar("UPDATE detalles_pedido SET estado_item = 'cancelado'"), 'la línea se canceló dentro de la transacción');
    sinCancelar(e); // ... y el ROLLBACK la deshace, con su movimiento de stock
    assert.strictEqual(e.db.buscar('count(*)::int AS n FROM detalles_pedido'), undefined, 'no sigue al paso del pedido');
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.socket.avisos.length, 0, 'nada que avisar');
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: ÚLTIMA línea con algo pagado -> 409 pago_registrado (no se cancela un pedido con pagos)', async () => {
  const e = escenario({ vivas: 0, totalNuevoCentavos: 0, pagadoCentavos: 100 });
  try {
    const res = await cancelar('admin');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'pago_registrado');
    sinCancelar(e);
    assert.strictEqual(e.db.buscar('FROM transiciones_validas'), undefined);
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: ÚLTIMA línea sin pagos sigue cancelando el pedido (total nuevo 0 = pagado 0)', async () => {
  const e = escenario({ pedido: pedidoEn('recibido'), linea: lineaEn('pendiente'), vivas: 0, totalNuevoCentavos: 0 });
  try {
    const res = await cancelar('admin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(e.db.buscar("UPDATE pedidos SET estado = 'cancelado'"));
    assert.ok(e.db.buscar('COMMIT'));
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: si transiciones_validas NO permite pasar el pedido a cancelado, la ÚLTIMA línea -> 409 item_no_cancelable y ROLLBACK', async () => {
  const e = escenario({ pedido: pedidoEn('en_preparacion'), linea: lineaEn('cocinando'), vivas: 0, transicionValida: false });
  try {
    const res = await cancelar('admin');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'item_no_cancelable');
    assert.deepStrictEqual(e.db.buscar('FROM transiciones_validas').params, ['en_preparacion'], 'se pregunta a la tabla');
    sinCancelar(e);
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: la ÚLTIMA línea de un pedido en "listo" con la transición permitida (script 31) -> 200 y el pedido se cancela', async () => {
  const e = escenario({ pedido: pedidoEn('listo'), linea: lineaEn('listo'), vivas: 0, transicionValida: true });
  try {
    const res = await cancelar('mesero', { cuerpo: { motivo: 'El cliente se fue' } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.pedido.estado, 'cancelado');
    assert.deepStrictEqual(e.db.buscar('FROM transiciones_validas').params, ['listo'], 'se pregunta a la tabla');
    assert.ok(e.db.buscar("UPDATE pedidos SET estado = 'cancelado'"));
    assert.deepStrictEqual(e.db.buscar('INSERT INTO historial_estados').params, [PEDIDO, USUARIO, 'listo', 'El cliente se fue']);
    assert.strictEqual(e.db.buscar('UPDATE mesas'), undefined, 'la mesa no se libera');

    await socketNotifier.esperarAvisos();
    const estado = e.socket.buscar('/internal/order-status');
    assert.ok(estado, 'order:status del pedido cancelado');
    assert.strictEqual(estado.cuerpo.estado, 'cancelado');
    assert.strictEqual(estado.cuerpo.estado_anterior, 'listo');
    // `origen` en order-status llega con la D-12 (feature/api-comensal-cancela-pedido),
    // que se apila encima de esta rama y lo verifica allí.
    assert.strictEqual(e.socket.buscar('/internal/mesa-liberada'), undefined, 'ni mesa-liberada');
    assert.strictEqual(e.socket.buscar('/internal/item-cancelado').cuerpo.estado_pedido, 'cancelado');
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: línea en "listo" con otras vivas -> 200 (el pedido sigue)', async () => {
  const e = escenario({ pedido: pedidoEn('listo'), linea: lineaEn('listo'), vivas: 1 });
  try {
    assert.strictEqual((await cancelar('admin')).status, 200);
    assert.strictEqual(e.db.buscar('FROM transiciones_validas'), undefined, 'solo se pregunta si era la última');
  } finally {
    e.restaurar();
  }
});

for (const constraint of ['fk_historial_usuario', 'movimientos_inventario_id_usuario_fkey']) {
  test(`personal cancela plato: autor inexistente (${constraint}) -> 409 autor_inexistente`, async () => {
    const err = Object.assign(new Error('viola la llave foránea'), { code: '23503', constraint });
    const falloEn = constraint === 'fk_historial_usuario'
      ? { sql: 'INSERT INTO historial_estados', error: err }
      : { sql: 'UPDATE detalles_pedido', error: err };
    const e = escenario({ vivas: 0, falloEn });
    try {
      const res = await cancelar('mesero', { id: 999 });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, 'autor_inexistente');
      assert.ok(e.db.buscar('ROLLBACK'));
      assert.strictEqual(e.db.buscar('COMMIT'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

// --- Camino feliz y aviso -----------------------------------------------------

test('personal cancela la última línea: pedido cancelado, historial con el usuario y el motivo, NO libera la mesa', async () => {
  const e = escenario({ pedido: pedidoEn('en_preparacion'), vivas: 0 });
  try {
    const res = await cancelar('mesero', { cuerpo: { motivo: '  Se acabó el pollo  ' } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.pedido.estado, 'cancelado');
    assert.ok(e.db.buscar("UPDATE pedidos SET estado = 'cancelado'"));
    const hist = e.db.buscar('INSERT INTO historial_estados');
    assert.deepStrictEqual(hist.params, [PEDIDO, USUARIO, 'en_preparacion', 'Se acabó el pollo']);
    assert.strictEqual(e.db.buscar('UPDATE mesas'), undefined, 'la mesa no se libera');
  } finally {
    e.restaurar();
  }
});

test('personal cancela la última línea: la observación del historial es SIEMPRE el motivo (obligatorio)', async () => {
  const e = escenario({ vivas: 0 });
  try {
    assert.strictEqual((await cancelar('admin', { cuerpo: { motivo: 'Cliente alérgico' } })).status, 200);
    assert.strictEqual(e.db.buscar('INSERT INTO historial_estados').params[3], 'Cliente alérgico');
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: misma respuesta 200 que el comensal; aviso con origen "personal" y SIN el motivo', async () => {
  const e = escenario({ pedido: pedidoEn('en_preparacion'), vivas: 0 });
  try {
    const res = await cancelar('mesero', { cuerpo: { motivo: 'Motivo interno que no viaja' } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body), ['pedido']);
    assert.deepStrictEqual(Object.keys(res.body.pedido).sort(), ['codigo_pedido', 'estado', 'id_pedido', 'items', 'total']);
    assert.strictEqual(typeof res.body.pedido.total, 'number');

    await socketNotifier.esperarAvisos();
    const aviso = e.socket.buscar('/internal/item-cancelado');
    assert.ok(aviso);
    const { eventId, ...resto } = aviso.cuerpo;
    assert.match(eventId, /^[0-9a-f-]{36}$/);
    assert.deepStrictEqual(resto, {
      id_pedido: PEDIDO, id_mesa: 9, codigo_pedido: 'PED-261111-ABCDE', id_detalle: DETALLE, id_plato: 12,
      nombre: 'Bandeja', comensal: null, total: 20000, estado_pedido: 'cancelado', origen: 'personal',
    });
    assert.ok(!JSON.stringify(aviso.cuerpo).includes('Motivo interno'), 'el motivo no va en el aviso');
    assert.strictEqual(aviso.cuerpo.motivo, undefined);

    const estado = e.socket.buscar('/internal/order-status');
    assert.ok(estado, 'pedido cancelado: también order-status');
    assert.strictEqual(estado.cuerpo.estado, 'cancelado');
    assert.strictEqual(estado.cuerpo.estado_anterior, 'en_preparacion');
  } finally {
    e.restaurar();
  }
});

test('personal cancela plato: estado_pedido del aviso con el pedido vivo (en_preparacion)', async () => {
  const e = escenario({ pedido: pedidoEn('en_preparacion'), vivas: 1 });
  try {
    assert.strictEqual((await cancelar('mesero')).status, 200);
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.socket.buscar('/internal/item-cancelado').cuerpo.estado_pedido, 'en_preparacion');
    assert.strictEqual(e.socket.buscar('/internal/order-status'), undefined);
  } finally {
    e.restaurar();
  }
});
