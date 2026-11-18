const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { ESTADOS_ACTIVOS } = require('../src/services/pedidos.service');
const app = require('../server');

// GET /api/pedidos/activos — panel del restaurante (lo pidio Jarrison).
//
// Antes devolvia filas pelas de pedidos y solo en 'recibido'/'en_preparacion'.
// Ahora trae el pedido en el MISMO formato que GET /pedidos/:id (sus detalles
// con plato y ingredientes), agrega mesa_numero, y cuenta como activo tambien
// 'listo' y 'entregado': un pedido listo es el que hay que llevar y uno
// entregado el que hay que cobrar.

const RUTA = '/api/pedidos/activos';

// Fragmentos con ALIAS, para no pisar lo que capturan los dobles de otras
// pruebas (que buscan 'SELECT * FROM pedidos').
const SQL_ACTIVOS = 'FROM pedidos p';
const SQL_DETALLES = 'FROM detalles_pedido dp';

const jwt = (rol = 'admin') => `Bearer ${tokenStaff(1, rol)}`;

const PEDIDOS = [
  { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-261013-A1B2C', estado: 'listo', total: '43000.00', mesa_numero: 12 },
  { id_pedido: 88, id_mesa: 6, codigo_pedido: 'PED-261013-D3E4F', estado: 'recibido', total: '20000.00', mesa_numero: 3 },
];

const DETALLES = [
  {
    id_detalle: 700,
    id_pedido: 87,
    id_plato: 1001,
    cantidad: 2,
    precio_unitario: '20000.00',
    subtotal: '43000.00',
    comensal: 'Ana',
    notas_especiales: 'sin cebolla',
    plato_nombre: 'Bowl Personalizado',
    ingredientes: [
      { id_ingrediente: 1, nombre: 'Arroz', porcion: 'normal', precio_aplicado: '0.00', id_paso: 1, paso: 'Elige tu Base' },
    ],
  },
  {
    id_detalle: 701,
    id_pedido: 88,
    id_plato: 1002,
    cantidad: 1,
    precio_unitario: '20000.00',
    subtotal: '20000.00',
    comensal: null,
    notas_especiales: null,
    plato_nombre: 'Limonada',
    ingredientes: [],
  },
];

/** @param {{pedidos?: object[], detalles?: object[]}} opciones */
function dbActivos({ pedidos = PEDIDOS, detalles = DETALLES } = {}) {
  return (sql) => {
    if (sql.includes(SQL_ACTIVOS)) return { rows: pedidos };
    if (sql.includes(SQL_DETALLES)) return { rows: detalles };
    return { rows: [] };
  };
}

// ---------------------------------------------------------------------------
// Estados: el filtro lo hace el SQL, no JavaScript
// ---------------------------------------------------------------------------

test('los 4 estados activos van en la consulta, sin pagado ni cancelado', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    const res = await request(app).get(RUTA).set('Authorization', jwt());
    assert.strictEqual(res.status, 200);

    const consulta = db.buscar(SQL_ACTIVOS);
    assert.ok(consulta, 'la consulta de activos se ejecuta');

    // Los estados viajan como parametro, no interpolados en el SQL.
    assert.deepStrictEqual(
      consulta.params[0],
      ['recibido', 'en_preparacion', 'listo', 'entregado'],
      'los cuatro estados que el panel considera activos'
    );
    assert.deepStrictEqual(consulta.params[0], ESTADOS_ACTIVOS, 'y son los que exporta el servicio');

    for (const cerrado of ['pagado', 'cancelado']) {
      assert.ok(!consulta.params[0].includes(cerrado), `${cerrado} no es un pedido activo`);
    }
  } finally {
    db.restaurar();
  }
});

