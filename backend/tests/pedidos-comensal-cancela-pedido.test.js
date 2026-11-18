const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// POST /api/pedidos/:id/cancelar con sesión de COMENSAL — D-12 (contrato
// aprobado por Juan): el comensal cancela su pedido completo. El camino del
// personal es el de siempre (ver también mesa-sesion-ciclo.test.js). Lo que
// hace la base (devolución, total, transición) está en
// tests/integracion/comensal-cancela-pedido-sql.test.js.

const MESA = 5;
const PEDIDO = 87;

function sesionComensal(alias = 'Ana', idMesa = MESA) {
  const { token, sid } = construirTokenQr(idMesa);
  const jwtComensal = jwt.sign(
    { id_mesa: idMesa, sid, rol: 'comensal', ...(alias === null ? {} : { comensal: alias }) },
    process.env.JWT_SECRET,
    { expiresIn: '3h' }
  );
  return { jwtComensal, tokenQr: token };
}

const pedidoEn = (estado = 'recibido', extra = {}) => ({
  id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'PED-261111-ABCDE', estado, total: 45000, creado_en: new Date(), ...extra,
});
const linea = (id, comensal, estado_item = 'pendiente') => ({ id_detalle: id, comensal, estado_item });

const ITEMS = [
  { id_detalle: 1, id_pedido: PEDIDO, id_plato: 12, cantidad: 2, subtotal: 30000, comensal: 'Ana',
    estado_item: 'cancelado', plato_nombre: 'Bandeja', personalizable: false, ingredientes: [] },
];

function fakeCancelar({
  tokenQr,
  pedido = pedidoEn(),
  lineas = [linea(1, 'Ana'), linea(2, 'ana')],
  sesion = null,
  hayPago = false,
} = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('total, creado_en') && sql.includes('FOR UPDATE')) return { rows: pedido ? [pedido] : [] };
    if (sql.includes('SELECT sesion_iniciada_en FROM mesas')) return { rows: [{ sesion_iniciada_en: sesion }] };
    if (sql.includes('ORDER BY id_detalle FOR UPDATE')) return { rows: lineas };
    if (sql.includes('FROM transacciones')) return { rows: [{ hay: hayPago }] };
    if (sql.includes('total FROM pedidos WHERE id_pedido')) return { rows: [{ ...pedido, estado: 'cancelado', total: 0 }] };
    if (sql.includes('json_agg')) return { rows: ITEMS };
    return { rows: [] };
  }, { tokenQrDeMesa: tokenQr });
}

function escenario(alias = 'Ana', opcionesDb = {}) {
  const s = sesionComensal(alias);
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = fakeCancelar({ tokenQr: s.tokenQr, ...opcionesDb });
  return { ...s, db, socket, restaurar() { db.restaurar(); socket.restaurar(); } };
}

const cancelar = (jwtToken, { pedido = PEDIDO, cuerpo } = {}) => {
  let r = request(app).post(`/api/pedidos/${pedido}/cancelar`);
  if (jwtToken) r = r.set('Authorization', `Bearer ${jwtToken}`);
  return cuerpo === undefined ? r : r.send(cuerpo);
};

const sinCancelar = (e) => {
  assert.strictEqual(e.db.buscar('UPDATE detalles_pedido'), undefined);
  assert.strictEqual(e.db.buscar('UPDATE pedidos'), undefined);
  assert.strictEqual(e.db.buscar('INSERT INTO historial_estados'), undefined);
  assert.ok(e.db.buscar('ROLLBACK'));
};

// --- Camino feliz -------------------------------------------------------------

