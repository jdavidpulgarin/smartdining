const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const inventarioService = require('../src/services/inventario.service');

// D-17 PR 3: GET /api/inventario/carta, para la pestaña de Recetas del panel.
//
// Sale de la vista v_carta_disponible (script 27), que es quien decide qué es
// "disponible": el backend no recalcula nada. Lo que se vigila aqui:
//   - dos listas, { platos, ingredientes }, y la que no se pide viaja VACIA;
//   - a la vista se le añaden con JOIN los datos de agrupar y explicar que ella
//     no trae: categoria y personalizable del plato, y plato / paso /
//     paso_orden de cada opcion del constructor;
//   - orden fijo: platos por categoria y nombre; opciones por plato, paso_orden
//     y nombre (el nombre del paso se repite entre platos);
//   - los filtros son estrictos: un valor que no esta en la lista es 400;
//   - sin_receta filtra SOLO por tiene_receta, sin mirar personalizable;
//   - la consulta va parametrizada, sin identificadores dinamicos.

const admin = () => tokenStaff(1, 'admin');

/** Filas como las devuelve la consulta de platos (vista + JOIN). */
const FILAS_PLATOS = [
  {
    id: 12,
    nombre: 'Arepa de Huevo',
    categoria: 'Entradas',
    personalizable: false,
    disponible: true,
    stock_suficiente: false,
    disponible_efectivo: false,
    motivo: 'stock',
    tiene_receta: true,
  },
  {
    id: 1001,
    nombre: 'Bowl Personalizado',
    categoria: 'Bowls',
    personalizable: true,
    disponible: true,
    stock_suficiente: true,
    disponible_efectivo: true,
    motivo: null,
    tiene_receta: false,
  },
];

const FILAS_INGREDIENTES = [
  {
    id: 7,
    nombre: 'Panceta Crujiente',
    id_plato: 1001,
    plato: 'Bowl Personalizado',
    id_paso: 4,
    paso: 'Proteína',
    paso_orden: 2,
    disponible: false,
    stock_suficiente: true,
    disponible_efectivo: false,
    motivo: 'manual',
    tiene_receta: true,
  },
];

/** @param {{platos?: Array, ingredientes?: Array}} opciones */
function fakeCarta({ platos = FILAS_PLATOS, ingredientes = FILAS_INGREDIENTES } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes("v.tipo = 'plato'")) return { rows: platos };
    if (sql.includes("v.tipo = 'ingrediente'")) return { rows: ingredientes };
    return { rows: [] };
  });
}

const get = (url) => request(app).get(url).set('Authorization', `Bearer ${admin()}`);

const consultaDePlatos = (db) => db.buscar("v.tipo = 'plato'");
const consultaDeIngredientes = (db) => db.buscar("v.tipo = 'ingrediente'");

// ---------------------------------------------------------------------------
// La forma de la respuesta
// ---------------------------------------------------------------------------

test('d-17c: la carta llega en dos listas, platos e ingredientes', async () => {
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['ingredientes', 'platos']);
    assert.strictEqual(res.body.platos.length, 2);
    assert.strictEqual(res.body.ingredientes.length, 1);
  } finally {
    db.restaurar();
  }
});

test('d-17c: un plato trae su categoria, si es personalizable y su disponibilidad', async () => {
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta');

    assert.deepStrictEqual(res.body.platos[0], {
      id: 12,
      nombre: 'Arepa de Huevo',
      categoria: 'Entradas',
      personalizable: false,
      disponible: true,
      stock_suficiente: false,
      disponible_efectivo: false,
      motivo: 'stock',
      tiene_receta: true,
    });
  } finally {
    db.restaurar();
  }
});

test('d-17c: personalizable explica un tiene_receta en false que no es un olvido', async () => {
  // Un Bowl consume por sus OPCIONES, cada una con su receta: el plato no tiene
  // receta propia y esta bien asi. Sin el campo, el panel lo pintaria como
  // "falta configurar".
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta');
    const bowl = res.body.platos.find((p) => p.id === 1001);

    assert.strictEqual(bowl.personalizable, true);
    assert.strictEqual(bowl.tiene_receta, false);
  } finally {
    db.restaurar();
  }
});

