const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const pedidosCtrl = require('../src/controllers/pedidos.controller');

// D-18b: el alias que guarda POST /api/pedidos cuando pide el PERSONAL.
//
// El problema: la cuenta por persona agrupa por el TEXTO EXACTO del alias
// (btrim(dp.comensal) en obtener_cuenta_mesa), mientras que la unicidad de los
// alias se mide por CLAVE (sin tildes, minusculas, sin separadores). Si la
// abuela se registra como "Abuela" y el mesero escribe "abuela", la cuenta
// muestra DOS filas y el cajero no sabe a quien cobrarle que.
//
// Lo que se vigila aqui:
//   - se guarda el alias CANONICO de la mesa, no el texto que llego;
//   - una persona que nadie registro da 409 y NO se crea el pedido;
//   - sin Redis el pedido NO se bloquea (se degrada al comportamiento de antes);
//   - el comensal con sesion de QR no cambia: su alias sale del JWT;
//   - un pedido con varios items del mismo alias resuelve UNA sola vez.

const MESA = 5;
const PEDIDO = { id_pedido: 87, id_mesa: MESA, codigo_pedido: 'PED-260925-ABC12', estado: 'recibido' };

const mesero = () => tokenStaff(3, 'mesero');
const admin = () => tokenStaff(1, 'admin');

/**
 * @param {{cuenta?: object|null}} opciones
 *   `cuenta`: lo que devuelve obtener_cuenta_mesa_json (null = mesa inexistente
 *   para esa consulta, que es como responde el doble si no se le dice nada).
 */
function fakeDb({ cuenta = { id_mesa: MESA, comensales: [] } } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: cuenta ? [{ existe: 1 }] : [] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta }] };
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    return undefined;
  });
}

/** Una fila de la cuenta, como la devuelve obtener_cuenta_mesa_json. */
const enLaCuenta = (comensal, items = 1) => ({
  comensal,
  items_pedidos: items,
  subtotal: '20000',
  pagado: '0',
  saldo: '20000',
});

const pedir = (token, items, id_mesa = MESA) => request(app)
  .post('/api/pedidos')
  .set('Authorization', `Bearer ${token}`)
  .send({ id_mesa, items });

/** El alias que quedo guardado en detalles_pedido.comensal ($5 del INSERT). */
const aliasGuardado = (db) => {
  const insert = db.buscar('INSERT INTO detalles_pedido');
  return insert ? insert.params[4] : undefined;
};

/** Reserva un alias en la mesa, como el alta de un sin celular. */
function reservarSinCelular(idMesa, texto) {
  const normalizado = alias.normalizarAlias(texto);
  return alias.reservar(idMesa, normalizado, {
    vigencia: alias.VIGENCIA_SIN_CELULAR,
    extra: { [alias.MARCA_SIN_CELULAR]: true },
  });
}

/** Cada prueba sin fake-redis usa una mesa distinta: la memoria dura el proceso. */
let siguienteMesa = 700;
const mesaNueva = () => (siguienteMesa += 1);

// ---------------------------------------------------------------------------
// Coincide con un alias RESERVADO: se guarda el canonico
// ---------------------------------------------------------------------------

