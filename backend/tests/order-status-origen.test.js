const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// `origen` en POST /internal/order-status (pedido de Juan). Va SOLO cuando el
// pedido pasa a 'cancelado' por una cancelación. Los cuatro casos que lo llevan
// se comprueban en su propia suite:
//   - D-12 (comensal cancela su pedido) -> pedidos-comensal-cancela-pedido.test.js
//   - #180 (comensal quita la última línea) -> pedidos-quitar-item.test.js
//   - D-13 (personal cancela la última línea) -> pedidos-personal-cancela-item.test.js
//   - POST /pedidos/:id/cancelar del personal -> pedidos-comensal-cancela-pedido.test.js
// Aquí: que los demás cambios de estado NO lo llevan, y la validación.

const PEDIDO = { id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-261111-ABCDE', total: 50000, estado_pago: 'pendiente' };

/** Doble de la base para actualizarEstado (PATCH /pedidos y KDS). */
function fakeEstado(estadoActual) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: estadoActual }] };
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [{ ...PEDIDO, estado: estadoActual }] };
    if (sql.includes('UPDATE pedidos SET estado')) return { rows: [{ ...PEDIDO, estado: params[0] }] };
    return { rows: [] };
  });
}

async function cuerpoOrderStatus(socket) {
  await socketNotifier.esperarAvisos();
  const aviso = socket.buscar('/internal/order-status');
  assert.ok(aviso, 'sale el order-status');
  return aviso.cuerpo;
}

test('origen: un cambio de estado del KDS (en_preparacion) NO lleva origen', async () => {
  const socket = instalarFakeSocket();
  const db = fakeEstado('recibido');
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(1, 'cocina')}`)
      .send({ estado: 'en_preparacion' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const cuerpo = await cuerpoOrderStatus(socket);
    assert.strictEqual(cuerpo.estado, 'en_preparacion');
    assert.ok(!('origen' in cuerpo));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

for (const [estadoActual, estado] of [['en_preparacion', 'listo'], ['listo', 'entregado'], ['recibido', 'cancelado']]) {
  test(`origen: PATCH /pedidos/:id/estado del mesero (${estadoActual} -> ${estado}) NO lleva origen`, async () => {
    const socket = instalarFakeSocket();
    const db = fakeEstado(estadoActual);
    try {
      const res = await request(app)
        .patch('/api/pedidos/87/estado')
        .set('Authorization', `Bearer ${tokenStaff(1, 'mesero')}`)
        .send({ estado });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      const cuerpo = await cuerpoOrderStatus(socket);
      assert.strictEqual(cuerpo.estado, estado);
      assert.ok(!('origen' in cuerpo), 'solo la ruta de cancelar lo pone');
    } finally {
      socket.restaurar();
      db.restaurar();
    }
  });
}

// --- El notificador -------------------------------------------------------------

test('origen: notificarCambioEstado manda origen solo si es válido y el estado es cancelado', async () => {
  const socket = instalarFakeSocket();
  const errores = [];
  const consoleError = console.error;
  console.error = (...a) => errores.push(a.join(' '));
  try {
    const base = { id_pedido: 1, id_mesa: 2, codigo_pedido: 'X', estado_anterior: 'recibido' };
    await socketNotifier.notificarCambioEstado({ ...base, estado: 'cancelado', origen: 'comensal' });
    await socketNotifier.notificarCambioEstado({ ...base, estado: 'cancelado', origen: 'personal' });
    await socketNotifier.notificarCambioEstado({ ...base, estado: 'cancelado', origen: 'cocina' });
    await socketNotifier.notificarCambioEstado({ ...base, estado: 'listo', origen: 'personal' });
    await socketNotifier.notificarCambioEstado({ ...base, estado: 'cancelado' });

    const cuerpos = socket.avisos.filter((a) => a.ruta === '/internal/order-status').map((a) => a.cuerpo);
    assert.strictEqual(cuerpos.length, 5, 'el aviso de estado sale siempre');
    assert.deepStrictEqual(cuerpos.map((c) => c.origen), ['comensal', 'personal', undefined, undefined, undefined]);
    assert.ok(!('origen' in cuerpos[4]), 'sin origen no se manda el campo');
    assert.strictEqual(errores.filter((m) => m.includes('order-status') && m.includes('origen no valido')).length, 2,
      'un origen fuera del contrato, o fuera de una cancelación, queda en el log');
  } finally {
    console.error = consoleError;
    socket.restaurar();
  }
});
