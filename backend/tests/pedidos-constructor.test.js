const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenComensal, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');
const { ROL_COMENSAL } = require('../src/middleware/auth.middleware');

// D-03: platos armados con el constructor. Lo que se prueba aqui es el reparto
// de responsabilidades, NO los precios: el precio lo fija la base (platos.precio
// y el trigger tr_validar_detalle_ingrediente sobre ingredientes.precio_extra) y
// las reglas min_sel/max_sel las decide validar_selecciones_detalle. El backend
// solo tiene que insertar lo que le piden, en la transaccion correcta, y no
// aceptar precios del cliente.

const PEDIDO = { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-261011-ABC12', estado: 'recibido' };

const BOWL = 1001;

function responderCreacionOk(sql) {
  if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
  if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '43000.00' }] };
  return { rows: [] };
}

/** Error como el que llega de PostgreSQL cuando un trigger hace RAISE EXCEPTION. */
function errorDeTrigger(mensaje) {
  const err = new Error(mensaje);
  err.code = 'P0001';
  return err;
}

const INGREDIENTES_BOWL = [
  { id_ingrediente: 1, porcion: 'normal' },
  { id_ingrediente: 4, porcion: 'normal' },
  { id_ingrediente: 10, porcion: 'extra' },
];

// ---------------------------------------------------------------------------
// Insercion de ingredientes
// ---------------------------------------------------------------------------

test('un plato simple sin ingredientes se crea igual que antes', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 2, comensal: 'Ana' }] });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.todas('INSERT INTO detalles_ingredientes').length, 0);
    // La validacion de pasos se llama igual: para un plato no personalizable la
    // funcion vuelve de inmediato, asi que el backend no tiene que distinguir.
    assert.ok(db.buscar('validar_selecciones_detalle'));
  } finally {
    db.restaurar();
  }
});

test('un plato armado inserta sus ingredientes sin precio_aplicado y valida los pasos', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 2, comensal: 'Ana', ingredientes: INGREDIENTES_BOWL }] });

    assert.strictEqual(res.status, 201);

    const inserts = db.todas('INSERT INTO detalles_ingredientes');
    assert.strictEqual(inserts.length, 3, 'un INSERT por ingrediente elegido');

    const idDetalle = inserts[0].params[0];
    assert.deepStrictEqual(
      inserts.map((q) => q.params),
      [[idDetalle, 1, 'normal'], [idDetalle, 4, 'normal'], [idDetalle, 10, 'extra']]
    );
    for (const insert of inserts) {
      assert.ok(
        !insert.sql.includes('precio_aplicado'),
        'el precio_aplicado lo fija el trigger, no el backend'
      );
      assert.strictEqual(insert.params.length, 3, 'solo id_detalle, id_ingrediente y porcion');
    }
  } finally {
    db.restaurar();
  }
});

test('los ingredientes y la validacion van dentro de la transaccion del pedido', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: INGREDIENTES_BOWL }] });

    const orden = db.ejecutadas.map((q) => q.sql);
    const indice = (fragmento) => orden.findIndex((s) => s.includes(fragmento));

    const begin = indice('BEGIN');
    const commit = indice('COMMIT');
    assert.ok(begin >= 0 && commit > begin, 'hay una transaccion');
    assert.ok(indice('INSERT INTO detalles_ingredientes') > begin);
    assert.ok(indice('INSERT INTO detalles_ingredientes') < commit);
    assert.ok(
      indice('validar_selecciones_detalle') > indice('INSERT INTO detalles_ingredientes'),
      'los pasos se validan DESPUES de insertar todos los ingredientes del item'
    );
    assert.ok(indice('validar_selecciones_detalle') < commit, 'y antes del COMMIT');
  } finally {
    db.restaurar();
  }
});