test('d-18b: se guarda el alias canonico aunque llegue con otra capitalizacion', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');

    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'abuela' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela', 'manda el canonico, no lo que escribio el mesero');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el caso " abuela " queda guardado como "Abuela"', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');

    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: '  abuela  ' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: tambien coincide por clave con tildes y espacios dobles', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Registrada como "La Abuela"; el mesero escribe "la   abuéla".
    await reservarSinCelular(MESA, 'La Abuela');

    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'la   abuéla' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'La Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el alias de una sesion de QR tambien es canonico', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Ana entro con su celular: su reserva no lleva la marca, pero el texto
    // canonico sirve igual. Al mesero le da lo mismo de donde salio.
    await alias.reservar(MESA, alias.normalizarAlias('Ana María'), { vigencia: '3h' });

    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'ana maria' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Ana María');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el admin tambien canonicaliza', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');
    const res = await pedir(admin(), [{ id_plato: 12, cantidad: 1, comensal: 'ABUELA' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: apodo (compatibilidad) se canonicaliza igual', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Pipe');
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, apodo: 'PIPE' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Pipe');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reserva vencida, pero con platos en la cuenta
// ---------------------------------------------------------------------------

test('d-18b: sin reserva pero con platos en la cuenta, usa el texto de la cuenta', async () => {
  // La reserva de la abuela vencio (24 h) y sigue sentada con sus platos: el
  // nombre con el que aparece en la cuenta es el que hay que seguir usando.
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [enLaCuenta('Abuela', 2)] } });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'abuela' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: la reserva manda sobre la cuenta', async () => {
  // Si estan las dos, la reserva es la fuente de verdad de quien esta sentado.
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [enLaCuenta('ABUELA', 2)] } });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'abuela' }]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
    assert.ok(!db.buscar('obtener_cuenta_mesa_json'), 'ni se consulto la cuenta');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: una fila de la cuenta SIN platos no sirve para canonicalizar', async () => {
  // Puede existir solo por un pago (FULL OUTER JOIN de obtener_cuenta_mesa) y
  // no dice como se escribe el nombre de quien esta pidiendo ahora.
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [enLaCuenta('Abuela', 0)] } });
  const redis = instalarFakeRedis();
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'abuela' }]);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_NO_REGISTRADO);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// No registrado: 409 y NO se crea el pedido
// ---------------------------------------------------------------------------

test('d-18b: un comensal que nadie registro es 409 y no crea el pedido', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'Nadie' }]);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_no_registrado');
    assert.strictEqual(res.body.error, pedidosCtrl.MENSAJE_NO_REGISTRADO);
    assert.match(res.body.error, /no está registrada|no esta registrada/i);

    // Lo importante: NO se abrio la transaccion ni se escribio nada.
    assert.ok(!db.buscar('INSERT INTO pedidos'), 'no se creo el pedido');
    assert.ok(!db.buscar('INSERT INTO detalles_pedido'));
    assert.ok(!db.buscar('BEGIN'), 'ni se abrio la transaccion');
    assert.deepStrictEqual(socket.avisos, [], 'ni se aviso al socket');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: basta que UNO de los comensales no este registrado', async () => {
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [enLaCuenta('Ana')] } });
  const redis = instalarFakeRedis();
  try {
    const res = await pedir(mesero(), [
      { id_plato: 12, cantidad: 1, comensal: 'Ana' },
      { id_plato: 13, cantidad: 1, comensal: 'Nadie' },
    ]);

    assert.strictEqual(res.status, 409);
    assert.ok(!db.buscar('INSERT INTO pedidos'), 'el pedido entero se rechaza');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el 409 trae el formato de error del backend', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'Nadie' }]);

    assert.deepStrictEqual(Object.keys(res.body).sort(), ['error', 'motivo']);
    assert.strictEqual(typeof res.body.error, 'string');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Alias invalido: 400, con el mensaje de las otras rutas de alias
// ---------------------------------------------------------------------------

test('d-18b: un alias invalido para el personal es 400, no 409', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  try {
    // "A" pasa el esquema del pedido (min 1) pero no la regla de alias (min 2).
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'A' }]);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.campo, 'comensal');
    // El mismo mensaje que POST /mesas/:id/comensales y que la sesion de QR.
    assert.strictEqual(res.body.error, alias.normalizarAlias('A').error);
    assert.ok(!db.buscar('INSERT INTO pedidos'));
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: un alias de solo separadores tambien es 400', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: '..__' }]);
    assert.strictEqual(res.status, 400);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Sin Redis el pedido NO se bloquea
// ---------------------------------------------------------------------------

