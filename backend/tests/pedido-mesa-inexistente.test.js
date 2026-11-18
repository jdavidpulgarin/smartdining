const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const pedidosCtrl = require('../src/controllers/pedidos.controller');

// D-18c: POST /api/pedidos con un id_mesa que NO existe.
//
// Antes, un pedido con alias a una mesa inexistente respondia 409
// comensal_no_registrado: `cuentaPorComensal` devuelve null cuando la mesa no
// esta, y el resolutor de alias lo leia como "esa persona no esta sentada". El
// mesero veia un error sobre el NOMBRE del comensal cuando lo que estaba mal
// era el numero de la mesa.
//
// Lo que se vigila aqui:
//   - mesa inexistente + alias = 404 "Mesa no encontrada", el mismo formato que
//     el resto del backend;
//   - el 404 sale ANTES de resolver alias (no se lee la cuenta ni Redis);
//   - un pedido SIN alias no paga la consulta de mas y falla como antes (la FK);
//   - con la mesa existente no cambia nada.

const MESA = 5;
const FANTASMA = 999;
const PEDIDO = { id_pedido: 87, id_mesa: MESA, codigo_pedido: 'PED-260925-ABC12', estado: 'recibido' };

const mesero = () => tokenStaff(9, 'mesero');

/** SQLSTATE 23503: la FK de la mesa, que es como fallaba antes sin alias. */
function errorFk() {
  const err = new Error('insert or update on table "pedidos" violates foreign key constraint');
  err.code = '23503';
  return err;
}

/**
 * @param {{existe?: boolean, cuenta?: object|null}} opciones
 *   `existe`: lo que contesta SELECT 1 FROM mesas (false = mesa inexistente).
 */
function fakeDb({ existe = true, cuenta = { id_mesa: MESA, comensales: [] } } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: existe ? [{ '1': 1 }] : [] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta }] };
    if (sql.includes('INSERT INTO pedidos')) {
      if (!existe) throw errorFk();
      return { rows: [{ ...PEDIDO, total: '0.00' }] };
    }
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: '20000.00' }] };
    return undefined;
  });
}

const pedir = (items, id_mesa) => request(app)
  .post('/api/pedidos')
  .set('Authorization', `Bearer ${mesero()}`)
  .send({ id_mesa, items });

const CON_ALIAS = [{ id_plato: 12, cantidad: 1, comensal: 'Abuela' }];
const SIN_ALIAS = [{ id_plato: 12, cantidad: 1 }];

// ---------------------------------------------------------------------------
// Mesa inexistente + alias: 404
// ---------------------------------------------------------------------------

test('d-18c: mesa inexistente con alias es 404 y no 409 del comensal', async () => {
  const db = fakeDb({ existe: false });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(CON_ALIAS, FANTASMA);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Mesa no encontrada');
    assert.strictEqual(res.body.motivo, undefined, 'no es el 409 del comensal');
    assert.notStrictEqual(res.body.motivo, pedidosCtrl.MOTIVO_NO_REGISTRADO);
    assert.ok(!db.buscar('INSERT INTO pedidos'), 'no se intento crear el pedido');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: el 404 sale ANTES de resolver alias: ni cuenta ni Redis', async () => {
  const db = fakeDb({ existe: false });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(CON_ALIAS, FANTASMA);

    assert.strictEqual(res.status, 404);
    assert.ok(!db.buscar('obtener_cuenta_mesa_json'), 'no se leyo la cuenta de una mesa que no existe');
    assert.deepStrictEqual(redis.todas('hGet'), [], 'ni se pregunto por las reservas');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: tambien es 404 cuando el alias esta mal escrito', async () => {
  // El id de la mesa se comprueba primero: no tiene sentido discutir el nombre
  // del comensal de una mesa que no existe.
  const db = fakeDb({ existe: false });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir([{ id_plato: 12, cantidad: 1, comensal: 'A' }], FANTASMA);

    assert.strictEqual(res.status, 404);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Sin alias: igual que antes
// ---------------------------------------------------------------------------

test('d-18c: mesa inexistente SIN alias sigue fallando por la FK, como antes', async () => {
  const db = fakeDb({ existe: false });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(SIN_ALIAS, FANTASMA);

    // La FK 23503 la traduce el manejador central: no se toca ese camino.
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'La operación choca con otro registro relacionado');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: un pedido sin alias no paga la consulta de existencia', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(SIN_ALIAS, MESA);

    assert.strictEqual(res.status, 201);
    assert.ok(!db.buscar('SELECT 1 FROM mesas'), 'sin alias no hay nada que resolver');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Mesa existente: nada cambia
// ---------------------------------------------------------------------------

test('d-18c: con la mesa existente el pedido con alias se crea igual', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await alias.reservar(MESA, alias.normalizarAlias('Abuela'), { vigencia: '3h' });

    const res = await pedir(CON_ALIAS, MESA);

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO detalles_pedido');
    assert.strictEqual(insert.params[4], 'Abuela');
    // Una sola consulta de existencia: la de este chequeo. La cuenta no se lee
    // porque el alias estaba reservado.
    assert.strictEqual(db.todas('SELECT 1 FROM mesas').length, 1);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18c: y un alias que nadie registro sigue dando su 409', async () => {
  const db = fakeDb();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await pedir(CON_ALIAS, MESA);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, pedidosCtrl.MOTIVO_NO_REGISTRADO);
    assert.strictEqual(res.body.alias, 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});