test('cada item valida sus propios pasos con su id_detalle', async () => {
  const db = instalarFakeDb(responderCreacionOk, { primerIdDetalle: 700 });
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [
          { id_plato: BOWL, cantidad: 1, ingredientes: [{ id_ingrediente: 1 }] },
          { id_plato: BOWL, cantidad: 1, ingredientes: [{ id_ingrediente: 3 }] },
        ],
      });

    const validaciones = db.todas('validar_selecciones_detalle');
    assert.deepStrictEqual(validaciones.map((q) => q.params), [[700], [701]]);
  } finally {
    db.restaurar();
  }
});

test('la porcion por defecto es normal', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: [{ id_ingrediente: 1 }] }] });

    assert.strictEqual(db.buscar('INSERT INTO detalles_ingredientes').params[2], 'normal');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Validacion del body (400)
// ---------------------------------------------------------------------------

test('una porcion invalida se rechaza con 400 y no llega a la base', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [{ id_plato: BOWL, cantidad: 1, ingredientes: [{ id_ingrediente: 1, porcion: 'doble' }] }],
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined, 'no se abre el pedido');
  } finally {
    db.restaurar();
  }
});

test('repetir un ingrediente en el mismo item da 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [{
          id_plato: BOWL,
          cantidad: 1,
          ingredientes: [{ id_ingrediente: 10, porcion: 'extra' }, { id_ingrediente: 10, porcion: 'ligera' }],
        }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /No repitas el mismo ingrediente/);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

test('el mismo ingrediente en items distintos si se permite', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [
          { id_plato: BOWL, cantidad: 1, comensal: 'Ana', ingredientes: [{ id_ingrediente: 10 }] },
          { id_plato: BOWL, cantidad: 1, comensal: 'Pipe', ingredientes: [{ id_ingrediente: 10 }] },
        ],
      });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.todas('INSERT INTO detalles_ingredientes').length, 2);
  } finally {
    db.restaurar();
  }
});

test('mas de 20 ingredientes en un item da 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const muchos = Array.from({ length: 21 }, (_, i) => ({ id_ingrediente: i + 1 }));
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: muchos }] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El cliente no pone precios
// ---------------------------------------------------------------------------