test('d-18b: con Redis caido el pedido pasa, con el alias recortado', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: '  Abuela  ' }]);

    // Una cache caida no puede impedir que una mesa coma: se degrada al
    // comportamiento de antes de D-18b.
    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela', 'el texto normalizado, sin canonicalizar');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: con Redis caido se intenta IGUAL con la cuenta', async () => {
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [enLaCuenta('Abuela', 3)] } });
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'abuela' }]);

    // La cuenta vive en PostgreSQL, que sigue arriba: se canonicaliza con ella.
    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: con Redis caido NUNCA sale el 409', async () => {
  const db = fakeDb({ cuenta: { id_mesa: MESA, comensales: [] } });
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'Nadie' }]);
    assert.strictEqual(res.status, 201, 'sin Redis no se puede afirmar que no este registrada');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el aviso de Redis caido no lleva el alias', async () => {
  // Estos logs acaban en archivos y en consolas ajenas: el nombre de quien esta
  // sentado en una mesa no tiene por que salir ahi.
  const db = fakeDb();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const errorOriginal = console.error;
  const lineas = [];
  console.error = (...args) => lineas.push(args.join(' '));
  try {
    await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'Abuela' }]);

    const aviso = lineas.find((l) => l.includes('[pedidos]'));
    assert.ok(aviso, `no se registro el aviso: ${JSON.stringify(lineas)}`);
    assert.ok(!aviso.includes('Abuela'), `el aviso no debe llevar el alias: ${aviso}`);
    assert.ok(aviso.includes(String(MESA)), 'pero si la mesa, para poder investigar');
  } finally {
    console.error = errorOriginal;
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lo que NO cambia
// ---------------------------------------------------------------------------

test('d-18b: un item sin comensal sigue cayendo en General', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1 }]);

    assert.strictEqual(res.status, 201);
    // El backend guarda null y la base lo agrupa como 'General'.
    assert.strictEqual(aliasGuardado(db), null);
    // Sin alias no hay nada que resolver: ni se consulta la reserva.
    assert.deepStrictEqual(redis.todas('hGet'), []);
    assert.ok(!db.buscar('obtener_cuenta_mesa_json'));
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: un comensal vacio o en blanco se trata como sin alias', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // El esquema del pedido ya recorta: '   ' no pasa su min(1).
    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: '   ' }]);
    assert.strictEqual(res.status, 400, 'lo corta el esquema del pedido, como antes');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: el comensal con sesion de QR no cambia: su alias sale del JWT', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(MESA)}`)
      // Intenta pedir a nombre de otra persona: se ignora (H-05).
      .send({ items: [{ id_plato: 12, cantidad: 1, comensal: 'Abuela' }] });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), null, 'el token de prueba no lleva alias firmado');
    // Y no se resuelve nada: para un comensal no hay nada que canonicalizar.
    assert.deepStrictEqual(redis.todas('hGet'), []);
    assert.ok(!db.buscar('obtener_cuenta_mesa_json'));
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Una sola resolucion por alias distinto
// ---------------------------------------------------------------------------

test('d-18b: varios items del mismo alias resuelven UNA sola vez', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');

    const res = await pedir(mesero(), [
      { id_plato: 12, cantidad: 1, comensal: 'Abuela' },
      { id_plato: 13, cantidad: 2, comensal: 'abuela' },
      { id_plato: 14, cantidad: 1, comensal: '  ABUELA ' },
    ]);

    assert.strictEqual(res.status, 201);
    // Una lectura, no tres: la resolucion va por clave distinta, no por item.
    const lecturas = redis.todas('hGet').filter((o) => o.clave === alias.llave(MESA));
    assert.strictEqual(lecturas.length, 1, `se leyo ${lecturas.length} veces`);

    // Y los tres items quedan con el mismo texto canonico.
    const insertados = db.todas('INSERT INTO detalles_pedido').map((q) => q.params[4]);
    assert.deepStrictEqual(insertados, ['Abuela', 'Abuela', 'Abuela']);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: dos alias distintos resuelven uno cada uno', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');
    await reservarSinCelular(MESA, 'Abuelo');

    const res = await pedir(mesero(), [
      { id_plato: 12, cantidad: 1, comensal: 'abuela' },
      { id_plato: 13, cantidad: 1, comensal: 'abuelo' },
    ]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(redis.todas('hGet').length, 2);
    assert.deepStrictEqual(
      db.todas('INSERT INTO detalles_pedido').map((q) => q.params[4]),
      ['Abuela', 'Abuelo']
    );
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: la cuenta se consulta UNA vez para todo el pedido', async () => {
  const db = fakeDb({
    cuenta: { id_mesa: MESA, comensales: [enLaCuenta('Ana'), enLaCuenta('Beto')] },
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(mesero(), [
      { id_plato: 12, cantidad: 1, comensal: 'ana' },
      { id_plato: 13, cantidad: 1, comensal: 'beto' },
    ]);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.todas('obtener_cuenta_mesa_json').length, 1, 'una sola consulta');
    assert.deepStrictEqual(
      db.todas('INSERT INTO detalles_pedido').map((q) => q.params[4]),
      ['Ana', 'Beto']
    );
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18b: la resolucion ocurre ANTES de abrir la transaccion', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(MESA, 'Abuela');
    await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'Abuela' }]);

    const sqls = db.ejecutadas.map((q) => q.sql);
    const begin = sqls.findIndex((s) => s.includes('BEGIN'));
    const cuenta = sqls.findIndex((s) => s.includes('obtener_cuenta_mesa_json'));
    assert.ok(begin >= 0, 'hubo transaccion');
    // La reserva aparecio, asi que no hizo falta la cuenta; y si hubiera hecho
    // falta, seria antes del BEGIN.
    assert.ok(cuenta === -1 || cuenta < begin, 'la cuenta NO se consulta dentro de la transaccion');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// aliasReservado(): la pieza que lee el texto canonico
