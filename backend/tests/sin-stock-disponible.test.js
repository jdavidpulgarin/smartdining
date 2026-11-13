const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const { traducirErrorInventario } = require('../src/middleware/inventario-errores');
const { porcionesPedidas, faltantesDelDetalle } = require('../src/services/disponible-sin-stock');

// T5: el 409 sin_stock dice cuánto se puede pedir de cada faltante
// (`disponible`), para el "Ajustar a N" de la PWA. El cálculo de verdad (la
// fórmula de fn_consumo_detalle contra el stock real) lo prueba
// tests/integracion/sin-stock-disponible-sql.test.js.

const MESA = 5;
const PEDIDO = { id_pedido: 87, id_mesa: MESA, codigo_pedido: 'PED-261113-ABC12', estado: 'recibido' };

/** El DETAIL de SD001 tal como lo arma 27_inventario.sql. */
const errorSinStock = (faltantes, message = 'Sin stock suficiente para el pedido 87') =>
  Object.assign(new Error(message), { code: 'SD001', detail: JSON.stringify({ faltantes }) });

const FALTANTES = [
  { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo', id_insumo: 3, insumo: 'Masa', necesita: 600, hay: 250 },
  { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo', id_insumo: 4, insumo: 'Queso', necesita: 60, hay: 10 },
  { tipo: 'ingrediente', id: 7, nombre: 'Panceta', id_insumo: 9, insumo: 'Panceta cruda', necesita: 90, hay: 50 },
];

/**
 * Doble de la base: el pedido falla en el COMMIT con el SD001, y la consulta
 * de disponibles (jsonb_to_recordset) contesta `disponibles` o lanza.
 */
function fakeSinStock({ disponibles = [], fallaDisponibles = null } = {}) {
  return instalarFakeDb((sql) => {
    if (sql === 'COMMIT') throw errorSinStock(FALTANTES);
    if (sql.includes('jsonb_to_recordset')) {
      if (fallaDisponibles) throw fallaDisponibles;
      return { rows: disponibles };
    }
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta: { comensales: [] } }] };
    return { rows: [] };
  });
}

async function conDobles(opciones, fn) {
  const db = fakeSinStock(opciones);
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    return await fn(db, socket);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
}

const ITEMS = [
  { id_plato: 12, cantidad: 3 },
  { id_plato: 20, cantidad: 1, ingredientes: [{ id_ingrediente: 7, porcion: 'extra' }] },
];

const pedirMesero = (items = ITEMS) =>
  request(app).post('/api/pedidos').set('Authorization', `Bearer ${tokenStaff(9, 'mesero')}`).send({ id_mesa: MESA, items });

// ---------------------------------------------------------------------------
// La traducción
// ---------------------------------------------------------------------------

