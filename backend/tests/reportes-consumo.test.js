const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');

// GET /api/reportes/consumo (plan v1.1, D-17 P3). Lo que calcula la base
// (signos, merma de cocina, días de Bogotá) está en
// tests/integracion/reportes-consumo-sql.test.js.

const URL = '/api/reportes/consumo';

/** Una fila de la consulta: insumo x día, con los totales de su ventana. NUMERIC llega como texto. */
const fila = (id_insumo, nombre, unidad, fecha, [c, m, e, a], totales) => ({
  id_insumo, nombre, unidad, fecha,
  consumo: c, merma: m, entradas: e, ajustes: a,
  total_consumo: totales[0], total_merma: totales[1], total_entradas: totales[2], total_ajustes: totales[3],
});

function fakeConsumo({ futura = false, insumoExiste = true, filas = [] } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('AS insumo_existe')) return { rows: [{ hoy: '2026-11-12', futura, insumo_existe: insumoExiste }] };
    if (sql.includes('WITH lim AS')) return { rows: filas };
    return { rows: [] };
  });
}

const pedir = (query, jwt = tokenStaff(1, 'admin')) => {
  const r = request(app).get(URL).query(query);
  return jwt ? r.set('Authorization', `Bearer ${jwt}`) : r;
};

const OK = { desde: '2026-11-01', hasta: '2026-11-10' };

// --- Quién --------------------------------------------------------------------

test('consumo: sin sesión -> 401', async () => {
  const db = fakeConsumo();
  try {
    assert.strictEqual((await pedir(OK, null)).status, 401);
  } finally {
    db.restaurar();
  }
});

test('consumo: mesero, cajero, cocina y comensal -> 403; admin -> 200', async () => {
  const db = fakeConsumo();
  try {
    for (const rol of ['mesero', 'cajero', 'cocina']) {
      assert.strictEqual((await pedir(OK, tokenStaff(1, rol))).status, 403, rol);
    }
    assert.strictEqual((await pedir(OK, tokenComensal(5))).status, 403, 'comensal');
    assert.strictEqual(db.buscar('BEGIN'), undefined, 'nadie sin permiso llega a la base');
    assert.strictEqual((await pedir(OK)).status, 200);
  } finally {
    db.restaurar();
  }
});

// --- Validación -----------------------------------------------------------------

