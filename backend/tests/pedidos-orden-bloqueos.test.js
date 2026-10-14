const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');

// H-01 (continuacion): todos los caminos que bloquean la mesa y el pedido deben
// hacerlo en el MISMO orden, mesa primero. Dos ordenes opuestos sobre las mismas
// filas se interbloquean (40P01), y estaba medido en 19 de 20 intentos entre un
// cobro y un cambio de estado del mismo pedido.

const ID_PEDIDO = 87;
const ID_MESA = 5;

const SQL_BLOQUEO_MESA = 'FROM mesas m';
const SQL_UPDATE_PEDIDO = 'UPDATE pedidos SET estado = $1';

function responderPedido(estado = 'entregado') {
  return (sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado }] };
    if (sql.includes(SQL_UPDATE_PEDIDO)) {
      return { rows: [{ id_pedido: ID_PEDIDO, id_mesa: ID_MESA, estado: params[0] }] };
    }
    return { rows: [] };
  };
}

const patch = (estado, estadoActual) => {
  const db = instalarFakeDb(responderPedido(estadoActual));
  return {
    db,
    peticion: request(app)
      .patch(`/api/pedidos/${ID_PEDIDO}/estado`)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ estado }),
  };
};

/** Índice de la primera consulta que contiene el fragmento. */
const indiceDe = (db, fragmento) =>
  db.ejecutadas.findIndex((q) => q.sql.includes(fragmento));

test('al cerrar un pedido se bloquea la mesa ANTES del UPDATE del pedido', async () => {
  const socket = instalarFakeSocket();
  const { db, peticion } = patch('pagado', 'entregado');
  try {
    const res = await peticion;
    assert.strictEqual(res.status, 200);

    const iMesa = indiceDe(db, SQL_BLOQUEO_MESA);
    const iPedido = indiceDe(db, SQL_UPDATE_PEDIDO);

    assert.ok(iMesa >= 0, 'se bloquea la mesa');
    assert.ok(
      db.buscar(SQL_BLOQUEO_MESA).sql.includes('FOR UPDATE'),
      'y es un bloqueo de verdad'
    );
    assert.ok(
      iMesa < iPedido,
      'mesa primero: es el mismo orden que usan registrarPago y registrarPagoInterno'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('la mesa se identifica en la misma sentencia, sin leer y despues bloquear', async () => {
  const socket = instalarFakeSocket();
  const { db, peticion } = patch('pagado', 'entregado');
  try {
    await peticion;

    const bloqueo = db.buscar(SQL_BLOQUEO_MESA);
    assert.ok(
      bloqueo.sql.includes('SELECT p.id_mesa FROM pedidos p WHERE p.id_pedido = $1'),
      'subconsulta: entre leer y bloquear el pedido podria cambiar de mesa'
    );
    // El id llega como string desde req.params.
    assert.deepStrictEqual(bloqueo.params, [String(ID_PEDIDO)]);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('cancelar tambien bloquea la mesa primero', async () => {
  const socket = instalarFakeSocket();
  const { db, peticion } = patch('cancelado', 'recibido');
  try {
    const res = await peticion;
    assert.strictEqual(res.status, 200);
    assert.ok(indiceDe(db, SQL_BLOQUEO_MESA) < indiceDe(db, SQL_UPDATE_PEDIDO));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('marcar entregado tambien bloquea la mesa primero', async () => {
  // Cambio de expectativa: antes 'entregado' no tocaba la mesa. Desde la regla
  // de cierre puede cerrar el pedido en 'pagado' y liberarla, asi que tiene que
  // tomar el mismo orden que los pagos (mesa -> pedido) o se reintroduce el
  // interbloqueo. El bloqueo se toma SIEMPRE, no solo cuando el pedido esta
  // pagado: se sabe si lo esta despues del UPDATE, y para entonces ya seria
  // tarde para ordenar los bloqueos.
  const socket = instalarFakeSocket();
  const { db, peticion } = patch('entregado', 'listo');
  try {
    const res = await peticion;
    assert.strictEqual(res.status, 200);
    assert.ok(indiceDe(db, SQL_BLOQUEO_MESA) >= 0, 'se bloquea la mesa');
    assert.ok(
      indiceDe(db, SQL_BLOQUEO_MESA) < indiceDe(db, SQL_UPDATE_PEDIDO),
      'mesa primero, igual que registrarPago y registrarPagoInterno'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

for (const estado of ['en_preparacion', 'listo']) {
  test(`una transicion a '${estado}' NO bloquea la mesa`, async () => {
    const socket = instalarFakeSocket();
    const { db, peticion } = patch(estado, 'recibido');
    try {
      const res = await peticion;

      assert.strictEqual(res.status, 200);
      assert.strictEqual(
        db.buscar(SQL_BLOQUEO_MESA),
        undefined,
        'no toca la mesa en ningun momento, asi que bloquearla serializaria las comandas sin motivo'
      );
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('el bloqueo va dentro de la transaccion del cambio de estado', async () => {
  const socket = instalarFakeSocket();
  const { db, peticion } = patch('pagado', 'entregado');
  try {
    await peticion;

    const iBegin = indiceDe(db, 'BEGIN');
    const iMesa = indiceDe(db, SQL_BLOQUEO_MESA);
    const iCommit = indiceDe(db, 'COMMIT');

    assert.ok(iBegin >= 0 && iBegin < iMesa, 'despues del BEGIN');
    assert.ok(iMesa < iCommit, 'y antes del COMMIT');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un pedido inexistente no bloquea nada', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch(`/api/pedidos/${ID_PEDIDO}/estado`)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ estado: 'pagado' });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.buscar(SQL_BLOQUEO_MESA), undefined);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
