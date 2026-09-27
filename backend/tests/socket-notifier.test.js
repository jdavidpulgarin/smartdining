const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenComensal, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, ES_UUID, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');

const PEDIDO = { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-260927-A1B2C', estado: 'recibido' };

const DETALLES = [
  { id_detalle: 1, id_plato: 3, cantidad: 2, notas_especiales: 'Ana: sin cebolla', plato_nombre: 'Hamburguesa Smart Angus' },
  { id_detalle: 2, id_plato: 5, cantidad: 1, notas_especiales: 'Pipe', plato_nombre: 'Limonada de Coco' },
];

function dbCreacionOk(sql) {
  if (sql.includes('INSERT INTO pedidos')) return { rows: [{ ...PEDIDO, total: 0 }] };
  if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ ...PEDIDO, total: 80000, notas_generales: 'para compartir' }] };
  if (sql.includes('FROM detalles_pedido dp')) return { rows: DETALLES };
  return { rows: [] };
}

const bodyPedido = {
  items: [
    { id_plato: 3, cantidad: 2, apodo: 'Ana', notas: 'sin cebolla' },
    { id_plato: 5, cantidad: 1, apodo: 'Pipe' },
  ],
};

// ---------------------------------------------------------------------------
// order:created
// ---------------------------------------------------------------------------