for (const campo of ['precio', 'precio_unitario', 'subtotal', 'total']) {
  test(`un ${campo} en el item se rechaza con 400`, async () => {
    const db = instalarFakeDb(responderCreacionOk);
    try {
      const res = await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${tokenComensal(5)}`)
        .send({ items: [{ id_plato: BOWL, cantidad: 1, [campo]: 1 }] });

      assert.strictEqual(res.status, 400);
      assert.match(res.body.error, /El precio lo fija la base de datos/);
      assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('un precio_aplicado en el ingrediente se rechaza con 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [{
          id_plato: BOWL,
          cantidad: 1,
          ingredientes: [{ id_ingrediente: 10, porcion: 'extra', precio_aplicado: 0 }],
        }],
      });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /El precio lo fija la base de datos/);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

test('el INSERT del detalle nunca lleva un precio del body', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: INGREDIENTES_BOWL }] });

    const detalle = db.buscar('INSERT INTO detalles_pedido');
    assert.ok(detalle.sql.includes('(SELECT precio FROM platos WHERE id_plato = $2)'));
    assert.ok(!detalle.sql.includes('precio_extras'), 'precio_extras lo calcula el trigger');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// De quien es el item: alias del JWT vs alias del body
// ---------------------------------------------------------------------------

/** JWT de comensal con el alias firmado dentro (PR #13 de Roberto). */
function tokenComensalConAlias(id_mesa, comensal) {
  const { sid } = jwt.decode(tokenComensal(id_mesa));
  return jwt.sign({ id_mesa, sid, comensal, rol: ROL_COMENSAL }, process.env.JWT_SECRET, {
    expiresIn: '3h',
  });
}

test('el alias firmado en el JWT gana sobre el del body', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensalConAlias(5, 'Ana')}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'Pipe' }] });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      db.buscar('INSERT INTO detalles_pedido').params[4],
      'Ana',
      'no se puede cargar un item a otra persona escribiendo su nombre en el body'
    );
  } finally {
    db.restaurar();
  }
});

test('un comensal sin alias firmado no toma el del body (h-05)', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'Pipe' }] });

    assert.strictEqual(
      db.buscar('INSERT INTO detalles_pedido').params[4],
      null,
      'el alias decide a quien se le cobra: sin uno firmado, queda sin alias'
    );
  } finally {
    db.restaurar();
  }
});

test('para el mesero el alias sale del body', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ id_mesa: 5, items: [{ id_plato: 12, cantidad: 1, comensal: 'Mesa 5' }] });

    assert.strictEqual(db.buscar('INSERT INTO detalles_pedido').params[4], 'Mesa 5');
  } finally {
    db.restaurar();
  }
});

test('OVERRIDE_ADMIN en comensal da 400 y no llega a la base', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'OVERRIDE_ADMIN' }] });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /OVERRIDE_ADMIN/);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Errores de la base: 409 con su mensaje y nada a medio guardar
// ---------------------------------------------------------------------------

const ERRORES_DE_LA_BASE = [
  { caso: 'ingrediente agotado', mensaje: 'El ingrediente "Panceta Crujiente" esta agotado' },
  {
    caso: 'ingrediente de otro plato',
    mensaje: 'El ingrediente "Tocineta" no pertenece al plato "Bowl Personalizado"',
  },
];

for (const { caso, mensaje } of ERRORES_DE_LA_BASE) {
  test(`${caso}: 409 con el mensaje de la base y ROLLBACK sin pedido`, async () => {
    const db = instalarFakeDb((sql) => {
      if (sql.includes('INSERT INTO detalles_ingredientes')) throw errorDeTrigger(mensaje);
      return responderCreacionOk(sql);
    });
    try {
      const res = await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${tokenComensal(5)}`)
        .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: INGREDIENTES_BOWL }] });

      assert.strictEqual(res.status, 409, 'un RAISE EXCEPTION del trigger no es un 500');
      assert.strictEqual(res.body.error, mensaje, 'el mensaje de la base llega tal cual');
      assert.ok(db.buscar('ROLLBACK'), 'la transaccion se revierte');
      assert.strictEqual(db.buscar('COMMIT'), undefined, 'no queda pedido guardado');
    } finally {
      db.restaurar();
    }
  });
}

test('min_sel incumplido: 409 con el mensaje del paso y ROLLBACK', async () => {
  const mensaje = 'En "Elige tu Base" debes elegir al menos 1 opcion(es) (elegiste 0)';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('validar_selecciones_detalle')) throw errorDeTrigger(mensaje);
    return responderCreacionOk(sql);
  });
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1, ingredientes: [{ id_ingrediente: 10 }] }] });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(db.buscar('COMMIT'), undefined);
  } finally {
    db.restaurar();
  }
});

test('max_sel incumplido: 409 con el mensaje del paso', async () => {
  const mensaje = 'En "Anade Toppings" puedes elegir maximo 3 opcion(es) (elegiste 4)';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('validar_selecciones_detalle')) throw errorDeTrigger(mensaje);
    return responderCreacionOk(sql);
  });
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({
        items: [{
          id_plato: BOWL,
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 8 },
            { id_ingrediente: 9 },
            { id_ingrediente: 10 },
            { id_ingrediente: 11 },
          ],
        }],
      });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un plato personalizable sin ingredientes falla si el paso es obligatorio', async () => {
  const mensaje = 'En "Elige tu Base" debes elegir al menos 1 opcion(es) (elegiste 0)';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('validar_selecciones_detalle')) throw errorDeTrigger(mensaje);
    return responderCreacionOk(sql);
  });
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 1 }] });

    assert.strictEqual(res.status, 409, 'lo detecta la base, no el backend');
    assert.strictEqual(db.todas('INSERT INTO detalles_ingredientes').length, 0);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lectura: order:created y GET /pedidos/:id
// ---------------------------------------------------------------------------

