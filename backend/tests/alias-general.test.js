const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const { CAJON_SIN_COMENSAL } = require('../src/services/alias-en-cuenta');
const pedidosCtrl = require('../src/controllers/pedidos.controller');

// D-18c: nadie puede llamarse "General".
//
// "General" es el nombre que obtener_cuenta_mesa le pone al cajon de los items
// sin dueno (COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')). Desde D-18
// se puede registrar a un comensal con cualquier nombre, asi que una persona
// llamada "General" compartiria fila con los platos sin dueno: su cuenta
// mostraria consumos que no pidio, y lo que no es de nadie quedaria cobrado a
// una persona.
//
// Lo que se vigila aqui:
//   - se rechaza por CLAVE, no por texto: "General", " general ", "GENERAL" y
//     "Geneeal" con tilde entran igual;
//   - un nombre que solo CONTIENE la palabra ("General Perez") sigue siendo
//     valido: la clave tiene que ser exactamente la reservada;
//   - el alta responde el MISMO 400 que con cualquier otro alias invalido, sin
//     un formato nuevo;
//   - en POST /api/pedidos un item a nombre de "General" sigue dando el 409
//     comensal_no_registrado que ya daba, no un 400.

const MESA = 5;
const PEDIDO = { id_pedido: 87, id_mesa: MESA, codigo_pedido: 'PED-260925-ABC12', estado: 'recibido' };

const mesero = () => tokenStaff(9, 'mesero');

const mesaOcupada = (id = MESA) => ({
  id_mesa: id, numero: id, capacidad: 4, ubicacion: 'Terraza', estado: 'ocupada', token_qr: 'tok',
});

function fakeMesa({ cuenta = { id_mesa: MESA, comensales: [] } } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) return { rows: [mesaOcupada()] };
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ '1': 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta }] };
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: '0.00' }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    return undefined;
  });
}

const agregar = (cuerpo, id = MESA) => request(app)
  .post(`/api/mesas/${id}/comensales`)
  .set('Authorization', `Bearer ${mesero()}`)
  .send(cuerpo);

const quitar = (aliasUrl, id = MESA) => request(app)
  .delete(`/api/mesas/${id}/comensales/${encodeURIComponent(aliasUrl)}`)
  .set('Authorization', `Bearer ${mesero()}`);

const pedir = (items, id_mesa = MESA) => request(app)
  .post('/api/pedidos')
  .set('Authorization', `Bearer ${mesero()}`)
  .send({ id_mesa, items });

/** Las variantes que tienen que dar todas la MISMA clave reservada. */
const VARIANTES = ['General', 'general', ' general ', 'GENERAL', 'Géneral', 'Ge neral', 'G.e.n.e.r.a.l'];

// ---------------------------------------------------------------------------
// normalizarAlias
// ---------------------------------------------------------------------------

test('d-18c: normalizarAlias rechaza todas las variantes de "general"', () => {
  for (const variante of VARIANTES) {
    const normalizado = alias.normalizarAlias(variante);
    assert.ok(normalizado.error, variante);
    assert.strictEqual(normalizado.clave, alias.CLAVE_RESERVADA, variante);
  }
});

test('d-18c: el rechazo viene marcado como reservada, no como mal escrito', () => {
  // La marca es lo que deja a POST /api/pedidos seguir contestando su 409: ahi
  // "General" no es un nombre invalido, es un nombre de nadie.
  const normalizado = alias.normalizarAlias('General');

  assert.strictEqual(normalizado.reservada, true);
  assert.strictEqual(normalizado.error, alias.MENSAJE_RESERVADA);
  // Un alias invalido de verdad NO lleva la marca.
  assert.strictEqual(alias.normalizarAlias('A').reservada, undefined);
  assert.strictEqual(alias.normalizarAlias('<script>').reservada, undefined);
});

test('d-18c: la clave reservada es la del cajon de la cuenta', () => {
  // Si alguien cambia el nombre del cajon en la funcion SQL (y en
  // alias-en-cuenta), esto falla y avisa de que hay que mover la reservada.
  const normalizado = alias.normalizarAlias(CAJON_SIN_COMENSAL);

  assert.strictEqual(normalizado.reservada, true, `${CAJON_SIN_COMENSAL} tiene que estar prohibido`);
});

test('d-18c: un nombre que solo CONTIENE la palabra sigue valido', () => {
  for (const bueno of ['General Pérez', 'Generalísimo', 'Generala', 'La General', 'Generalito']) {
    const normalizado = alias.normalizarAlias(bueno);
    assert.ok(normalizado.alias, bueno);
    assert.ok(!normalizado.error, bueno);
    assert.notStrictEqual(normalizado.clave, alias.CLAVE_RESERVADA, bueno);
  }
});

