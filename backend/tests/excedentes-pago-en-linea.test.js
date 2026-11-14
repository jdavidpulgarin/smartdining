const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

// T4 (EVENTS.md §8.7): los excedentes de pagos en línea de mesa, para la Caja.
//   GET   /api/excedentes-pago-en-linea?estado=pendiente
//   PATCH /api/excedentes-pago-en-linea/:id/devuelto
// Roles: admin y cajero. Lo que hace la base (CHECK, FK, el UPDATE condicional
// con dos cajeros a la vez) está en tests/integracion/excedentes-pago-en-linea-sql.test.js.

const RUTA = '/api/excedentes-pago-en-linea';

const FILA = {
  id: 7, id_mesa: 5, comensal: 'Ana', referencia_externa: 'SD-5-1', id_transaccion: 812,
  monto_centavos: '3333300', aplicado_centavos: '2000000', excedente_centavos: '1333300',
  motivo: 'excede_saldo_comensal', estado: 'pendiente', devuelto_por: null, devuelto_en: null,
  creado_en: '2026-11-14T20:15:00.000Z',
};

/** @param {{lista?: object[], actualizada?: object|null, actual?: object|null, falla?: Error}} o */
function fakeExcedentes({ lista = [FILA], actualizada = null, actual = null, falla = null } = {}) {
  return instalarFakeDb((sql) => {
    if (falla && sql.includes('UPDATE excedentes_pago_en_linea')) throw falla;
    if (sql.includes('UPDATE excedentes_pago_en_linea')) return { rows: actualizada ? [actualizada] : [] };
    if (sql.includes('FROM excedentes_pago_en_linea WHERE id = $1::int')) return { rows: actual ? [actual] : [] };
    if (sql.includes('FROM excedentes_pago_en_linea')) return { rows: lista };
    return { rows: [] };
  });
}

const cajero = () => `Bearer ${tokenStaff(4, 'cajero')}`;

test('excedentes: GET sin estado lista los pendientes, con los montos como números', async () => {
  const db = fakeExcedentes();
  try {
    const res = await request(app).get(RUTA).set('Authorization', cajero());
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.estado, 'pendiente');
    assert.deepStrictEqual(res.body.excedentes[0], {
      ...FILA, monto_centavos: 3333300, aplicado_centavos: 2000000, excedente_centavos: 1333300,
    });
    const q = db.buscar('FROM excedentes_pago_en_linea');
    assert.deepStrictEqual(q.params, ['pendiente']);
    assert.match(q.sql, /ORDER BY creado_en ASC, id ASC/);
  } finally {
    db.restaurar();
  }
});

test('excedentes: GET ?estado=devuelto, y un estado que no existe -> 400 consulta_invalida', async () => {
  const db = fakeExcedentes({ lista: [] });
  try {
    const ok = await request(app).get(`${RUTA}?estado=devuelto`).set('Authorization', cajero());
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(db.buscar('FROM excedentes_pago_en_linea').params, ['devuelto']);
    const mal = await request(app).get(`${RUTA}?estado=todos`).set('Authorization', cajero());
    assert.strictEqual(mal.status, 400);
    assert.strictEqual(mal.body.motivo, 'consulta_invalida');
    const extra = await request(app).get(`${RUTA}?estado=pendiente&x=1`).set('Authorization', cajero());
    assert.strictEqual(extra.status, 400, 'un parámetro de más');
  } finally {
    db.restaurar();
  }
});

test('excedentes: PATCH /:id/devuelto lo marca con el usuario del JWT, solo si seguía pendiente', async () => {
  const devuelto = { ...FILA, estado: 'devuelto', devuelto_por: 4, devuelto_en: '2026-11-14T21:00:00.000Z' };
  const db = fakeExcedentes({ actualizada: devuelto });
  try {
    const res = await request(app).patch(`${RUTA}/7/devuelto`).set('Authorization', cajero());
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.excedente.estado, 'devuelto');
    assert.strictEqual(res.body.excedente.devuelto_por, 4);
    const u = db.buscar('UPDATE excedentes_pago_en_linea');
    assert.deepStrictEqual(u.params, [7, 4], 'el id y quién lo marcó (del JWT, nunca del cuerpo)');
    assert.match(u.sql, /WHERE id = \$1::int AND estado = 'pendiente'/, 'UPDATE condicional');
    assert.match(u.sql, /devuelto_en = now\(\)/);
  } finally {
    db.restaurar();
  }
});

test('excedentes: PATCH de uno ya devuelto -> 409 ya_devuelto con cómo quedó', async () => {
  const yaDevuelto = { ...FILA, estado: 'devuelto', devuelto_por: 2, devuelto_en: '2026-11-14T20:30:00.000Z' };
  const db = fakeExcedentes({ actualizada: null, actual: yaDevuelto });
  try {
    const res = await request(app).patch(`${RUTA}/7/devuelto`).set('Authorization', cajero());
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'ya_devuelto');
    assert.strictEqual(res.body.excedente.devuelto_por, 2, 'quien lo marcó primero');
  } finally {
    db.restaurar();
  }
});

test('excedentes: PATCH de uno que no existe -> 404; id inválido -> 400 parametro_invalido', async () => {
  const db = fakeExcedentes({ actualizada: null, actual: null });
  try {
    const no = await request(app).patch(`${RUTA}/99/devuelto`).set('Authorization', cajero());
    assert.strictEqual(no.status, 404);
    for (const id of ['0', 'abc', '1.5', '99999999999']) {
      const mal = await request(app).patch(`${RUTA}/${id}/devuelto`).set('Authorization', cajero());
      assert.strictEqual(mal.status, 400, id);
      assert.strictEqual(mal.body.motivo, 'parametro_invalido', id);
    }
  } finally {
    db.restaurar();
  }
});

test('excedentes: el usuario del JWT ya no existe (fk_excedentes_devuelto_por) -> 409 autor_inexistente', async () => {
  const err = Object.assign(new Error('insert or update violates foreign key constraint'), {
    code: '23503', constraint: 'fk_excedentes_devuelto_por',
  });
  const db = fakeExcedentes({ falla: err });
  try {
    const res = await request(app).patch(`${RUTA}/7/devuelto`).set('Authorization', cajero());
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'autor_inexistente');
  } finally {
    db.restaurar();
  }
});

test('excedentes: también en /api/v1, como las demás rutas de cobro', async () => {
  const db = fakeExcedentes();
  try {
    const res = await request(app).get('/api/v1/excedentes-pago-en-linea').set('Authorization', cajero());
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  } finally {
    db.restaurar();
  }
});