// ---------------------------------------------------------------------------

test('d-18b: aliasReservado devuelve el texto con el que se registro', async () => {
  const redis = instalarFakeRedis();
  try {
    await reservarSinCelular(MESA, 'La Abuela');

    assert.deepStrictEqual(await alias.aliasReservado(MESA, 'laabuela'), { alias: 'La Abuela' });
    assert.deepStrictEqual(await alias.aliasReservado(MESA, 'nadie'), { noExiste: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18b: aliasReservado no distingue el tipo de reserva', async () => {
  // A diferencia de esSinCelular: aqui solo interesa COMO se escribe.
  const redis = instalarFakeRedis();
  try {
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });

    assert.deepStrictEqual(await alias.aliasReservado(MESA, 'ana'), { alias: 'Ana' });
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'ana'), { sinCelular: false });
  } finally {
    redis.restaurar();
  }
});

test('d-18b: aliasReservado con Redis caido no adivina', async () => {
  const redis = instalarFakeRedis({ caido: true });
  try {
    assert.deepStrictEqual(await alias.aliasReservado(MESA, 'ana'), { noDisponible: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18b: aliasReservado con un valor ilegible dice que no existe', async () => {
  const redis = instalarFakeRedis();
  try {
    redis.poner(alias.llave(MESA), { ana: 'esto-no-es-json' });
    assert.deepStrictEqual(await alias.aliasReservado(MESA, 'ana'), { noExiste: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18b: aliasReservado funciona con el respaldo en memoria', async () => {
  const mesa = mesaNueva();
  assert.deepStrictEqual(await alias.aliasReservado(mesa, 'abuela'), { noExiste: true });

  await reservarSinCelular(mesa, 'Abuela');
  assert.deepStrictEqual(await alias.aliasReservado(mesa, 'abuela'), { alias: 'Abuela' });
});

test('d-18b: en memoria, una reserva vencida no canonicaliza', async () => {
  const mesa = mesaNueva();
  const reloj = { t: 1_000_000 };
  await alias.reservar(mesa, alias.normalizarAlias('Abuela'), {
    vigencia: '1s',
    ahora: () => reloj.t,
  });
  assert.deepStrictEqual(await alias.aliasReservado(mesa, 'abuela', { ahora: () => reloj.t }), {
    alias: 'Abuela',
  });

  reloj.t += 2000;
  assert.deepStrictEqual(await alias.aliasReservado(mesa, 'abuela', { ahora: () => reloj.t }), {
    noExiste: true,
  });
});

test('d-18b: con el respaldo en memoria el pedido tambien canonicaliza', async () => {
  const mesa = mesaNueva();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ existe: 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta: { comensales: [] } }] };
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, id_mesa: mesa, total: '0.00' }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, id_mesa: mesa, total: '20000.00' }] };
    return undefined;
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await reservarSinCelular(mesa, 'Abuela');

    const res = await pedir(mesero(), [{ id_plato: 12, cantidad: 1, comensal: 'ABUELA' }], mesa);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(aliasGuardado(db), 'Abuela');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});