test('D-12: el comensal dueño de todas las líneas vivas cancela el pedido -> 200, sin liberar la mesa', async () => {
  // La línea 3 ya estaba quitada (#180) y es de otro: no cuenta, no está viva.
  const e = escenario('Ana', { lineas: [linea(1, 'Ana'), linea(2, 'ÁNA'), linea(3, 'Beto', 'cancelado')] });
  try {
    const res = await cancelar(e.jwtComensal);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(Object.keys(res.body), ['pedido']);
    assert.deepStrictEqual(Object.keys(res.body.pedido).sort(), ['codigo_pedido', 'estado', 'id_pedido', 'items', 'total']);
    assert.strictEqual(res.body.pedido.estado, 'cancelado');
    assert.strictEqual(res.body.pedido.total, 0);
    assert.strictEqual(typeof res.body.pedido.total, 'number');
    assert.ok(Array.isArray(res.body.pedido.items[0].ingredientes), 'misma forma que el #180');

    // Orden: pedido, después líneas (por id_detalle); líneas vivas y después el pedido.
    const sqls = e.db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    assert.ok(i('BEGIN') < i('total, creado_en'));
    assert.ok(i('total, creado_en') < i('ORDER BY id_detalle FOR UPDATE'), 'pedido ANTES que las líneas');
    assert.ok(i('ORDER BY id_detalle FOR UPDATE') < i('UPDATE detalles_pedido'));
    const lineas = e.db.buscar('UPDATE detalles_pedido');
    assert.ok(lineas.sql.includes("estado_item <> 'cancelado'"), 'solo las vivas');
    assert.ok(i('UPDATE detalles_pedido') < i("UPDATE pedidos SET estado = 'cancelado'"));
    assert.ok(i("UPDATE pedidos SET estado = 'cancelado'") < i('COMMIT'));

    const hist = e.db.buscar('INSERT INTO historial_estados');
    assert.ok(hist.sql.includes('NULL'), 'id_usuario NULL');
    assert.deepStrictEqual(hist.params, [PEDIDO, 'recibido', 'Cancelado por el comensal']);
    assert.strictEqual(e.db.buscar('UPDATE mesas'), undefined, 'la mesa no se libera');
    assert.strictEqual(e.db.buscar('count(*)::int AS n FROM pedidos'), undefined, 'ni se mira si quedan pedidos');

    await socketNotifier.esperarAvisos();
    const internos = e.socket.avisos.map((a) => a.ruta);
    assert.deepStrictEqual(internos, ['/internal/order-status'], 'solo el order-status: ni item-cancelado ni mesa-liberada');
    const estado = e.socket.buscar('/internal/order-status').cuerpo;
    assert.strictEqual(estado.estado, 'cancelado');
    assert.strictEqual(estado.estado_anterior, 'recibido');
    assert.strictEqual(estado.origen, 'comensal', 'D-12: lo canceló el comensal');
  } finally {
    e.restaurar();
  }
});

// --- El personal sigue igual ----------------------------------------------------

test('D-12: el personal cancela por la misma ruta como siempre (cambio de estado y liberación de la mesa)', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) return { rows: [{ id_pedido: PEDIDO, id_mesa: MESA, estado: 'cancelado' }] };
    return { rows: [] };
  });
  try {
    const res = await cancelar(tokenStaff(1, 'mesero'), { cuerpo: { observaciones: 'pidió la cuenta' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'cancelado', 'la respuesta de siempre: el pedido, no { pedido }');
    assert.strictEqual(db.buscar('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2 RETURNING *').params[0], 'cancelado');
    assert.deepStrictEqual(db.buscar('INSERT INTO historial_estados').params, [String(PEDIDO), 1, 'recibido', 'cancelado', 'pidió la cuenta']);
    assert.strictEqual(db.buscar('ORDER BY id_detalle FOR UPDATE'), undefined, 'no pasa por el camino del comensal');
    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), 'la mesa se libera, como hoy');
    await socketNotifier.esperarAvisos();
    assert.ok(socket.buscar('/internal/mesa-liberada'));
    assert.strictEqual(socket.buscar('/internal/order-status').cuerpo.origen, 'personal', 'la cancelación del personal');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('D-12: cocina sigue sin poder cancelar -> 403', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await cancelar(tokenStaff(1, 'cocina'))).status, 403);
  } finally {
    e.restaurar();
  }
});

