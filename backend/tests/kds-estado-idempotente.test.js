const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const app = require('../server');

// PATCH /api/kds/comandas/:id/estado tiene que ser idempotente: dos toques en
// la pantalla, o el reintento de una peticion cuya respuesta se perdio, no deben
// dejar dos entradas en historial_estados ni dos filas en kds_metricas, ni
// anunciar dos veces lo mismo.

const ID_PEDIDO = 87;

const PEDIDO = {
  id_pedido: ID_PEDIDO,
  codigo_pedido: 'PED-261013-ABC12',
  id_mesa: 5,
  total: '48000.00',
  notas_generales: null,
};

const jwtCocina = () => tokenStaff(2, 'cocina');

const patch = (estado, id = ID_PEDIDO) =>
  request(app)
    .patch(`/api/kds/comandas/${id}/estado`)
    .set('Authorization', `Bearer ${jwtCocina()}`)
    .send({ estado });

/** @param {{estadoActual?: string|null}} opciones */
function responder({ estadoActual = 'en_preparacion' } = {}) {
  return (sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) {
      return estadoActual === null ? { rows: [] } : { rows: [{ estado: estadoActual }] };
    }
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      return estadoActual === null
        ? { rows: [] }
        : { rows: [{ ...PEDIDO, estado: estadoActual }] };
    }
    if (sql.includes('UPDATE pedidos SET estado')) {
      return { rows: [{ ...PEDIDO, estado: params[0] }] };
    }
    return { rows: [] };
  };
}

// ---------------------------------------------------------------------------
// Mismo estado: no se escribe nada
// ---------------------------------------------------------------------------

