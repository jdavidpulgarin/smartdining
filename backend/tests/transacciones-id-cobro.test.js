const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');
const ctrl = require('../src/controllers/transacciones.controller');

// Un id_cobro ya usado en OTRA mesa (POST /transacciones/mesa). Antes la
// referencia 'caja:<id_cobro>' ya existía y la ruta contestaba 200 duplicado
// sin cobrar nada: la caja creía que había cobrado. Ahora es 409
// id_cobro_en_uso. El pago en línea (/internal) NO cambia: una referencia ya
// registrada sigue siendo duplicado, sea de la mesa que sea.

const ID_MESA = 5;
const OTRA_MESA = 9;
const ID_COBRO = '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f';

/**
 * @param {{mesaDeLaReferencia?: number|null, choque?: boolean}} o
 *   mesaDeLaReferencia: la mesa del pedido de la transacción que ya tiene esa
 *     referencia (null = nadie la tiene todavía).
 *   choque: el INSERT choca con el índice único (23505), como en una carrera.
 */
function fakeReferencia({ mesaDeLaReferencia = null, choque = false } = {}) {
  let insertado = false;
  return instalarFakeDb((sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) return { rows: [{ id_mesa: ID_MESA }] };
    if (sql.includes('SELECT 1 FROM transacciones WHERE referencia_externa')) {
      return mesaDeLaReferencia !== null && !choque ? { rows: [{ '?column?': 1 }] } : { rows: [] };
    }
    if (sql.includes('SELECT p.id_mesa') && sql.includes('JOIN pedidos p')) {
      // En la carrera, la fila del otro aparece solo después del choque.
      if (choque && !insertado) return { rows: [] };
      return mesaDeLaReferencia !== null ? { rows: [{ id_mesa: mesaDeLaReferencia }] } : { rows: [] };
    }
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente')) return { rows: [{ saldo_centavos: '3000000' }] };
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return { rows: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: '3000000' }] };
    }
    if (sql.includes('INSERT INTO transacciones') && choque) {
      insertado = true;
      const err = new Error('duplicate key value violates unique constraint "uq_transacciones_referencia_externa"');
      err.code = '23505';
      throw err;
    }
    return { rows: [] };
  });
}

const cobrar = () => request(app)
  .post('/api/transacciones/mesa')
  .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
  .send({ id_mesa: ID_MESA, monto: 30000, metodo_pago: 'efectivo', id_cobro: ID_COBRO });

test('id_cobro: ya usado en OTRA mesa -> 409 id_cobro_en_uso, sin escribir nada', async () => {
  const db = fakeReferencia({ mesaDeLaReferencia: OTRA_MESA });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVO_ID_COBRO_EN_USO);
    assert.strictEqual(res.body.error, 'Ese id_cobro ya se usó en otra mesa; genera uno nuevo');
    assert.ok(!('duplicado' in res.body), 'no es un duplicado');
    assert.strictEqual(db.todas('INSERT INTO transacciones').length, 0);
    assert.strictEqual(db.todas('COMMIT').length, 0);
  } finally {
    db.restaurar();
  }
});

test('id_cobro: ya usado en la MISMA mesa -> sigue siendo 200 duplicado', async () => {
  const db = fakeReferencia({ mesaDeLaReferencia: ID_MESA });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { duplicado: true, saldo_restante: 30000 });
  } finally {
    db.restaurar();
  }
});

test('id_cobro: carrera (23505) con la misma referencia en OTRA mesa -> 409, no duplicado', async () => {
  const db = fakeReferencia({ mesaDeLaReferencia: OTRA_MESA, choque: true });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVO_ID_COBRO_EN_USO);
  } finally {
    db.restaurar();
  }
});

test('id_cobro: carrera (23505) en la MISMA mesa -> 200 duplicado, como antes', async () => {
  const db = fakeReferencia({ mesaDeLaReferencia: ID_MESA, choque: true });
  try {
    const res = await cobrar();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.duplicado, true);
  } finally {
    db.restaurar();
  }
});

test('el pago en linea (/internal) NO cambia: una referencia de otra mesa sigue siendo duplicado', async () => {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = fakeReferencia({ mesaDeLaReferencia: OTRA_MESA });
  try {
    const res = await request(app)
      .post('/api/transacciones/internal')
      .set('x-internal-key', CLAVE_FALSA)
      .send({
        referencia_externa: 'SD-5-1760212345678-Qm9vX2E', id_transaccion_pasarela: '1132-9',
        pasarela: 'wompi', id_mesa: ID_MESA, comensal: null, modo: 'igual',
        monto_centavos: 3000000, moneda: 'COP', metodo_pago: 'online',
      });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      ok: true, duplicado: true, saldo_restante_centavos: 3000000, mesa_liberada: false,
    }, 'la misma respuesta de siempre, sin campos nuevos');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