test('al crear un pedido se avisa a /internal/order-created con el payload de EVENTS.md', async () => {
  const db = instalarFakeDb(dbCreacionOk);
  const socket = instalarFakeSocket();
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send(bodyPedido);

    assert.strictEqual(res.status, 201);

    const aviso = socket.buscar('/internal/order-created');
    assert.ok(aviso, 'debe avisarse al socket-server');
    assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
    assert.match(aviso.cuerpo.eventId, ES_UUID, 'eventId debe ser un UUID v4');

    const { pedido } = aviso.cuerpo;
    assert.strictEqual(pedido.id_pedido, 87);
    assert.strictEqual(pedido.id_mesa, 5);
    assert.strictEqual(pedido.estado, 'recibido');
    assert.strictEqual(pedido.codigo_pedido, 'PED-260927-A1B2C');
    assert.strictEqual(pedido.total, 80000, 'el total va como número, no como string');
    assert.strictEqual(pedido.notas_generales, 'para compartir');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('los items usan "nombre" (formato de Roberto), no "plato_nombre"', async () => {
  const db = instalarFakeDb(dbCreacionOk);
  const socket = instalarFakeSocket();
  try {
    await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send(bodyPedido);

    const { items } = socket.buscar('/internal/order-created').cuerpo.pedido;
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(items[0], {
      id_plato: 3,
      nombre: 'Hamburguesa Smart Angus',
      cantidad: 2,
      notas_especiales: 'Ana: sin cebolla',
    });
    assert.ok(!('plato_nombre' in items[0]), 'no debe filtrarse el nombre de columna de la base');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('cada pedido lleva su propio eventId', async () => {
  const db = instalarFakeDb(dbCreacionOk);
  const socket = instalarFakeSocket();
  try {
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${tokenComensal(5)}`)
        .send(bodyPedido);
    }
    const ids = socket.todos('/internal/order-created').map((a) => a.cuerpo.eventId);
    assert.strictEqual(ids.length, 2);
    assert.notStrictEqual(ids[0], ids[1], 'no debe reutilizarse el eventId');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Aislamiento: el tiempo real no puede romper el pedido
// ---------------------------------------------------------------------------

test('si el socket-server está caído el pedido se crea igual', async () => {
  const db = instalarFakeDb(dbCreacionOk);
  const socket = socketCaido();
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send(bodyPedido);

    assert.strictEqual(res.status, 201, 'el pedido NO debe fallar por el socket-server');
    assert.strictEqual(res.body.id_pedido, 87);
    assert.strictEqual(res.body.total, 80000);
    assert.ok(socket.buscar('/internal/order-created'), 'se intentó avisar');
    assert.ok(db.buscar('INSERT INTO pedidos'), 'el pedido sí se guardó en la base');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server responde 500 el pedido se crea igual', async () => {
  const db = instalarFakeDb(dbCreacionOk);
  const socket = instalarFakeSocket(() => ({ __status: 500, ok: false, codigo: 'ERROR_INTERNO' }));
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send(bodyPedido);

    assert.strictEqual(res.status, 201);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server no contesta, el notifier se rinde por timeout y no cuelga', async () => {
  const socket = instalarFakeSocket(() => new Promise(() => {})); // nunca resuelve
  process.env.SOCKET_TIMEOUT_MS = '80';
  try {
    const { notificarMesaLiberada } = require('../src/services/socket.notifier');
    const inicio = Date.now();
    const r = await notificarMesaLiberada(5);
    const transcurrido = Date.now() - inicio;

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'TIMEOUT');
    assert.ok(transcurrido < 2000, `se rindió en ${transcurrido}ms`);
  } finally {
    socket.restaurar();
  }
});

test('sin SOCKET_URL configurado no se intenta ninguna petición', async () => {
  const socket = instalarFakeSocket();
  delete process.env.SOCKET_URL;
  try {
    const { notificarMesaLiberada } = require('../src/services/socket.notifier');
    const r = await notificarMesaLiberada(5);
    assert.deepStrictEqual(r, { ok: false, motivo: 'SIN_CONFIGURAR' });
    assert.strictEqual(socket.avisos.length, 0);
  } finally {
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// order:status
// ---------------------------------------------------------------------------

function dbCambioEstado(estadoAnterior, estadoNuevo) {
  return (sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: estadoAnterior }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      return { rows: [{ ...PEDIDO, estado: estadoNuevo, total: 80000 }] };
    }
    return { rows: [] };
  };
}

test('PATCH /pedidos/:id/estado avisa a /internal/order-status con estado_anterior', async () => {
  const db = instalarFakeDb(dbCambioEstado('recibido', 'en_preparacion'));
  const socket = instalarFakeSocket();
  try {
    const res = await request(app)
      .patch('/api/pedidos/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ estado: 'en_preparacion' });

    assert.strictEqual(res.status, 200);

    const aviso = socket.buscar('/internal/order-status');
    assert.ok(aviso);
    assert.match(aviso.cuerpo.eventId, ES_UUID);
    assert.strictEqual(aviso.cuerpo.id_pedido, 87);
    assert.strictEqual(aviso.cuerpo.id_mesa, 5);
    assert.strictEqual(aviso.cuerpo.codigo_pedido, 'PED-260927-A1B2C');
    assert.strictEqual(aviso.cuerpo.estado_anterior, 'recibido');
    assert.strictEqual(aviso.cuerpo.estado, 'en_preparacion');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('el KDS también avisa a /internal/order-status', async () => {
  const db = instalarFakeDb(dbCambioEstado('en_preparacion', 'listo'));
  const socket = instalarFakeSocket();
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'listo' });

    assert.strictEqual(res.status, 200);
    const aviso = socket.buscar('/internal/order-status');
    assert.ok(aviso);
    assert.strictEqual(aviso.cuerpo.estado_anterior, 'en_preparacion');
    assert.strictEqual(aviso.cuerpo.estado, 'listo');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('una transición rechazada por el trigger no avisa nada al socket-server', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      const err = new Error('Transición de estado no autorizada: de "recibido" hacia "listo"');
      err.code = 'P0001';
      throw err;
    }
    return { rows: [] };
  });
  const socket = instalarFakeSocket();
  try {
    const res = await request(app)
      .patch('/api/pedidos/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ estado: 'listo' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(socket.avisos.length, 0, 'no se anuncia un cambio que no ocurrió');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// mesa-liberada tras el cobro
// ---------------------------------------------------------------------------

function dbPago(estadoPedido = 'entregado') {
  return (sql) => {
    if (sql.includes('SELECT * FROM pedidos')) {
      return { rows: [{ id_pedido: 87, id_mesa: 5, estado: estadoPedido }] };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      return { rows: [{ id_transaccion: 1, id_pedido: 87, monto: 80000 }] };
    }
    return { rows: [] };
  };
}

test("un cobro 'completada' avisa mesa-liberada y el cambio a pagado", async () => {
  const db = instalarFakeDb(dbPago());
  const socket = instalarFakeSocket();
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 87, monto: 80000, metodo_pago: 'efectivo', estado_transaccion: 'completada' });

    assert.strictEqual(res.status, 201);

    const liberada = socket.buscar('/internal/mesa-liberada');
    assert.ok(liberada, 'debe cerrarse la sesión de mesa');
    assert.deepStrictEqual(liberada.cuerpo, { id_mesa: 5 });

    const estado = socket.buscar('/internal/order-status');
    assert.ok(estado);
    assert.strictEqual(estado.cuerpo.estado, 'pagado');
    assert.strictEqual(estado.cuerpo.estado_anterior, 'entregado');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

for (const estado of ['fallida', 'pendiente', 'reembolsada']) {
  test(`un cobro '${estado}' NO libera la mesa`, async () => {
    const db = instalarFakeDb(dbPago());
    const socket = instalarFakeSocket();
    try {
      const res = await request(app)
        .post('/api/transacciones')
        .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
        .send({ id_pedido: 87, monto: 80000, metodo_pago: 'tarjeta_credito', estado_transaccion: estado });

      assert.strictEqual(res.status, 201, 'la transacción se registra igual');
      assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
      assert.strictEqual(socket.buscar('/internal/order-status'), undefined);
    } finally {
      socket.restaurar();
      db.restaurar();
    }
  });
}

test('si falla el aviso de mesa liberada, el cobro se registra igual', async () => {
  const db = instalarFakeDb(dbPago());
  const socket = socketCaido();
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 87, monto: 80000, metodo_pago: 'efectivo' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id_transaccion, 1);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});