test('d-17c: una opcion trae su plato, su paso y el ORDEN del paso', async () => {
  // paso_orden hace falta porque el nombre del paso se repite entre platos
  // ("Elige tu Salsa"): sin el no se pueden ordenar como los ve el comensal.
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta');

    assert.deepStrictEqual(res.body.ingredientes[0], {
      id: 7,
      nombre: 'Panceta Crujiente',
      id_plato: 1001,
      plato: 'Bowl Personalizado',
      id_paso: 4,
      paso: 'Proteína',
      paso_orden: 2,
      disponible: false,
      stock_suficiente: true,
      disponible_efectivo: false,
      motivo: 'manual',
      tiene_receta: true,
    });
  } finally {
    db.restaurar();
  }
});

test('d-17c: los ids y paso_orden son numeros aunque la base los de como texto', async () => {
  const db = fakeCarta({
    platos: [{ ...FILAS_PLATOS[0], id: '12' }],
    ingredientes: [{ ...FILAS_INGREDIENTES[0], id: '7', id_plato: '1001', id_paso: '4', paso_orden: '2' }],
  });
  try {
    const res = await get('/api/inventario/carta');

    assert.strictEqual(res.body.platos[0].id, 12);
    const opcion = res.body.ingredientes[0];
    for (const campo of ['id', 'id_plato', 'id_paso', 'paso_orden']) {
      assert.strictEqual(typeof opcion[campo], 'number', campo);
    }
    assert.strictEqual(opcion.paso_orden, 2);
  } finally {
    db.restaurar();
  }
});

test('d-17c: un plato sin categoria llega con categoria null, no undefined', async () => {
  const db = fakeCarta({ platos: [{ ...FILAS_PLATOS[0], categoria: null }] });
  try {
    const res = await get('/api/inventario/carta');

    assert.strictEqual(res.body.platos[0].categoria, null);
    assert.ok('categoria' in res.body.platos[0]);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El orden, que es parte del contrato
// ---------------------------------------------------------------------------

test('d-17c: los platos se piden por categoria y luego nombre', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta');

    const sql = consultaDePlatos(db).sql;
    assert.ok(sql.includes('ORDER BY c.nombre ASC NULLS FIRST, v.nombre ASC'), sql);
  } finally {
    db.restaurar();
  }
});

test('d-17c: las opciones se piden por plato, orden del paso y nombre', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta');

    const sql = consultaDeIngredientes(db).sql;
    assert.ok(sql.includes('ORDER BY pl.nombre ASC, pc.orden ASC, v.nombre ASC'), sql);
    // Por `orden` del paso y no por su nombre: "Elige tu Salsa" se repite entre
    // platos y el orden del constructor no es alfabetico.
    assert.ok(!sql.includes('ORDER BY pl.nombre ASC, pc.nombre'));
  } finally {
    db.restaurar();
  }
});

test('d-17c: el backend NO reordena lo que ya ordeno la base', async () => {
  // Las filas salen tal como vienen: si el backend volviera a ordenar, habria
  // dos criterios y acabarian discrepando.
  const db = fakeCarta({
    platos: [
      { ...FILAS_PLATOS[1], nombre: 'Zuppa' },
      { ...FILAS_PLATOS[0], nombre: 'Arepa' },
    ],
  });
  try {
    const res = await get('/api/inventario/carta');

    assert.deepStrictEqual(res.body.platos.map((p) => p.nombre), ['Zuppa', 'Arepa']);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

test('d-17c: tipo=plato devuelve la otra lista VACIA, no la omite', async () => {
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta?tipo=plato');

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.platos.length > 0);
    assert.deepStrictEqual(res.body.ingredientes, []);
    // Y no se gasta la consulta de la lista que no se pidio.
    assert.ok(!consultaDeIngredientes(db));
  } finally {
    db.restaurar();
  }
});

test('d-17c: tipo=ingrediente, al reves', async () => {
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta?tipo=ingrediente');

    assert.deepStrictEqual(res.body.platos, []);
    assert.ok(res.body.ingredientes.length > 0);
    assert.ok(!consultaDePlatos(db));
  } finally {
    db.restaurar();
  }
});

test('d-17c: sin_receta=true busca tiene_receta en false', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta?sin_receta=true');

    // El filtro viaja como parametro, no pegado al SQL.
    assert.strictEqual(consultaDePlatos(db).params[0], false);
    assert.strictEqual(consultaDeIngredientes(db).params[0], false);
  } finally {
    db.restaurar();
  }
});

test('d-17c: sin_receta=false busca lo que SI tiene receta', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta?sin_receta=false');

    assert.strictEqual(consultaDePlatos(db).params[0], true);
  } finally {
    db.restaurar();
  }
});

test('d-17c: sin el filtro no se filtra por receta', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta');

    assert.strictEqual(consultaDePlatos(db).params[0], null);
  } finally {
    db.restaurar();
  }
});

