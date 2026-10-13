const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

// GET /api/kds/comandas desde D-03: la cocina necesita ver quien pidio cada
// item y con que ingredientes y porciones se arma, y el tablero se refresca
// cada pocos segundos, asi que el numero de consultas no puede crecer con el
// numero de comandas.

const SQL_PEDIDOS = 'FROM pedidos p';
const SQL_ITEMS = 'FROM detalles_pedido dp';

function pedido(id_pedido) {
  return {
    id_pedido,
    codigo_pedido: `PED-261011-0000${id_pedido}`,
    id_mesa: id_pedido,
    estado: 'recibido',
    notas_generales: null,
    creado_en: new Date().toISOString(),
    mesa_numero: id_pedido,
    minutos_transcurridos: 3,
  };
}

const INGREDIENTES = [
  { id_ingrediente: 1, nombre: 'Arroz Integral', porcion: 'normal', id_paso: 1, paso: 'Elige tu Base' },
  { id_ingrediente: 4, nombre: 'Pollo a la Plancha', porcion: 'normal', id_paso: 2, paso: 'Elige tu Proteina' },
  { id_ingrediente: 10, nombre: 'Aguacate', porcion: 'extra', id_paso: 3, paso: 'Anade Toppings' },
];

function item(id_detalle, id_pedido, extra = {}) {
  return {
    id_detalle,
    id_pedido,
    cantidad: 2,
    notas_especiales: 'sin cebolla',
    estado_item: 'pendiente',
    comensal: 'Ana',
    plato_nombre: 'Bowl Personalizado',
    tiempo_preparacion_estimado: 12,
    personalizable: true,
    categoria_nombre: 'Fuertes',
    ingredientes: INGREDIENTES,
    ...extra,
  };
}

/** Doble de la base con N comandas, cada una con un item armado. */
function conComandas(cantidad) {
  const pedidos = Array.from({ length: cantidad }, (_, i) => pedido(i + 1));
  const items = pedidos.map((p) => item(700 + p.id_pedido, p.id_pedido));
  return (sql, params) => {
    if (sql.includes(SQL_PEDIDOS)) return { rows: pedidos };
    if (sql.includes(SQL_ITEMS)) {
      const ids = params[0];
      return { rows: items.filter((it) => ids.includes(it.id_pedido)) };
    }
    return { rows: [] };
  };
}

const jwtCocina = () => tokenStaff(9, 'cocina');

test('las comandas llegan con comensal, ingredientes y porciones', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.comandas.length, 1);

    const [itemDeLaComanda] = res.body.comandas[0].items;
    assert.strictEqual(itemDeLaComanda.comensal, 'Ana');
    assert.strictEqual(itemDeLaComanda.notas_especiales, 'sin cebolla');
    assert.deepStrictEqual(
      itemDeLaComanda.ingredientes.map((i) => [i.nombre, i.porcion]),
      [['Arroz Integral', 'normal'], ['Pollo a la Plancha', 'normal'], ['Aguacate', 'extra']]
    );
  } finally {
    db.restaurar();
  }
});

test('cada comanda recibe solo sus propios items', async () => {
  const db = instalarFakeDb(conComandas(3));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.body.comandas.length, 3);
    for (const comanda of res.body.comandas) {
      assert.strictEqual(comanda.items.length, 1);
      assert.strictEqual(comanda.items[0].id_pedido, comanda.id_pedido);
    }
  } finally {
    db.restaurar();
  }
});

test('el numero de consultas no crece con el numero de comandas', async () => {
  for (const cuantas of [1, 5, 20]) {
    const db = instalarFakeDb(conComandas(cuantas));
    try {
      await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

      assert.strictEqual(
        db.todas(SQL_PEDIDOS).length,
        1,
        `${cuantas} comandas: una sola consulta de pedidos`
      );
      assert.strictEqual(
        db.todas(SQL_ITEMS).length,
        1,
        `${cuantas} comandas: una sola consulta de items (sin N+1)`
      );
    } finally {
      db.restaurar();
    }
  }
});

test('sin comandas activas no se consultan items', async () => {
  const db = instalarFakeDb(conComandas(0));
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.comandas, []);
    assert.strictEqual(db.todas(SQL_ITEMS).length, 0);
  } finally {
    db.restaurar();
  }
});

test('a la cocina no se le manda el precio de los ingredientes', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const consulta = db.buscar(SQL_ITEMS);
    assert.ok(!consulta.sql.includes('precio_aplicado'), 'la cocina no necesita precios');
  } finally {
    db.restaurar();
  }
});

