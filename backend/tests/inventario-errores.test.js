const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const {
  traducirErrorInventario,
  faltantesParaElCliente,
  MOTIVO_SIN_STOCK,
  MOTIVO_MOVIMIENTO_INVALIDO,
  MOTIVO_INGREDIENTE_AGOTADO,
} = require('../src/middleware/inventario-errores');
const { manejadorErrores, MENSAJE_CONCURRENCIA } = require('../src/middleware/errores.middleware');
const pedidosCtrl = require('../src/controllers/pedidos.controller');

/** Lo minimo del req que mira el manejador central (solo para el log). */
const peticionFalsa = () => ({ method: 'POST', originalUrl: '/api/inventario/movimientos' });

/** Un res que guarda lo que se le pide, para probar el manejador sin una ruta. */
function respuestaFalsa() {
  return {
    headersSent: false,
    statusCode: null,
    cuerpo: null,
    status(codigo) {
      this.statusCode = codigo;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      return this;
    },
  };
}

// D-17 parte 1: traduccion de los errores de inventario de la base (P-19).
//
// La base lanza dos SQLSTATE propios (27_inventario.sql) que, sin traducir,
// caian en el 500 generico: el cliente no distinguia "falta queso" de "se cayo
// el servidor". La convencion es { error, motivo }, nunca `codigo`.
//
// Lo que se vigila aqui:
//   - SD001 -> 409 sin_stock con faltantes de solo tipo, id y nombre, sin
//     repetir, y SIN los datos de bodega (insumo, necesita, hay);
//   - SD001 del COMMIT (la reserva es un trigger DIFERIDO) se traduce igual que
//     el del INSERT, y el pedido no queda a medias;
//   - SD002 -> 400 movimiento_invalido con stock_actual;
//   - "El ingrediente X esta agotado" (P0001) -> 409 ingrediente_agotado, y
//     ningun OTRO P0001 se confunde con el;
//   - un deadlock al crear el pedido -> 503 reintentar (no hay idempotencia).

const MESA = 5;
const PEDIDO = { id_pedido: 87, id_mesa: MESA, codigo_pedido: 'PED-261108-ABC12', estado: 'recibido' };

const mesero = () => tokenStaff(9, 'mesero');

/** El DETAIL de SD001 tal como lo arma 27_inventario.sql. */
const FALTANTE = (extra = {}) => ({
  tipo: 'plato',
  id: 12,
  nombre: 'Arepa de Huevo',
  id_insumo: 3,
  insumo: 'P19 Masa',
  necesita: 2,
  hay: 1,
  ...extra,
});

/** Un error de pg con SQLSTATE y DETAIL, como el que llega de la base. */
function errorDeLaBase(code, message, detail) {
  const err = new Error(message);
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  return err;
}

const errorSinStock = (faltantes) => errorDeLaBase(
  'SD001',
  'Sin stock suficiente para el pedido 87',
  JSON.stringify({ faltantes })
);

/**
 * @param {{fallaEn?: string, error?: Error}} opciones
 *   `fallaEn` es el fragmento de SQL con el que el doble lanza `error`.
 */
function fakePedidos({ fallaEn = null, error = null } = {}) {
  return instalarFakeDb((sql) => {
    if (fallaEn && sql.includes(fallaEn)) throw error;
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ existe: 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta: { comensales: [] } }] };
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    return { rows: [] };
  });
}

const pedir = (items = [{ id_plato: 12, cantidad: 2 }]) => request(app)
  .post('/api/pedidos')
  .set('Authorization', `Bearer ${mesero()}`)
  .send({ id_mesa: MESA, items });

// ---------------------------------------------------------------------------
// La traduccion, sin pasar por una ruta
// ---------------------------------------------------------------------------