const DETALLE_ARMADO = {
  id_detalle: 700,
  id_pedido: 87,
  id_plato: BOWL,
  cantidad: 2,
  comensal: 'Ana',
  notas_especiales: 'sin cebolla',
  precio_unitario: '20000.00',
  precio_extras: '1500.00',
  plato_nombre: 'Bowl Personalizado',
  personalizable: true,
  ingredientes: [
    { id_ingrediente: 1, nombre: 'Arroz Integral', porcion: 'normal', precio_aplicado: '0.00', id_paso: 1, paso: 'Elige tu Base' },
    { id_ingrediente: 4, nombre: 'Pollo a la Plancha', porcion: 'normal', precio_aplicado: '0.00', id_paso: 2, paso: 'Elige tu Proteina' },
    { id_ingrediente: 10, nombre: 'Aguacate', porcion: 'extra', precio_aplicado: '1500.00', id_paso: 3, paso: 'Anade Toppings' },
  ],
};

function responderConDetalleArmado(sql) {
  if (sql.includes('FROM detalles_pedido dp')) return { rows: [DETALLE_ARMADO] };
  return responderCreacionOk(sql);
}

test('el payload de order:created lleva comensal e ingredientes', async () => {
  const db = instalarFakeDb(responderConDetalleArmado);
  const socket = instalarFakeSocket();
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: BOWL, cantidad: 2, comensal: 'Ana', ingredientes: INGREDIENTES_BOWL }] });

    const item = socket.buscar('/internal/order-created').cuerpo.pedido.items[0];
    assert.strictEqual(item.comensal, 'Ana');
    assert.strictEqual(item.notas_especiales, 'sin cebolla', 'la nota va sola, sin el alias');
    assert.deepStrictEqual(item.ingredientes, [
      { id_ingrediente: 1, nombre: 'Arroz Integral', porcion: 'normal', precio_aplicado: '0.00' },
      { id_ingrediente: 4, nombre: 'Pollo a la Plancha', porcion: 'normal', precio_aplicado: '0.00' },
      { id_ingrediente: 10, nombre: 'Aguacate', porcion: 'extra', precio_aplicado: '1500.00' },
    ]);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('GET /api/pedidos/:id devuelve los ingredientes del item', async () => {
  const db = instalarFakeDb(responderConDetalleArmado);
  try {
    const res = await request(app)
      .get('/api/pedidos/87')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 200);
    const detalle = res.body.detalles[0];
    assert.strictEqual(detalle.comensal, 'Ana');
    assert.strictEqual(detalle.precio_extras, '1500.00', 'los extras los calculo la base');
    assert.strictEqual(detalle.ingredientes.length, 3);
    assert.deepStrictEqual(
      detalle.ingredientes.map((i) => i.paso),
      ['Elige tu Base', 'Elige tu Proteina', 'Anade Toppings'],
      'ordenados por el orden del paso'
    );
  } finally {
    db.restaurar();
  }
});

test('GET /api/pedidos/:id lee los detalles en una sola consulta', async () => {
  const db = instalarFakeDb(responderConDetalleArmado);
  try {
    await request(app).get('/api/pedidos/87').set('Authorization', `Bearer ${tokenComensal(5)}`);
    assert.strictEqual(db.todas('FROM detalles_pedido dp').length, 1);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// H-05: el alias de un comensal sale SOLO de su JWT
// ---------------------------------------------------------------------------

test('h-05: un comensal con alias firmado "Ana" que manda "Beto" guarda Ana', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensalConAlias(5, 'Ana')}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'Beto' }] });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      db.buscar('INSERT INTO detalles_pedido').params[4],
      'Ana',
      'nadie puede cargarle un plato a otra persona de la mesa escribiendo su nombre'
    );
  } finally {
    db.restaurar();
  }
});

test('h-05: tampoco sirve el apodo del body para suplantar', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensalConAlias(5, 'Ana')}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, apodo: 'Beto' }] });

    assert.strictEqual(db.buscar('INSERT INTO detalles_pedido').params[4], 'Ana');
  } finally {
    db.restaurar();
  }
});

