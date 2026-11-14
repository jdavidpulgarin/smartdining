const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');

// T4 (§6.6, #260): cancelar un PEDIDO ENTERO consulta antes
// GET /internal/pagos-en-curso?mesa=<id> SIN comensal, antes de abrir la
// transacción. Dos caminos:
//   - COMENSAL: POST /api/pedidos/:id/cancelar (cancelarPedidoComensal).
//   - PERSONAL: POST /api/pedidos/:id/cancelar y PATCH /api/pedidos/:id/estado
//     a 'cancelado' (los dos van por actualizarEstado).
// Un pago en curso -> 409 pago_en_curso (sin detalle); si no se pudo verificar,
// el mismo 409 con detalle 'sin_verificar'. Sin mesa (domicilio) no consulta.

const MESA = 5;
const PEDIDO = 87;
const RUTA = '/internal/pagos-en-curso';

const MENSAJE_EN_CURSO = 'Hay un pago en curso en esta mesa. Espera un momento e inténtalo de nuevo.';
const MENSAJE_SIN_VERIFICAR =
  'No se pudo comprobar si hay un pago en curso en esta mesa. Espera un momento e inténtalo de nuevo.';

function sesionComensal(alias = 'Ana', idMesa = MESA) {
  const { token, sid } = construirTokenQr(idMesa);
  const jwtComensal = jwt.sign({ id_mesa: idMesa, sid, rol: 'comensal', comensal: alias }, process.env.JWT_SECRET, {
    expiresIn: '3h',
  });
  return { jwtComensal, tokenQr: token };
}

const pedidoEn = (estado = 'recibido', extra = {}) => ({
  id_pedido: PEDIDO, id_mesa: MESA, codigo_pedido: 'PED-261114-ABCDE', estado, total: 45000, creado_en: new Date(), ...extra,
});

/** Base doble para los dos caminos. */
function fakeDb({ pedido = pedidoEn(), tokenQr } = {}) {
  return instalarFakeDb((sql, params) => {
    // T4: la lectura previa (sin bloquear).
    if (sql.includes('SELECT id_mesa, estado FROM pedidos WHERE id_pedido = $1::int')) {
      return { rows: pedido ? [{ id_mesa: pedido.id_mesa, estado: pedido.estado }] : [] };
    }
    // Comensal (cancelarPedidoComensal).
    if (sql.includes('total, creado_en') && sql.includes('FOR UPDATE')) return { rows: pedido ? [pedido] : [] };
    if (sql.includes('SELECT sesion_iniciada_en FROM mesas')) return { rows: [{ sesion_iniciada_en: null }] };
    if (sql.includes('ORDER BY id_detalle FOR UPDATE')) return { rows: [{ id_detalle: 1, comensal: 'Ana', estado_item: 'pendiente' }] };
    if (sql.includes('FROM transacciones')) return { rows: [{ hay: false }] };
    if (sql.includes('total FROM pedidos WHERE id_pedido')) return { rows: [{ ...pedido, estado: 'cancelado', total: 0 }] };
    if (sql.includes('json_agg')) return { rows: [] };
    // Personal (actualizarEstado).
    if (sql.includes('SELECT estado FROM pedidos WHERE id_pedido')) return { rows: pedido ? [{ estado: pedido.estado }] : [] };
    if (sql.includes('UPDATE pedidos SET estado = $1')) return { rows: [{ ...pedido, estado: params[0] }] };
    return { rows: [] };
  }, { tokenQrDeMesa: tokenQr, pedidosAbiertos: 1 });
}

/** El socket-server doble: `consulta()` contesta pagos-en-curso; los avisos, { ok: true }. */
function escenario({ pedido, consulta = () => ({ mesa: MESA, enCurso: false, pagos: [] }), alias = 'Ana' } = {}) {
  const s = sesionComensal(alias);
  const socket = instalarFakeSocket((ruta) => (ruta.startsWith(RUTA) ? consulta() : { ok: true }));
  const db = fakeDb({ pedido, tokenQr: s.tokenQr });
  return { ...s, db, socket, restaurar() { db.restaurar(); socket.restaurar(); } };
}

function consultaHecha(e) {
  const a = e.socket.avisos.find((x) => x.ruta.startsWith(RUTA));
  return a ? Object.fromEntries(new URLSearchParams(a.ruta.split('?')[1] || '')) : undefined;
}

const sinTransaccion = (e) => {
  assert.strictEqual(e.db.buscar('BEGIN'), undefined, 'no abre la transacción');
  assert.strictEqual(e.db.buscar('FOR UPDATE'), undefined, 'ni bloquea nada');
  assert.strictEqual(e.db.buscar('UPDATE pedidos'), undefined);
};

