const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const ctrl = require('../src/controllers/transacciones.controller');
const app = require('../server');

// Voucher del datáfono en POST /api/transacciones/mesa (script 35). La regla de
// la base (CHECK ck_transacciones_voucher) y el guardado real en cada fila, el
// reintento y GET /transacciones están en
// tests/integracion/transacciones-voucher-sql.test.js.

const RUTA = '/api/transacciones/mesa';
const ID_MESA = 5;
const ID_COBRO = '7a1c2e3f-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const BASE = { id_mesa: ID_MESA, monto: 30000, id_cobro: ID_COBRO };

/** Doble de la base para el reparto: un pedido entregado de 30.000. */
function fakeCobro() {
  let cobrado = 0;
  let siguienteId = 700;
  return instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) return { rows: [{ id_mesa: ID_MESA }] };
    if (sql.includes('SELECT 1 FROM transacciones WHERE referencia_externa')) return { rows: [] };
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente')) return { rows: [{ saldo_centavos: String(3000000 - cobrado) }] };
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return { rows: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: '3000000' }] };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      cobrado += params[2];
      siguienteId += 1;
      return { rows: [{ id_transaccion: siguienteId, id_pedido: params[0], monto: String(params[2] / 100), comensal: params[4], voucher: params[5] }] };
    }
    if (sql.includes('count(*)::int AS n FROM pedidos')) return { rows: [{ n: 0 }] };
    if (sql.includes('UPDATE mesas SET estado')) return { rows: [{ id_mesa: ID_MESA }] };
    return { rows: [] };
  });
}

function escenario() {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = fakeCobro();
  return { socket, db, restaurar() { db.restaurar(); socket.restaurar(); } };
}

const cobrar = (cuerpo) => request(app)
  .post(RUTA)
  .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
  .send(cuerpo);

// --- normalizarVoucher, sin HTTP --------------------------------------------------

test('voucher: normaliza con trim (también espacios Unicode) y mayúsculas', () => {
  assert.deepStrictEqual(ctrl.normalizarVoucher('  ab-12 ', 'tarjeta_debito'), { voucher: 'AB-12' });
  assert.deepStrictEqual(ctrl.normalizarVoucher(' ab-12 ', 'tarjeta_credito'), { voucher: 'AB-12' });
  assert.deepStrictEqual(ctrl.normalizarVoucher('\tx9\n', 'tarjeta_credito'), { voucher: 'X9' });
});

test('voucher: ausente, null, vacío o solo espacios -> null (con cualquier método)', () => {
  for (const metodo of ['efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito']) {
    for (const valor of [undefined, null, '', '   ', '  ']) {
      assert.deepStrictEqual(ctrl.normalizarVoucher(valor, metodo), { voucher: null }, `${metodo} ${JSON.stringify(valor)}`);
    }
  }
});

test('voucher: el orden de las comprobaciones (tipo, luego método, luego formato)', () => {
  // Un número con efectivo: manda el TIPO, no el método.
  assert.strictEqual(ctrl.normalizarVoucher(123, 'efectivo').motivo, ctrl.MOTIVO_VOUCHER_INVALIDO);
  // Formato malo con efectivo: manda el MÉTODO (el voucher sobra), no el formato.
  assert.strictEqual(ctrl.normalizarVoucher('ab_12!', 'efectivo').motivo, ctrl.MOTIVO_VOUCHER_NO_APLICA);
  // Formato malo con tarjeta: el FORMATO.
  assert.strictEqual(ctrl.normalizarVoucher('ab_12!', 'tarjeta_debito').motivo, ctrl.MOTIVO_VOUCHER_INVALIDO);
});

// --- POST /transacciones/mesa ----------------------------------------------------

for (const [caso, voucher] of [
  ['un número', 12345],
  ['un objeto', { codigo: 'AB' }],
  ['un booleano', true],
  ['un arreglo', ['AB']],
]) {
  test(`voucher: ${caso} -> 400 voucher_invalido, sin tocar la base`, async () => {
    const e = escenario();
    try {
      const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_debito', voucher });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'voucher_invalido');
      assert.ok(res.body.error);
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

for (const [caso, voucher] of [
  ['caracteres no permitidos (guion bajo)', 'AB_12'],
  ['caracteres no permitidos (espacio en medio)', 'AB 12'],
  ['caracteres no permitidos (tilde)', 'ñ1'],
  ['más de 40 caracteres', 'A'.repeat(41)],
]) {
  test(`voucher: ${caso} con tarjeta -> 400 voucher_invalido`, async () => {
    const e = escenario();
    try {
      const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_credito', voucher });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'voucher_invalido');
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

for (const metodo of ['efectivo', 'transferencia']) {
  test(`voucher: con ${metodo} -> 400 voucher_no_aplica`, async () => {
    const e = escenario();
    try {
      const res = await cobrar({ ...BASE, metodo_pago: metodo, voucher: 'AB-12' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'voucher_no_aplica');
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
    } finally {
      e.restaurar();
    }
  });

  test(`voucher: vacío con ${metodo} -> 201 y a la base va NULL`, async () => {
    const e = escenario();
    try {
      const res = await cobrar({ ...BASE, metodo_pago: metodo, voucher: '   ' });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(e.db.buscar('INSERT INTO transacciones').params[5], null);
      assert.strictEqual(res.body.transacciones[0].voucher, null);
    } finally {
      e.restaurar();
    }
  });
}

test('voucher: 40 caracteres justos con tarjeta valen', async () => {
  const e = escenario();
  try {
    const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_debito', voucher: 'a'.repeat(40) });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(e.db.buscar('INSERT INTO transacciones').params[5], 'A'.repeat(40));
  } finally {
    e.restaurar();
  }
});

for (const metodo of ['tarjeta_debito', 'tarjeta_credito']) {
  test(`voucher: con ${metodo} se guarda normalizado (tipo explícito) y sale en la respuesta`, async () => {
    const e = escenario();
    try {
      const res = await cobrar({ ...BASE, metodo_pago: metodo, voucher: '  ab-12 ' });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const insert = e.db.buscar('INSERT INTO transacciones');
      assert.ok(insert.sql.includes('$6::varchar'), 'tipo explícito');
      assert.strictEqual(insert.params[5], 'AB-12');
      assert.strictEqual(res.body.transacciones[0].voucher, 'AB-12');
    } finally {
      e.restaurar();
    }
  });
}

test('voucher: sin el campo, el cobro sigue igual (voucher null)', async () => {
  const e = escenario();
  try {
    const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_credito' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(e.db.buscar('INSERT INTO transacciones').params[5], null);
  } finally {
    e.restaurar();
  }
});

test('voucher: un campo de más sigue siendo 400 cuerpo_invalido (.strict())', async () => {
  const e = escenario();
  try {
    const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_credito', voucher: 'AB', vaucher: 'AB' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
  } finally {
    e.restaurar();
  }
});

test('voucher: NO viaja en el aviso al socket-server (payment-confirmed)', async () => {
  const e = escenario();
  try {
    const res = await cobrar({ ...BASE, metodo_pago: 'tarjeta_debito', voucher: 'SECRETO-42' });
    assert.strictEqual(res.status, 201);
    await socketNotifier.esperarAvisos();
    assert.ok(e.socket.avisos.length > 0, 'hubo avisos');
    for (const aviso of e.socket.avisos) {
      assert.ok(!JSON.stringify(aviso.cuerpo).includes('SECRETO-42'), `${aviso.ruta} no lleva el voucher`);
      assert.strictEqual(aviso.cuerpo.voucher, undefined);
    }
  } finally {
    e.restaurar();
  }
});