test('el filtro y el orden los hace la base, no el backend', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    await request(app).get(RUTA).set('Authorization', jwt());

    const { sql } = db.buscar(SQL_ACTIVOS);
    assert.match(sql, /WHERE p\.estado = ANY/, 'filtra en SQL');
    assert.match(sql, /ORDER BY p\.creado_en ASC/, 'y mantiene el orden de llegada');
    assert.match(sql, /JOIN mesas m ON m\.id_mesa = p\.id_mesa/, 'se une con mesas por el numero');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Forma de la respuesta
// ---------------------------------------------------------------------------

test('cada pedido trae mesa_numero y sus detalles con ingredientes', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    const res = await request(app).get(RUTA).set('Authorization', jwt());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.pedidos.length, 2);

    const [primero, segundo] = res.body.pedidos;

    // Compatible hacia atras: lo que ya devolvia sigue igual.
    assert.strictEqual(primero.id_pedido, 87);
    assert.strictEqual(primero.id_mesa, 5);
    assert.strictEqual(primero.codigo_pedido, 'PED-261013-A1B2C');
    assert.strictEqual(primero.estado, 'listo');
    assert.strictEqual(primero.total, '43000.00');

    // Lo nuevo.
    assert.strictEqual(primero.mesa_numero, 12, 'el numero que se ve en el salon');
    assert.strictEqual(segundo.mesa_numero, 3);

    assert.strictEqual(primero.detalles.length, 1, 'cada pedido con SUS detalles');
    assert.strictEqual(segundo.detalles.length, 1);

    const item = primero.detalles[0];
    assert.strictEqual(item.plato_nombre, 'Bowl Personalizado');
    assert.strictEqual(item.cantidad, 2);
    assert.strictEqual(item.precio_unitario, '20000.00');
    assert.strictEqual(item.subtotal, '43000.00');
    assert.strictEqual(item.comensal, 'Ana');
    assert.strictEqual(item.notas_especiales, 'sin cebolla');
    assert.strictEqual(item.ingredientes.length, 1);
    assert.strictEqual(item.ingredientes[0].nombre, 'Arroz');
    assert.strictEqual(item.ingredientes[0].porcion, 'normal');
    assert.strictEqual(item.ingredientes[0].paso, 'Elige tu Base');
  } finally {
    db.restaurar();
  }
});

test('un item sin ingredientes trae la lista vacia, no null', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    const res = await request(app).get(RUTA).set('Authorization', jwt());
    const item = res.body.pedidos[1].detalles[0];

    assert.deepStrictEqual(item.ingredientes, []);
    assert.strictEqual(item.comensal, null, 'un item que no pidio nadie en concreto');
  } finally {
    db.restaurar();
  }
});

test('los detalles se leen en UNA sola consulta para todos los pedidos', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    await request(app).get(RUTA).set('Authorization', jwt());

    // Dos pedidos, una consulta de detalles: no una por pedido.
    assert.strictEqual(db.todas(SQL_DETALLES).length, 1);
    assert.deepStrictEqual(db.buscar(SQL_DETALLES).params[0], [87, 88], 'los dos ids de golpe');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lista vacia
// ---------------------------------------------------------------------------

test('sin pedidos activos devuelve [] y NO consulta los detalles', async () => {
  const db = instalarFakeDb(dbActivos({ pedidos: [] }));
  try {
    const res = await request(app).get(RUTA).set('Authorization', jwt());

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.pedidos, []);
    assert.strictEqual(
      db.buscar(SQL_DETALLES),
      undefined,
      'detallesDePedidos con lista vacia seria una consulta de mas'
    );
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Roles: no cambian
// ---------------------------------------------------------------------------

for (const rol of ['admin', 'cajero', 'mesero']) {
  test(`${rol} sigue pudiendo ver los pedidos activos`, async () => {
    const db = instalarFakeDb(dbActivos());
    try {
      const res = await request(app).get(RUTA).set('Authorization', jwt(rol));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.pedidos.length, 2);
    } finally {
      db.restaurar();
    }
  });
}

test('cocina y comensal siguen fuera', async () => {
  const db = instalarFakeDb(dbActivos());
  try {
    const cocina = await request(app).get(RUTA).set('Authorization', jwt('cocina'));
    assert.strictEqual(cocina.status, 403, 'la cocina tiene su propio tablero en /kds/comandas');

    const comensal = await request(app)
      .get(RUTA)
      .set('Authorization', `Bearer ${tokenComensal(5)}`);
    assert.strictEqual(comensal.status, 403, 'el comensal ve su mesa en /pedidos/mesa');
  } finally {
    db.restaurar();
  }
});