test('d-17c: sin_receta NO mira personalizable', async () => {
  // Un Bowl personalizable sin receta propia SI sale en la lista de "falta
  // configurar": el filtro no esconde nada por su cuenta, lo decide el panel
  // con el campo personalizable.
  const db = fakeCarta({ platos: [FILAS_PLATOS[1]] });
  try {
    const res = await get('/api/inventario/carta?sin_receta=true');

    assert.deepStrictEqual(res.body.platos.map((p) => p.id), [1001]);
    assert.strictEqual(res.body.platos[0].personalizable, true);
    const sql = consultaDePlatos(db).sql;
    assert.ok(!sql.includes('personalizable ='), 'el filtro no toca personalizable');
  } finally {
    db.restaurar();
  }
});

test('d-17c: q busca por nombre y va parametrizado', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta?q=arepa');

    const consulta = consultaDePlatos(db);
    assert.strictEqual(consulta.params[1], 'arepa');
    // ILIKE con el valor como parametro: el texto del cliente NUNCA se pega al
    // SQL (lo vigila la suite de inyeccion).
    assert.ok(consulta.sql.includes('ILIKE'));
    assert.ok(!consulta.sql.includes('arepa'));
  } finally {
    db.restaurar();
  }
});

test('d-17c: los dos filtros se combinan', async () => {
  const db = fakeCarta();
  try {
    const res = await get('/api/inventario/carta?sin_receta=true&tipo=plato&q=bowl');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(consultaDePlatos(db).params, [false, 'bowl']);
    assert.deepStrictEqual(res.body.ingredientes, []);
  } finally {
    db.restaurar();
  }
});

test('d-17c: un filtro con un valor que no existe es 400, no se ignora', async () => {
  // Un ?tipo=platos que devolviera todo haria creer al panel que no queda nada
  // pendiente de configurar.
  const db = fakeCarta();
  try {
    for (const url of [
      '/api/inventario/carta?tipo=platos',
      '/api/inventario/carta?tipo=',
      '/api/inventario/carta?sin_receta=1',
      '/api/inventario/carta?sin_receta=si',
      '/api/inventario/carta?orden=nombre',
      '/api/inventario/carta?limite=10',
      `/api/inventario/carta?q=${'a'.repeat(81)}`,
    ]) {
      const res = await get(url);
      assert.strictEqual(res.status, 400, url);
      assert.match(res.body.error, /Filtro inválido/);
    }
    assert.ok(!consultaDePlatos(db), 'nada llego a la base');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// De donde salen los datos
// ---------------------------------------------------------------------------

test('d-17c: la disponibilidad sale de la VISTA, el backend no la recalcula', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta');

    const sql = consultaDePlatos(db).sql;
    assert.ok(sql.includes('FROM v_carta_disponible v'), 'lee la vista');
    assert.ok(sql.includes('v.disponible_efectivo') && sql.includes('v.motivo'));
    // Y no se recalcula aqui con un AND propio.
    assert.ok(!sql.includes('v.disponible AND v.stock_suficiente'));
  } finally {
    db.restaurar();
  }
});

test('d-17c: lo que la vista no trae se agrega con JOIN', async () => {
  const db = fakeCarta();
  try {
    await get('/api/inventario/carta');

    const platos = consultaDePlatos(db).sql;
    assert.ok(platos.includes('LEFT JOIN categorias c'), 'la categoria es un LEFT JOIN');
    assert.ok(platos.includes('p.personalizable'));

    const ingredientes = consultaDeIngredientes(db).sql;
    assert.ok(ingredientes.includes('JOIN pasos_constructor pc'));
    assert.ok(ingredientes.includes('JOIN platos pl'));
    assert.ok(ingredientes.includes('pc.orden AS paso_orden'));
  } finally {
    db.restaurar();
  }
});

test('d-17c: una carta vacia son dos listas vacias, no un 404', async () => {
  const db = fakeCarta({ platos: [], ingredientes: [] });
  try {
    const res = await get('/api/inventario/carta');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { platos: [], ingredientes: [] });
  } finally {
    db.restaurar();
  }
});

test('d-17c: el servicio devuelve las dos listas sin pasar por la ruta', async () => {
  const db = fakeCarta();
  try {
    const carta = await inventarioService.obtenerCarta({});

    assert.strictEqual(carta.platos.length, 2);
    assert.strictEqual(carta.ingredientes.length, 1);
  } finally {
    db.restaurar();
  }
});