const silenciado = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

// Los tres caminos que cancelan un pedido entero.
const CAMINOS = [
  ['comensal POST /:id/cancelar', (e) => request(app).post(`/api/pedidos/${PEDIDO}/cancelar`).set('Authorization', `Bearer ${e.jwtComensal}`)],
  ['personal POST /:id/cancelar', () => request(app).post(`/api/pedidos/${PEDIDO}/cancelar`).set('Authorization', `Bearer ${tokenStaff(7, 'mesero')}`)],
  [
    'personal PATCH /:id/estado a cancelado',
    () => request(app).patch(`/api/pedidos/${PEDIDO}/estado`).set('Authorization', `Bearer ${tokenStaff(7, 'mesero')}`).send({ estado: 'cancelado' }),
  ],
];

for (const [camino, pedir] of CAMINOS) {
  test(`t4 pedido entero (${camino}): enCurso true -> 409 pago_en_curso SIN detalle, consulta SIN comensal y sin abrir la transacción`, async () => {
    const e = escenario({ consulta: () => ({ mesa: MESA, enCurso: true, pagos: [] }) });
    try {
      const res = await pedir(e);
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body, { error: MENSAJE_EN_CURSO, motivo: 'pago_en_curso' });
      assert.deepStrictEqual(consultaHecha(e), { mesa: String(MESA) }, 'sin comensal');
      sinTransaccion(e);
    } finally {
      e.restaurar();
    }
  });

  test(`t4 pedido entero (${camino}): 5xx -> 409 pago_en_curso con detalle sin_verificar`, async () => {
    const e = escenario({ consulta: () => ({ __status: 500, error: 'x', codigo: 'ERROR_INTERNO' }) });
    try {
      const res = await silenciado(() => pedir(e));
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body, { error: MENSAJE_SIN_VERIFICAR, motivo: 'pago_en_curso', detalle: 'sin_verificar' });
      sinTransaccion(e);
    } finally {
      e.restaurar();
    }
  });

  test(`t4 pedido entero (${camino}): enCurso false -> cancela (200)`, async () => {
    const e = escenario();
    try {
      const res = await pedir(e);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.deepStrictEqual(consultaHecha(e), { mesa: String(MESA) });
      assert.ok(e.db.buscar('BEGIN'), 'después sí abre la transacción');
    } finally {
      e.restaurar();
    }
  });
}

test('t4 pedido entero: un domicilio (sin mesa) no consulta (personal)', async () => {
  const e = escenario({ pedido: pedidoEn('recibido', { id_mesa: null }), consulta: () => ({ mesa: MESA, enCurso: true, pagos: [] }) });
  try {
    const res = await request(app).post(`/api/pedidos/${PEDIDO}/cancelar`).set('Authorization', `Bearer ${tokenStaff(7, 'admin')}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(consultaHecha(e), undefined);
  } finally {
    e.restaurar();
  }
});

test('t4 pedido entero: un pedido ya cancelado no consulta (cada camino responde lo suyo)', async () => {
  const e = escenario({ pedido: pedidoEn('cancelado'), consulta: () => ({ mesa: MESA, enCurso: true, pagos: [] }) });
  try {
    const res = await request(app).post(`/api/pedidos/${PEDIDO}/cancelar`).set('Authorization', `Bearer ${e.jwtComensal}`);
    assert.strictEqual(res.body.motivo, 'pedido_ya_cancelado');
    assert.strictEqual(consultaHecha(e), undefined);
  } finally {
    e.restaurar();
  }
});

test('t4 pedido entero: el comensal con un pedido de OTRA mesa no consulta (el 403 de siempre)', async () => {
  const e = escenario({ pedido: pedidoEn('recibido', { id_mesa: 9 }), consulta: () => ({ mesa: 9, enCurso: true, pagos: [] }) });
  try {
    const res = await request(app).post(`/api/pedidos/${PEDIDO}/cancelar`).set('Authorization', `Bearer ${e.jwtComensal}`);
    assert.strictEqual(res.status, 403, JSON.stringify(res.body));
    assert.strictEqual(consultaHecha(e), undefined);
  } finally {
    e.restaurar();
  }
});

test('t4 pedido entero: un cambio de estado que NO es cancelar no consulta', async () => {
  const e = escenario({ consulta: () => ({ mesa: MESA, enCurso: true, pagos: [] }) });
  try {
    const res = await request(app)
      .patch(`/api/pedidos/${PEDIDO}/estado`)
      .set('Authorization', `Bearer ${tokenStaff(7, 'mesero')}`)
      .send({ estado: 'en_preparacion' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(consultaHecha(e), undefined);
  } finally {
    e.restaurar();
  }
});