test('h-05: un comensal sin alias en el token que manda "Beto" guarda null', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'Beto', apodo: 'Beto' }] });

    assert.strictEqual(res.status, 201, 'el pedido se crea igual, solo sin alias');
    assert.strictEqual(
      db.buscar('INSERT INTO detalles_pedido').params[4],
      null,
      'el body no es autoridad sobre quien pidio'
    );
  } finally {
    db.restaurar();
  }
});

test('h-05: el alias del body SI vale para un mesero', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ id_mesa: 5, items: [{ id_plato: 12, cantidad: 1, comensal: 'Mesa 5' }] });

    assert.strictEqual(
      db.buscar('INSERT INTO detalles_pedido').params[4],
      'Mesa 5',
      'el mesero pide de parte de alguien y su JWT no lleva alias'
    );
  } finally {
    db.restaurar();
  }
});

test('h-05: y tambien para un admin', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ id_mesa: 5, items: [{ id_plato: 12, cantidad: 1, comensal: 'Ana' }] });

    assert.strictEqual(db.buscar('INSERT INTO detalles_pedido').params[4], 'Ana');
  } finally {
    db.restaurar();
  }
});

test('h-05: varios items de un comensal reciben todos su alias firmado', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensalConAlias(5, 'Ana')}`)
      .send({
        items: [
          { id_plato: 12, cantidad: 1, comensal: 'Beto' },
          { id_plato: 13, cantidad: 2, comensal: 'Cami' },
        ],
      });

    const inserts = db.todas('INSERT INTO detalles_pedido');
    assert.strictEqual(inserts.length, 2);
    assert.deepStrictEqual(
      inserts.map((q) => q.params[4]),
      ['Ana', 'Ana'],
      'un comensal solo puede pedir para si mismo'
    );
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// H-06: topes del pedido
// ---------------------------------------------------------------------------

const unItem = (extra = {}) => ({ id_plato: 12, cantidad: 1, ...extra });

test('h-06: 51 items se rechazan con 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: Array.from({ length: 51 }, () => unItem()) });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined, 'no se abre la transaccion');
  } finally {
    db.restaurar();
  }
});

test('h-06: 50 items pasan', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: Array.from({ length: 50 }, () => unItem()) });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.todas('INSERT INTO detalles_pedido').length, 50);
  } finally {
    db.restaurar();
  }
});

test('h-06: cantidad 21 se rechaza con 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [unItem({ cantidad: 21 })] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

test('h-06: cantidad 20 pasa', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [unItem({ cantidad: 20 })] });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO detalles_pedido').params[2], 20);
  } finally {
    db.restaurar();
  }
});

test('h-06: cantidad 100000000 da 400 y NUNCA 500', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [unItem({ cantidad: 100000000 })] });

    assert.strictEqual(
      res.status,
      400,
      'antes llegaba a la base, desbordaba el subtotal y salia como 500'
    );
    assert.notStrictEqual(res.status, 500);
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined);
  } finally {
    db.restaurar();
  }
});

test('h-06: 50 items con cantidad 20 cada uno pasa (el tope exacto)', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: Array.from({ length: 50 }, () => unItem({ cantidad: 20 })) });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.todas('INSERT INTO detalles_pedido').length, 50);
  } finally {
    db.restaurar();
  }
});

for (const cantidad of [0, -1, 1.5]) {
  test(`h-06: cantidad ${cantidad} sigue dando 400`, async () => {
    const db = instalarFakeDb(responderCreacionOk);
    try {
      const res = await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${tokenComensal(5)}`)
        .send({ items: [unItem({ cantidad })] });

      assert.strictEqual(res.status, 400);
    } finally {
      db.restaurar();
    }
  });
}

test('h-06: el tope de ingredientes por item sigue en 20', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const muchos = Array.from({ length: 21 }, (_, i) => ({ id_ingrediente: i + 1 }));
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [unItem({ id_plato: BOWL, ingredientes: muchos })] });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

test('h-06: una lista de items vacia sigue dando 400', async () => {
  const db = instalarFakeDb(responderCreacionOk);
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [] });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});