test('t5: con disponibles, cada faltante lleva `disponible` (y nada del inventario)', () => {
  const err = errorSinStock(FALTANTES);
  err.disponibles = new Map([['plato:12', 2], ['ingrediente:7', 0]]);
  const { status, cuerpo } = traducirErrorInventario(err);
  assert.strictEqual(status, 409);
  assert.deepStrictEqual(cuerpo, {
    error: 'Sin stock suficiente para el pedido 87',
    motivo: 'sin_stock',
    faltantes: [
      { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo', disponible: 2 },
      { tipo: 'ingrediente', id: 7, nombre: 'Panceta', disponible: 0 },
    ],
  });
  for (const prohibido of ['id_insumo', 'insumo', 'necesita', 'hay']) {
    assert.ok(!JSON.stringify(cuerpo).includes(`"${prohibido}"`), prohibido);
  }
});

test('t5: sin entrada en el Map (no tiene receta) o con un valor raro, la fila sale sin `disponible`', () => {
  const err = errorSinStock(FALTANTES);
  err.disponibles = new Map([['ingrediente:7', -1], ['plato:99', 4]]);
  const { cuerpo } = traducirErrorInventario(err);
  assert.deepStrictEqual(cuerpo.faltantes, [
    { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' },
    { tipo: 'ingrediente', id: 7, nombre: 'Panceta' },
  ]);
});

test('t5: sin Map (no se calculó) el 409 es el de siempre', () => {
  const { cuerpo } = traducirErrorInventario(errorSinStock(FALTANTES));
  assert.deepStrictEqual(Object.keys(cuerpo.faltantes[0]).sort(), ['id', 'nombre', 'tipo']);
});

test('t5: faltantes del DETAIL sin repetir, y porciones pedidas por opción', () => {
  assert.deepStrictEqual(faltantesDelDetalle(errorSinStock(FALTANTES)), [
    { tipo: 'plato', id: 12 },
    { tipo: 'ingrediente', id: 7 },
  ]);
  assert.deepStrictEqual(faltantesDelDetalle({ detail: 'no es json' }), []);
  const p = porcionesPedidas([
    { ingredientes: [{ id_ingrediente: 7, porcion: 'normal' }] },
    { ingredientes: [{ id_ingrediente: 7, porcion: 'extra' }, { id_ingrediente: 8 }] },
  ]);
  assert.deepStrictEqual([...p.get(7)].sort(), ['extra', 'normal']);
  assert.deepStrictEqual([...p.get(8)], ['normal']);
});

// ---------------------------------------------------------------------------
// Por la ruta
// ---------------------------------------------------------------------------

test('t5: POST /pedidos (mesero) -> 409 sin_stock con `disponible`, calculado DESPUÉS del ROLLBACK', () =>
  conDobles({ disponibles: [{ tipo: 'plato', id: 12, disponible: 2 }, { tipo: 'ingrediente', id: 7, disponible: 1 }] }, async (db) => {
    const res = await pedirMesero();
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.faltantes, [
      { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo', disponible: 2 },
      { tipo: 'ingrediente', id: 7, nombre: 'Panceta', disponible: 1 },
    ]);
    const iRollback = db.ejecutadas.findIndex((q) => q.sql === 'ROLLBACK');
    const consulta = db.ejecutadas.findIndex((q) => q.sql.includes('jsonb_to_recordset'));
    assert.ok(iRollback >= 0 && consulta > iRollback, 'la lectura va después del ROLLBACK');
    // Lo que se le pasa a la consulta: los faltantes y, de la opción, la porción pedida.
    assert.deepStrictEqual(JSON.parse(db.ejecutadas[consulta].params[0]), [
      { tipo: 'plato', id: 12, porciones: null },
      { tipo: 'ingrediente', id: 7, porciones: ['extra'] },
    ]);
    assert.match(db.ejecutadas[consulta].sql, /\$1::jsonb/);
  }));

test('t5: POST /pedidos (comensal) también lleva `disponible`', () =>
  conDobles({ disponibles: [{ tipo: 'plato', id: 12, disponible: 0 }] }, async () => {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(MESA)}`)
      .send({ items: [{ id_plato: 12, cantidad: 1 }] });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.faltantes[0].disponible, 0);
  }));

test('t5: si la consulta de disponible falla, el 409 sale igual SIN `disponible` (no un 500) y el log solo lleva el código', () =>
  conDobles({ fallaDisponibles: Object.assign(new Error('se cayó con Masa 250 g'), { code: '57014' }) }, async () => {
    const original = console.error;
    const lineas = [];
    console.error = (...a) => lineas.push(a.map(String).join(' '));
    let res;
    try {
      res = await pedirMesero();
    } finally {
      console.error = original;
    }
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.motivo, 'sin_stock');
    assert.deepStrictEqual(res.body.faltantes, [
      { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' },
      { tipo: 'ingrediente', id: 7, nombre: 'Panceta' },
    ]);
    const log = lineas.join('\n');
    assert.match(log, /no se pudo calcular el disponible de los faltantes \(57014\)/);
    assert.ok(!log.includes('se cayó con Masa'), 'sin el mensaje del error');
  }));