test('un item de plato simple llega con ingredientes vacios', async () => {
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes(SQL_PEDIDOS)) return { rows: [pedido(1)] };
    if (sql.includes(SQL_ITEMS)) {
      return {
        rows: [item(701, 1, {
          plato_nombre: 'Limonada de Coco',
          personalizable: false,
          comensal: null,
          notas_especiales: null,
          ingredientes: [],
        })],
      };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.comandas[0].items[0].ingredientes, []);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-09: la columna "Listas" tiene que sobrevivir a una recarga
// ---------------------------------------------------------------------------

test('el tablero pide los tres estados de cocina, incluido listo', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const consulta = db.buscar(SQL_PEDIDOS);
    assert.ok(consulta, 'se consultan los pedidos del tablero');
    assert.deepStrictEqual(
      consulta.params[0],
      ['recibido', 'en_preparacion', 'listo'],
      'listo entra porque la comanda sigue en el pase esperando al mesero'
    );
  } finally {
    db.restaurar();
  }
});

test('una comanda lista llega en la carga inicial', async () => {
  const lista = { ...pedido(42), estado: 'listo' };
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes(SQL_PEDIDOS)) return { rows: [lista] };
    if (sql.includes(SQL_ITEMS)) return { rows: [item(742, 42)] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.comandas.length, 1);
    assert.strictEqual(res.body.comandas[0].estado, 'listo');
    assert.strictEqual(
      res.body.comandas[0].items.length,
      1,
      'una comanda lista trae sus items igual que las demas'
    );
  } finally {
    db.restaurar();
  }
});

test('los estados que ya salieron del tablero no se piden', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const pedidos = db.buscar(SQL_PEDIDOS).params[0];
    for (const fuera of ['entregado', 'pagado', 'cancelado']) {
      assert.ok(!pedidos.includes(fuera), `${fuera} ya no es asunto de la cocina`);
    }
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-09: hora de paso a 'listo' y recorte de 12 horas
// ---------------------------------------------------------------------------

const kdsService = require('../src/services/kds.service');

test('la consulta trae listo_en desde historial_estados', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const consulta = db.buscar(SQL_PEDIDOS);
    assert.ok(consulta.sql.includes('h.fecha_cambio AS listo_en'), 'se expone listo_en');
    assert.ok(
      consulta.sql.includes('FROM historial_estados he'),
      'sale de historial_estados, no de pedidos.actualizado_en (que cambia con cualquier UPDATE)'
    );
    assert.ok(consulta.sql.includes("he.estado_nuevo = 'listo'"), 'la ultima transicion a listo');
  } finally {
    db.restaurar();
  }
});

test('listo_en llega al cliente tal como lo da la base', async () => {
  const listoEn = new Date('2026-10-13T02:15:25.200Z').toISOString();
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes(SQL_PEDIDOS)) {
      return { rows: [{ ...pedido(42), estado: 'listo', listo_en: listoEn }] };
    }
    if (sql.includes(SQL_ITEMS)) return { rows: [item(742, 42)] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${jwtCocina()}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(new Date(res.body.comandas[0].listo_en).toISOString(), listoEn);
  } finally {
    db.restaurar();
  }
});

test('las comandas listas se recortan a las ultimas 12 horas', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const consulta = db.buscar(SQL_PEDIDOS);
    assert.strictEqual(
      consulta.params[1],
      String(kdsService.HORAS_VISIBLES_LISTO),
      'el tope va como parametro, desde una constante nombrada'
    );
    assert.strictEqual(kdsService.HORAS_VISIBLES_LISTO, 12);
    assert.ok(
      consulta.sql.includes("($2 || ' hours')::interval"),
      'el recorte se calcula en SQL'
    );
  } finally {
    db.restaurar();
  }
});

test('el recorte aplica SOLO a listo: recibido y en_preparacion no caducan', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    const sql = db.buscar(SQL_PEDIDOS).sql;
    assert.ok(
      sql.includes("p.estado <> 'listo'"),
      'una comanda vieja en preparacion sigue siendo trabajo pendiente de cocina'
    );
    // El orden de la condicion importa: primero se deja pasar todo lo que no es
    // 'listo', y solo despues se mira la antiguedad.
    assert.ok(sql.indexOf("p.estado <> 'listo'") < sql.indexOf("hours')::interval"));
  } finally {
    db.restaurar();
  }
});

test('una comanda listo sin historial no se esconde por un dato que falta', async () => {
  const db = instalarFakeDb(conComandas(1));
  try {
    await request(app).get('/api/kds/comandas').set('Authorization', `Bearer ${jwtCocina()}`);

    assert.ok(
      db.buscar(SQL_PEDIDOS).sql.includes('h.fecha_cambio IS NULL'),
      'sin hora de listo se muestra: ocultarla en silencio seria peor'
    );
  } finally {
    db.restaurar();
  }
});