for (const estado of ['en_preparacion', 'listo']) {
  test(`${estado} -> ${estado} responde 200 sin tocar la base`, async () => {
    const socket = instalarFakeSocket();
    const db = instalarFakeDb(responder({ estadoActual: estado }));
    try {
      const res = await patch(estado);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.sin_cambios, true, 'se marca que no hubo cambios');
      assert.strictEqual(res.body.estado, estado, 'devuelve la comanda como esta');

      assert.strictEqual(
        db.buscar('UPDATE pedidos SET estado'),
        undefined,
        'no se ejecuta el UPDATE'
      );
      assert.strictEqual(
        db.buscar('INSERT INTO historial_estados'),
        undefined,
        'no se duplica la entrada del historial'
      );
      assert.strictEqual(
        socket.buscar('/internal/order-status'),
        undefined,
        'no se anuncia dos veces lo mismo'
      );
      assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

test('el segundo toque seguido no repite el trabajo del primero', async () => {
  const socket = instalarFakeSocket();

  // Doble con memoria: el estado cambia cuando se ejecuta el UPDATE, como en la
  // base real. Asi el segundo PATCH ya encuentra la comanda en 'listo'.
  let estadoActual = 'en_preparacion';
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: estadoActual }] };
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      return { rows: [{ ...PEDIDO, estado: estadoActual }] };
    }
    if (sql.includes('UPDATE pedidos SET estado')) {
      estadoActual = params[0];
      return { rows: [{ ...PEDIDO, estado: estadoActual }] };
    }
    return { rows: [] };
  });
  try {
    const primero = await patch('listo');
    const segundo = await patch('listo');

    assert.strictEqual(primero.status, 200);
    assert.strictEqual(primero.body.sin_cambios, false, 'el primero si cambia');
    assert.strictEqual(segundo.status, 200);
    assert.strictEqual(segundo.body.sin_cambios, true, 'el segundo no');

    assert.strictEqual(db.todas('UPDATE pedidos SET estado').length, 1, 'un solo UPDATE');
    assert.strictEqual(
      db.todas('INSERT INTO historial_estados').length,
      1,
      'una sola entrada en el historial (y por tanto una sola fila de metricas)'
    );
    assert.strictEqual(
      socket.todos('/internal/order-status').length,
      1,
      'un solo aviso al socket'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('la comprobacion y el cambio van bajo un advisory lock por pedido', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder({ estadoActual: 'listo' }));
  try {
    await patch('listo');

    const lock = db.buscar('pg_advisory_lock');
    assert.ok(lock, 'se toma el lock antes de mirar el estado');
    assert.strictEqual(lock.params[1], ID_PEDIDO, 'el lock es por id_pedido');

    const orden = db.ejecutadas.map((q) => q.sql);
    const indice = (f) => orden.findIndex((s) => s.includes(f));
    assert.ok(
      indice('pg_advisory_lock') < indice('SELECT estado FROM pedidos'),
      'primero el lock, despues la lectura'
    );
    assert.ok(db.buscar('pg_advisory_unlock'), 'y se suelta al terminar');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el lock se suelta tambien cuando la base falla', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'en_preparacion' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      const err = new Error('Transición de estado no autorizada');
      err.code = 'P0001';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await patch('listo');

    assert.strictEqual(res.status, 409);
    assert.ok(db.buscar('pg_advisory_unlock'), 'el finally lo libera');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Estado distinto: el flujo de siempre
// ---------------------------------------------------------------------------

test('un estado distinto cambia la comanda y avisa al socket', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder({ estadoActual: 'recibido' }));
  try {
    const res = await patch('en_preparacion');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.sin_cambios, false);
    assert.strictEqual(res.body.estado, 'en_preparacion');

    assert.ok(db.buscar('UPDATE pedidos SET estado'));
    assert.ok(db.buscar('INSERT INTO historial_estados'));

    const aviso = socket.buscar('/internal/order-status');
    assert.ok(aviso, 'el comensal ve avanzar su pedido');
    assert.strictEqual(aviso.cuerpo.estado, 'en_preparacion');
    assert.strictEqual(aviso.cuerpo.estado_anterior, 'recibido');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el historial guarda el estado anterior real, no el pedido', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder({ estadoActual: 'recibido' }));
  try {
    await patch('en_preparacion');

    const historial = db.buscar('INSERT INTO historial_estados');
    assert.strictEqual(historial.params[2], 'recibido', 'estado_anterior');
    assert.strictEqual(historial.params[1], 2, 'queda el cocinero que lo movio');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// 404 y 400 siguen igual
// ---------------------------------------------------------------------------

test('una comanda inexistente sigue dando 404', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder({ estadoActual: null }));
  try {
    const res = await patch('listo');

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Comanda no encontrada');
    assert.strictEqual(db.buscar('UPDATE pedidos SET estado'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un id que no es un entero positivo responde 404 sin consultar la base', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder());
  try {
    for (const id of ['abc', '0', '-3']) {
      const res = await patch('listo', id);
      assert.strictEqual(res.status, 404, `id "${id}"`);
    }
    assert.strictEqual(
      db.buscar('SELECT estado FROM pedidos'),
      undefined,
      'no se le pregunta nada a la base por un id imposible'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un estado que el KDS no acepta sigue dando 400', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder());
  try {
    for (const estado of ['pagado', 'entregado', 'cancelado', 'recibido', 'inventado']) {
      const res = await patch(estado);
      assert.strictEqual(res.status, 400, estado);
      assert.match(res.body.error, /solo se puede cambiar a/);
    }
    assert.strictEqual(db.buscar('pg_advisory_lock'), undefined, 'ni se toma el lock');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('sin JWT de cocina o admin sigue sin pasar', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responder());
  try {
    const sinToken = await request(app)
      .patch(`/api/kds/comandas/${ID_PEDIDO}/estado`)
      .send({ estado: 'listo' });
    assert.strictEqual(sinToken.status, 401);

    const conMesero = await request(app)
      .patch(`/api/kds/comandas/${ID_PEDIDO}/estado`)
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ estado: 'listo' });
    assert.strictEqual(conMesero.status, 403);

    assert.strictEqual(db.buscar('pg_advisory_lock'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