// --- Quién --------------------------------------------------------------------

test('D-12: sin sesión -> 401', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await cancelar(null)).status, 401);
  } finally {
    e.restaurar();
  }
});

for (const [caso, opciones] of [
  ['el pedido es de otra mesa', { pedido: pedidoEn('recibido', { id_mesa: 9 }) }],
  ['el pedido es de una visita anterior de la mesa', {
    pedido: pedidoEn('recibido', { creado_en: new Date('2026-11-10T10:00:00Z') }),
    sesion: new Date('2026-11-11T10:00:00Z'),
  }],
]) {
  test(`D-12: ${caso} -> 403 no_es_tuyo y no se toca nada`, async () => {
    const e = escenario('Ana', opciones);
    try {
      const res = await cancelar(e.jwtComensal);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.motivo, 'no_es_tuyo');
      assert.strictEqual(e.db.buscar('ORDER BY id_detalle FOR UPDATE'), undefined, 'ni bloquea sus líneas');
      sinCancelar(e);
    } finally {
      e.restaurar();
    }
  });
}

test('D-12: el pedido no existe -> 404', async () => {
  const e = escenario('Ana', { pedido: null });
  try {
    const res = await cancelar(e.jwtComensal);
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.motivo, 'no_encontrado');
  } finally {
    e.restaurar();
  }
});

// --- 409 ----------------------------------------------------------------------

for (const [motivo, nota, opciones] of [
  ['pedido_ya_cancelado', 'ya cancelado', { pedido: pedidoEn('cancelado'), lineas: [linea(1, 'Ana', 'cancelado')] }],
  ['pedido_ya_cancelado', 'ya cancelado va antes que compartido', {
    pedido: pedidoEn('cancelado'), lineas: [linea(1, 'Beto')],
  }],
  ['pedido_compartido', 'una línea viva de otro comensal', { lineas: [linea(1, 'Ana'), linea(2, 'Beto')] }],
  ['pedido_compartido', 'una línea viva sin dueño', { lineas: [linea(1, 'Ana'), linea(2, null)] }],
  ['pedido_compartido', 'compartido va antes que no_cancelable', {
    pedido: pedidoEn('en_preparacion'), lineas: [linea(1, 'Ana'), linea(2, 'Beto')],
  }],
  ['no_cancelable', 'pedido en preparación', { pedido: pedidoEn('en_preparacion') }],
  ['no_cancelable', 'una línea viva ya cocinando', { lineas: [linea(1, 'Ana'), linea(2, 'Ana', 'cocinando')] }],
  ['pago_registrado', 'con un pago completado', { hayPago: true }],
]) {
  test(`D-12: ${nota} -> 409 ${motivo} y no se toca nada`, async () => {
    const e = escenario('Ana', opciones);
    try {
      const res = await cancelar(e.jwtComensal);
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, motivo);
      assert.ok(res.body.error);
      sinCancelar(e);
      await socketNotifier.esperarAvisos();
      assert.strictEqual(e.socket.avisos.length, 0);
    } finally {
      e.restaurar();
    }
  });
}

test('D-12: un JWT de comensal sin alias no es dueño de ninguna línea -> 409 pedido_compartido', async () => {
  const e = escenario(null);
  try {
    const res = await cancelar(e.jwtComensal);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'pedido_compartido');
  } finally {
    e.restaurar();
  }
});

// --- Cuerpo y parámetros --------------------------------------------------------

for (const [caso, cuerpo] of [['un campo', { observaciones: 'ya no' }], ['un arreglo', [1]]]) {
  test(`D-12: el comensal con cuerpo (${caso}) -> 400 cuerpo_invalido`, async () => {
    const e = escenario();
    try {
      const res = await cancelar(e.jwtComensal, { cuerpo });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('D-12: id inválido -> 400 parametro_invalido', async () => {
  const e = escenario();
  try {
    const res = await cancelar(e.jwtComensal, { pedido: 'abc' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'parametro_invalido');
  } finally {
    e.restaurar();
  }
});