test('d-17: SD001 se traduce a 409 sin_stock', () => {
  const traducido = traducirErrorInventario(errorSinStock([FALTANTE()]));

  assert.strictEqual(traducido.status, 409);
  assert.strictEqual(traducido.cuerpo.motivo, MOTIVO_SIN_STOCK);
  assert.strictEqual(traducido.cuerpo.error, 'Sin stock suficiente para el pedido 87');
  assert.deepStrictEqual(traducido.cuerpo.faltantes, [
    { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' },
  ]);
});

test('d-17: del faltante solo salen tipo, id y nombre', () => {
  const traducido = traducirErrorInventario(errorSinStock([FALTANTE()]));
  const fila = traducido.cuerpo.faltantes[0];

  assert.deepStrictEqual(Object.keys(fila).sort(), ['id', 'nombre', 'tipo']);
  // Las cantidades de bodega no son asunto de quien pide: el pedido lo puede
  // hacer un comensal anonimo desde su telefono.
  for (const prohibido of ['id_insumo', 'insumo', 'necesita', 'hay']) {
    assert.strictEqual(fila[prohibido], undefined, prohibido);
  }
  // Pero si van al log del servidor, que es donde hacen falta para reponer.
  assert.match(traducido.log, /P19 Masa/);
});

test('d-17: el mismo plato no se repite aunque le falten tres insumos', () => {
  // La base arma los faltantes por INSUMO: sin deduplicar, al cliente se le
  // diria tres veces que quite el mismo plato.
  const traducido = traducirErrorInventario(errorSinStock([
    FALTANTE({ id_insumo: 3, insumo: 'Masa' }),
    FALTANTE({ id_insumo: 4, insumo: 'Queso' }),
    FALTANTE({ id_insumo: 5, insumo: 'Huevo' }),
    FALTANTE({ tipo: 'ingrediente', id: 7, nombre: 'Panceta' }),
  ]));

  assert.deepStrictEqual(traducido.cuerpo.faltantes, [
    { tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' },
    { tipo: 'ingrediente', id: 7, nombre: 'Panceta' },
  ]);
});

test('d-17: un plato y una opcion con el MISMO id no se pisan', () => {
  // Se deduplica por tipo + id, no por id: son dos cosas distintas.
  const traducido = traducirErrorInventario(errorSinStock([
    FALTANTE({ tipo: 'plato', id: 9, nombre: 'Bowl' }),
    FALTANTE({ tipo: 'ingrediente', id: 9, nombre: 'Quinoa' }),
  ]));

  assert.strictEqual(traducido.cuerpo.faltantes.length, 2);
});

test('d-17: los faltantes del constructor vienen con los insumos en null', () => {
  // Cuando lo que falta son las opciones de un paso obligatorio, la base manda
  // id_insumo, insumo, necesita y hay en null. Sigue siendo un faltante valido.
  const traducido = traducirErrorInventario(errorSinStock([
    { tipo: 'plato', id: 1001, nombre: 'Bowl', id_insumo: null, insumo: null, necesita: null, hay: null },
  ]));

  assert.deepStrictEqual(traducido.cuerpo.faltantes, [
    { tipo: 'plato', id: 1001, nombre: 'Bowl' },
  ]);
});

test('d-17: un DETAIL ilegible sigue siendo 409 sin_stock con la lista vacia', () => {
  // Un detalle que no se puede leer no puede convertir un 409 que el cliente
  // sabe atender en un 500: se pierde el detalle, no la respuesta.
  for (const detail of ['esto no es json', '', undefined, '{"faltantes":"no es lista"}', 'null']) {
    const traducido = traducirErrorInventario(
      errorDeLaBase('SD001', 'Sin stock suficiente para el pedido 87', detail)
    );
    assert.strictEqual(traducido.status, 409, String(detail));
    assert.strictEqual(traducido.cuerpo.motivo, MOTIVO_SIN_STOCK, String(detail));
    assert.deepStrictEqual(traducido.cuerpo.faltantes, [], String(detail));
  }
});

test('d-17: una fila de faltantes sin tipo o con id raro se descarta', () => {
  assert.deepStrictEqual(
    faltantesParaElCliente({
      faltantes: [
        { id: 3, nombre: 'sin tipo' },
        { tipo: 'plato', id: 0, nombre: 'id cero' },
        { tipo: 'plato', id: -1, nombre: 'id negativo' },
        { tipo: 'plato', id: '12', nombre: 'id de texto' },
        null,
        'texto suelto',
        { tipo: 'plato', id: 12, nombre: 'buena' },
      ],
    }),
    [{ tipo: 'plato', id: 12, nombre: 'buena' }]
  );
});

test('d-17: un faltante sin nombre llega con nombre null, no undefined', () => {
  const [fila] = faltantesParaElCliente({ faltantes: [{ tipo: 'plato', id: 12 }] });

  assert.deepStrictEqual(fila, { tipo: 'plato', id: 12, nombre: null });
});

test('d-17: SD002 se traduce a 400 movimiento_invalido con stock_actual', () => {
  const traducido = traducirErrorInventario(errorDeLaBase(
    'SD002',
    'El movimiento dejaría "P19 Masa" en negativo: hay 450.00 g',
    JSON.stringify({ id_insumo: 3, insumo: 'P19 Masa', stock_actual: 450, cantidad: -1000 })
  ));

  assert.strictEqual(traducido.status, 400);
  assert.strictEqual(traducido.cuerpo.motivo, MOTIVO_MOVIMIENTO_INVALIDO);
  // El MESSAGE de la base ya esta en lenguaje para el usuario: se usa tal cual.
  assert.strictEqual(traducido.cuerpo.error, 'El movimiento dejaría "P19 Masa" en negativo: hay 450.00 g');
  assert.strictEqual(traducido.cuerpo.stock_actual, 450);
});

test('d-17: el stock_actual de SD002 tambien se lee si viene como texto', () => {
  const traducido = traducirErrorInventario(errorDeLaBase(
    'SD002',
    'El movimiento dejaría "Queso" en negativo: hay 450.00 g',
    JSON.stringify({ stock_actual: '450.50' })
  ));

  assert.strictEqual(traducido.cuerpo.stock_actual, 450.5);
});

test('d-17: SD002 sin un stock_actual legible no inventa el campo', () => {
  for (const detail of [undefined, 'no es json', '{"stock_actual":"hola"}', '{}']) {
    const traducido = traducirErrorInventario(errorDeLaBase('SD002', 'En negativo', detail));
    assert.strictEqual(traducido.status, 400, String(detail));
    assert.strictEqual(traducido.cuerpo.motivo, MOTIVO_MOVIMIENTO_INVALIDO, String(detail));
    assert.ok(!('stock_actual' in traducido.cuerpo), String(detail));
  }
});

test('d-17: el ingrediente agotado del interruptor manual es ingrediente_agotado', () => {
  const traducido = traducirErrorInventario(
    errorDeLaBase('P0001', 'El ingrediente "Panceta Crujiente" está agotado')
  );

  assert.strictEqual(traducido.status, 409);
  assert.strictEqual(traducido.cuerpo.motivo, MOTIVO_INGREDIENTE_AGOTADO);
  assert.strictEqual(traducido.cuerpo.error, 'El ingrediente "Panceta Crujiente" está agotado');
});

test('d-17: ningun OTRO P0001 se confunde con el ingrediente agotado', () => {
  // La misma funcion de la base lanza otros cinco P0001: un `includes` los
  // marcaria todos como ingrediente_agotado y el cliente actuaria sobre el
  // ingrediente cuando el problema es otro.
  const otros = [
    'El ingrediente "Panceta" no pertenece al plato "Bowl"',
    'El plato "Bowl" no es personalizable',
    'No se pueden cambiar los ingredientes: el pedido ya está en estado "cocinando"',
    'El ingrediente 7 no existe',
    'El ingrediente "Panceta" no tiene stock suficiente',
    'El ingrediente "Panceta" está agotado hoy',
    'Aviso: El ingrediente "Panceta" está agotado',
  ];
  for (const mensaje of otros) {
    assert.strictEqual(traducirErrorInventario(errorDeLaBase('P0001', mensaje)), null, mensaje);
  }
});

test('d-17: el mismo texto con otro SQLSTATE no se traduce', () => {
  // Solo P0001: un 23514 con ese texto seria otra cosa.
  assert.strictEqual(
    traducirErrorInventario(errorDeLaBase('23514', 'El ingrediente "Panceta" está agotado')),
    null
  );
});

test('d-17: lo que no es de inventario no se traduce aqui', () => {
  for (const err of [null, undefined, new Error('vacio'), errorDeLaBase('23505', 'duplicado'),
    errorDeLaBase('40P01', 'deadlock'), errorDeLaBase('22003', 'desborde')]) {
    assert.strictEqual(traducirErrorInventario(err), null, String(err && err.code));
  }
});

// ---------------------------------------------------------------------------
// Por la ruta real: POST /api/pedidos
// ---------------------------------------------------------------------------

test('d-17: SD001 en el INSERT del detalle sale como 409 sin_stock', async () => {
  const db = fakePedidos({
    fallaEn: 'INSERT INTO detalles_pedido',
    error: errorSinStock([FALTANTE()]),
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, MOTIVO_SIN_STOCK);
    assert.deepStrictEqual(res.body.faltantes, [{ tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' }]);
    assert.strictEqual(res.body.codigo, undefined, 'la convencion es motivo, no codigo');
    assert.ok(db.buscar('ROLLBACK'), 'la transaccion se deshizo');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: SD001 en el COMMIT se traduce IGUAL que en el INSERT', async () => {
  // La reserva es un trigger DIFERIDO (tr_reservar_inventario): el pedido
  // completo se valida al confirmar, asi que este es el camino normal cuando el
  // plato todavia figuraba con stock al insertar.
  const db = fakePedidos({ fallaEn: 'COMMIT', error: errorSinStock([FALTANTE()]) });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, MOTIVO_SIN_STOCK);
    assert.deepStrictEqual(res.body.faltantes, [{ tipo: 'plato', id: 12, nombre: 'Arepa de Huevo' }]);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: con el SD001 del COMMIT el pedido se revierte entero', async () => {
  const db = fakePedidos({ fallaEn: 'COMMIT', error: errorSinStock([FALTANTE()]) });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir([
      { id_plato: 12, cantidad: 2 },
      { id_plato: 13, cantidad: 1 },
    ]);

    assert.strictEqual(res.status, 409);
    assert.ok(db.buscar('ROLLBACK'), 'se deshizo la transaccion');
    // No se avisa de un pedido que no existe.
    assert.deepStrictEqual(socket.todos('/internal/order-created'), []);
    assert.strictEqual(res.body.id_pedido, undefined, 'no se devuelve un pedido a medias');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: un fallo del ROLLBACK no tapa el SD001 del COMMIT', async () => {
  // Si el ROLLBACK lanzara y nadie lo atrapara, el cliente recibiria un 500 en
  // vez de su lista de faltantes.
  const db = instalarFakeDb((sql) => {
    if (sql === 'COMMIT') throw errorSinStock([FALTANTE()]);
    if (sql === 'ROLLBACK') throw new Error('no hay transaccion en curso');
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ existe: 1 }] };
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    return { rows: [] };
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, MOTIVO_SIN_STOCK);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: el ingrediente agotado al pedir sale como 409 ingrediente_agotado', async () => {
  const db = fakePedidos({
    fallaEn: 'INSERT INTO detalles_ingredientes',
    error: errorDeLaBase('P0001', 'El ingrediente "Panceta Crujiente" está agotado'),
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir([
      { id_plato: 1001, cantidad: 1, ingredientes: [{ id_ingrediente: 7, porcion: 'normal' }] },
    ]);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, MOTIVO_INGREDIENTE_AGOTADO);
    assert.strictEqual(res.body.error, 'El ingrediente "Panceta Crujiente" está agotado');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: otro P0001 del mismo trigger sigue siendo el 409 de siempre, sin motivo', async () => {
  const db = fakePedidos({
    fallaEn: 'INSERT INTO detalles_ingredientes',
    error: errorDeLaBase('P0001', 'El ingrediente "Panceta" no pertenece al plato "Bowl"'),
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir([
      { id_plato: 1001, cantidad: 1, ingredientes: [{ id_ingrediente: 7, porcion: 'normal' }] },
    ]);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'El ingrediente "Panceta" no pertenece al plato "Bowl"');
    assert.strictEqual(res.body.motivo, undefined, 'no es ingrediente_agotado');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: SD002 por la ruta de pedidos tambien sale como 400', async () => {
  // En el PR 1 no hay ruta de movimientos todavia, pero la traduccion es del
  // manejador central: la usara igual el PR 2 desde sus propias rutas.
  const db = fakePedidos({
    fallaEn: 'COMMIT',
    error: errorDeLaBase(
      'SD002',
      'El movimiento dejaría "Masa" en negativo: hay 2.00 porcion',
      JSON.stringify({ stock_actual: 2 })
    ),
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, MOTIVO_MOVIMIENTO_INVALIDO);
    assert.strictEqual(res.body.stock_actual, 2);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Deadlock al crear el pedido (40P01)
// ---------------------------------------------------------------------------

test('d-17: un deadlock al crear el pedido es 503 reintentar', async () => {
  // No se reintenta por nuestra cuenta: POST /api/pedidos no acepta clave de
  // idempotencia y un reintento podria dejar la comanda duplicada.
  const db = fakePedidos({ fallaEn: 'COMMIT', error: errorDeLaBase('40P01', 'deadlock detected') });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_REINTENTAR);
    assert.strictEqual(res.body.error, pedidosCtrl.MENSAJE_REINTENTAR);
    // UNA sola vez: no hay un segundo intento escondido.
    assert.strictEqual(db.todas('INSERT INTO pedidos').length, 1);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: un deadlock en el INSERT tambien es 503 reintentar', async () => {
  const db = fakePedidos({
    fallaEn: 'INSERT INTO detalles_pedido',
    error: errorDeLaBase('40P01', 'deadlock detected'),
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await pedir();

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_REINTENTAR);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('d-17: el 409 de concurrencia del manejador central no cambia', () => {
  // Solo la creacion de pedidos da 503: cualquier otra ruta que termine en el
  // manejador central sigue recibiendo su 409 generico, sin motivo.
  const respuesta = respuestaFalsa();

  manejadorErrores(errorDeLaBase('40P01', 'deadlock detected'), peticionFalsa(), respuesta, () => {
    throw new Error('no deberia delegar');
  });

  assert.strictEqual(respuesta.statusCode, 409);
  assert.strictEqual(respuesta.cuerpo.error, MENSAJE_CONCURRENCIA);
  assert.strictEqual(respuesta.cuerpo.motivo, undefined);
});
