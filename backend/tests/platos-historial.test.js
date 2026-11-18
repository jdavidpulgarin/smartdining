const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const platosService = require('../src/services/platos.service');

// D-16 parte B (P2): GET /api/platos/:id/historial-precios.
//
// Las filas las escriben los triggers (ver historial-precios.test.js); esto es
// solo la lectura, y es de admin: dice que decisiones de precio tomo el negocio
// y quien las tomo, que no es informacion de sala.

const PLATO = { id_plato: 7, nombre: 'Bandeja paisa', precio: 30000 };

const FILAS = [
  { id: 12, tipo: 'plato', id_referencia: 7, precio_anterior: 28000, precio_nuevo: 30000, id_usuario: 1, cambiado_en: '2026-11-08T12:00:00.000Z' },
  { id: 5, tipo: 'plato', id_referencia: 7, precio_anterior: 25000, precio_nuevo: 28000, id_usuario: null, cambiado_en: '2026-10-01T09:00:00.000Z' },
];

const admin = () => tokenStaff(1, 'admin');

/** @param {{plato?: object|null, filas?: Array}} opciones */
function fakeDb({ plato = PLATO, filas = FILAS } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) return { rows: plato ? [plato] : [] };
    if (sql.includes('FROM historial_precios')) return { rows: filas };
    return undefined;
  });
}

const pedir = (url, token = admin()) => request(app)
  .get(url)
  .set('Authorization', `Bearer ${token}`);

// ---------------------------------------------------------------------------
// Permisos
// ---------------------------------------------------------------------------

test('d-16b: el historial de precios es solo de admin', async () => {
  const db = fakeDb();
  try {
    assert.strictEqual((await request(app).get('/api/platos/7/historial-precios')).status, 401);
    for (const rol of ['mesero', 'cajero', 'cocina']) {
      assert.strictEqual((await pedir('/api/platos/7/historial-precios', tokenStaff(4, rol))).status, 403, rol);
    }
    const res = await pedir('/api/platos/7/historial-precios', tokenComensal(5));
    assert.strictEqual(res.status, 403, 'comensal');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

test('d-16b: devuelve los cambios, los mas recientes primero', async () => {
  const db = fakeDb();
  try {
    const res = await pedir('/api/platos/7/historial-precios');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.historial.map((f) => f.id), [12, 5]);
    assert.strictEqual(res.body.historial[0].precio_anterior, 28000);
    assert.strictEqual(res.body.historial[0].precio_nuevo, 30000);
    // El orden lo pide el SQL y lo sirve el indice idx_historial_precios_referencia.
    const consulta = db.buscar('FROM historial_precios');
    assert.ok(consulta.sql.includes('ORDER BY cambiado_en DESC'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: filtra por ese plato y por tipo plato', async () => {
  const db = fakeDb();
  try {
    await pedir('/api/platos/7/historial-precios');

    const consulta = db.buscar('FROM historial_precios');
    assert.ok(consulta.sql.includes("tipo = 'plato'"), 'no mezcla ingredientes');
    assert.strictEqual(consulta.params[0], 7);
  } finally {
    db.restaurar();
  }
});

test('d-16b: id_usuario puede venir en null y se devuelve tal cual', async () => {
  // Un cambio anterior a D-16 B, una consulta a mano, o un usuario borrado (la
  // FK es ON DELETE SET NULL).
  const db = fakeDb();
  try {
    const res = await pedir('/api/platos/7/historial-precios');
    assert.strictEqual(res.body.historial[1].id_usuario, null);
  } finally {
    db.restaurar();
  }
});

test('d-16b: un plato sin cambios devuelve una lista vacia', async () => {
  const db = fakeDb({ filas: [] });
  try {
    const res = await pedir('/api/platos/7/historial-precios');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { historial: [] });
  } finally {
    db.restaurar();
  }
});

test('d-16b: un plato que no existe es 404, no una lista vacia', async () => {
  // Con una lista vacia en los dos casos, un id mal escrito pareceria un plato
  // sin historia.
  const db = fakeDb({ plato: null });
  try {
    const res = await pedir('/api/platos/999/historial-precios');

    assert.strictEqual(res.status, 404);
    assert.ok(!db.buscar('FROM historial_precios'), 'ni se consulta el historial');
  } finally {
    db.restaurar();
  }
});

test('d-16b: un id que no es entero positivo es 400', async () => {
  const db = fakeDb();
  try {
    for (const malo of ['abc', '0', '-3', '1.5']) {
      assert.strictEqual((await pedir(`/api/platos/${malo}/historial-precios`)).status, 400, malo);
    }
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El tope de filas
// ---------------------------------------------------------------------------

test('d-16b: por defecto pide 100 filas', async () => {
  const db = fakeDb();
  try {
    await pedir('/api/platos/7/historial-precios');
    assert.strictEqual(db.buscar('FROM historial_precios').params[1], 100);
  } finally {
    db.restaurar();
  }
});

test('d-16b: limite acota las filas', async () => {
  const db = fakeDb();
  try {
    await pedir('/api/platos/7/historial-precios?limite=10');
    assert.strictEqual(db.buscar('FROM historial_precios').params[1], 10);
  } finally {
    db.restaurar();
  }
});

test('d-16b: un limite enorme se recorta al tope', async () => {
  const db = fakeDb();
  try {
    await pedir('/api/platos/7/historial-precios?limite=99999');
    assert.strictEqual(
      db.buscar('FROM historial_precios').params[1],
      platosService.MAX_HISTORIAL,
      'defensivo: no se devuelve una respuesta de megas'
    );
  } finally {
    db.restaurar();
  }
});

test('d-16b: un limite invalido es 400', async () => {
  const db = fakeDb();
  try {
    for (const malo of ['0', '-5', 'muchas', '1.5']) {
      assert.strictEqual(
        (await pedir(`/api/platos/7/historial-precios?limite=${malo}`)).status,
        400,
        malo
      );
    }
  } finally {
    db.restaurar();
  }
});

test('d-16b: la ruta no se confunde con GET /platos/:id', async () => {
  // 'historial-precios' iria como id si la ruta estuviera declarada despues.
  const db = fakeDb();
  try {
    const res = await pedir('/api/platos/7/historial-precios');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.historial), 'devuelve el historial, no el plato');
    assert.strictEqual(res.body.id_plato, undefined);
  } finally {
    db.restaurar();
  }
});