for (const [caso, query] of [
  ['sin desde', { hasta: '2026-11-10' }],
  ['sin hasta', { desde: '2026-11-01' }],
  ['fecha con otro formato', { desde: '01/11/2026', hasta: '2026-11-10' }],
  ['fecha que no existe (30 de febrero)', { desde: '2026-02-30', hasta: '2026-03-02' }],
  ['mes 13', { desde: '2026-13-01', hasta: '2026-13-02' }],
  ['hasta anterior a desde', { desde: '2026-11-10', hasta: '2026-11-01' }],
  ['más de 31 días', { desde: '2026-10-01', hasta: '2026-11-01' }],
  ['un campo extra', { ...OK, rango: 'mes' }],
  ['id_insumo no numérico', { ...OK, id_insumo: 'abc' }],
  ['id_insumo 0', { ...OK, id_insumo: '0' }],
  ['id_insumo decimal', { ...OK, id_insumo: '1.5' }],
]) {
  test(`consumo: ${caso} -> 400 consulta_invalida, sin tocar la base`, async () => {
    const db = fakeConsumo();
    try {
      const res = await pedir(query);
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, 'consulta_invalida');
      assert.ok(res.body.error);
      assert.strictEqual(db.buscar('BEGIN'), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('consumo: 31 días justos (del 1 al 31) vale', async () => {
  const db = fakeConsumo();
  try {
    assert.strictEqual((await pedir({ desde: '2026-10-01', hasta: '2026-10-31' })).status, 200);
  } finally {
    db.restaurar();
  }
});

test('consumo: hasta futura respecto a hoy en Bogotá -> 400 (lo decide la base) y ROLLBACK', async () => {
  const db = fakeConsumo({ futura: true });
  try {
    const res = await pedir({ desde: '2026-11-10', hasta: '2026-11-13' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'consulta_invalida');
    assert.match(res.body.error, /2026-11-12/);
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(db.buscar('WITH lim AS'), undefined, 'no se consultan los datos');
  } finally {
    db.restaurar();
  }
});

test('consumo: id_insumo que no existe -> 404', async () => {
  const db = fakeConsumo({ insumoExiste: false });
  try {
    const res = await pedir({ ...OK, id_insumo: '99999' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.motivo, 'no_encontrado');
    assert.deepStrictEqual(db.buscar('AS insumo_existe').params.slice(2), ['2026-11-10', 99999]);
  } finally {
    db.restaurar();
  }
});

// --- Forma de la respuesta --------------------------------------------------------

test('consumo: forma de la respuesta, números como número y una transacción de solo lectura', async () => {
  const db = fakeConsumo({
    filas: [
      fila(3, 'Arroz', 'g', '2026-11-02', ['300.00', '0', '1000.00', '-50.00'], ['450.00', '20.00', '1000.00', '-50.00']),
      fila(3, 'Arroz', 'g', '2026-11-05', ['150.00', '20.00', '0', '0'], ['450.00', '20.00', '1000.00', '-50.00']),
      fila(7, 'Pan brioche', 'unidad', '2026-11-05', ['2.00', '0', '0', '0'], ['2.00', '0', '0', '0']),
    ],
  });
  try {
    const res = await pedir(OK);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body, {
      desde: '2026-11-01',
      hasta: '2026-11-10',
      insumos: [
        {
          id_insumo: 3, nombre: 'Arroz', unidad: 'g',
          total: { consumo: 450, merma: 20, entradas: 1000, ajustes: -50 },
          dias: [
            { fecha: '2026-11-02', consumo: 300, merma: 0, entradas: 1000, ajustes: -50 },
            { fecha: '2026-11-05', consumo: 150, merma: 20, entradas: 0, ajustes: 0 },
          ],
        },
        {
          id_insumo: 7, nombre: 'Pan brioche', unidad: 'unidad',
          total: { consumo: 2, merma: 0, entradas: 0, ajustes: 0 },
          dias: [{ fecha: '2026-11-05', consumo: 2, merma: 0, entradas: 0, ajustes: 0 }],
        },
      ],
    });
    for (const i of res.body.insumos) {
      for (const v of [...Object.values(i.total), ...i.dias.flatMap((d) => [d.consumo, d.merma, d.entradas, d.ajustes])]) {
        assert.strictEqual(typeof v, 'number');
      }
    }
    assert.ok(db.buscar('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert.ok(db.buscar('COMMIT'));
    assert.deepStrictEqual(db.buscar('WITH lim AS').params, ['America/Bogota', '2026-11-01', '2026-11-10', null]);
  } finally {
    db.restaurar();
  }
});

test('consumo: el insumo pedido sin movimientos sale con totales en 0 y dias vacío', async () => {
  const db = fakeConsumo({ filas: [fila(9, 'Sal', 'g', null, [null, null, null, null], ['0', '0', '0', '0'])] });
  try {
    const res = await pedir({ ...OK, id_insumo: '9' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.insumos, [
      { id_insumo: 9, nombre: 'Sal', unidad: 'g', total: { consumo: 0, merma: 0, entradas: 0, ajustes: 0 }, dias: [] },
    ]);
    assert.strictEqual(db.buscar('WITH lim AS').params[3], 9);
  } finally {
    db.restaurar();
  }
});

test('consumo: sin movimientos en el rango -> insumos vacío', async () => {
  const db = fakeConsumo();
  try {
    const res = await pedir(OK);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { desde: '2026-11-01', hasta: '2026-11-10', insumos: [] });
  } finally {
    db.restaurar();
  }
});