test('d-18c: el resto de los alias validos no cambia', () => {
  assert.deepStrictEqual(alias.normalizarAlias('Ana'), { alias: 'Ana', clave: 'ana' });
  assert.deepStrictEqual(alias.normalizarAlias('  La   Abuela '), { alias: 'La Abuela', clave: 'laabuela' });
  assert.deepStrictEqual(alias.normalizarAlias('Géneral Pérez'), {
    alias: 'Géneral Pérez',
    clave: 'generalperez',
  });
});

// ---------------------------------------------------------------------------
// POST /api/mesas/:id/comensales
// ---------------------------------------------------------------------------

test('d-18c: el alta rechaza "general" en todas sus variantes', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    for (const variante of VARIANTES) {
      const res = await agregar({ alias: variante });

      assert.strictEqual(res.status, 400, variante);
      assert.strictEqual(res.body.campo, 'alias', variante);
    }
    // Nada reservado: el nombre no se ocupa ni "a medias".
    assert.deepStrictEqual(redis.todas('hSetNX'), [], 'no se reservo ninguna variante');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: es el MISMO 400 que con cualquier otro alias invalido', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // No hay un formato nuevo para este caso: quien llama ya sabe leer este.
    const corto = await agregar({ alias: 'A' });
    const reservado = await agregar({ alias: 'General' });

    assert.strictEqual(reservado.status, corto.status);
    assert.deepStrictEqual(Object.keys(reservado.body).sort(), Object.keys(corto.body).sort());
    assert.strictEqual(reservado.body.error, alias.MENSAJE_RESERVADA);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: "General Pérez" si se puede dar de alta', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await agregar({ alias: 'General Pérez' });

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, { id_mesa: MESA, alias: 'General Pérez' });
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: y un alias normal sigue dandose de alta igual', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await agregar({ alias: 'Abuela' });

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, { id_mesa: MESA, alias: 'Abuela' });
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/mesas/:id/comensales/:alias
// ---------------------------------------------------------------------------

test('d-18c: quitar a "General" es 400, no un intento de soltar el cajon', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await quitar('General');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.campo, 'alias');
    assert.deepStrictEqual(redis.todas('hDel'), [], 'no se solto nada');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/pedidos: sigue siendo el 409 de D-18b
// ---------------------------------------------------------------------------

test('d-18c: un item a nombre de "General" sigue dando 409 comensal_no_registrado', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir([{ id_plato: 12, cantidad: 1, comensal: 'General' }]);

    assert.strictEqual(res.status, 409, 'no es un 400: el nombre es valido de forma, no es de nadie');
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_NO_REGISTRADO);
    assert.strictEqual(res.body.error, pedidosCtrl.MENSAJE_NO_REGISTRADO);
    assert.strictEqual(res.body.alias, 'General');
    assert.ok(!db.buscar('INSERT INTO pedidos'), 'el pedido no se creo');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: tambien 409 con Redis caido, donde otros alias se dejan pasar', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Sin Redis, un alias cualquiera se guarda tal como llego (D-18b): no se
    // puede verificar quien esta sentado y el pedido no se bloquea. El cajon es
    // la excepcion, porque no hace falta preguntarle a nadie para saber que no
    // es una persona.
    const res = await pedir([{ id_plato: 12, cantidad: 1, comensal: 'general' }]);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_NO_REGISTRADO);
    assert.ok(!db.buscar('INSERT INTO pedidos'));
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: el 409 del cajon no depende de que la mesa tenga cuenta', async () => {
  // Antes el 409 salia porque "General" no aparecia en la cuenta; ahora se
  // decide en la validacion, asi que no hace falta ni leerla.
  const db = fakeMesa({ cuenta: { id_mesa: MESA, comensales: [{ comensal: 'General', items_pedidos: 3 }] } });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir([{ id_plato: 12, cantidad: 1, comensal: 'General' }]);

    assert.strictEqual(res.status, 409);
    assert.ok(!db.buscar('INSERT INTO pedidos'));
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: un pedido a nombre de "General Pérez" registrado si entra', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await alias.reservar(MESA, alias.normalizarAlias('General Pérez'), { vigencia: '3h' });

    const res = await pedir([{ id_plato: 12, cantidad: 1, comensal: 'general pérez' }]);

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO detalles_pedido');
    assert.strictEqual(insert.params[4], 'General Pérez', 'se guarda el canonico');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});
