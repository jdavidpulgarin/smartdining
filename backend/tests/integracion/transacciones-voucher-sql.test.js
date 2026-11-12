const test = require('node:test');
const assert = require('node:assert');

/**
 * Voucher del datáfono en el cobro de caja (script 35) contra PostgreSQL real:
 * POST /api/transacciones/mesa de punta a punta (controlador, reparto, CHECK
 * ck_transacciones_voucher) y GET /api/transacciones.
 *
 *   a. tarjeta sobre 2 pedidos: las dos filas llevan el mismo voucher;
 *   b. reintento con el mismo id_cobro y otro voucher: duplicado, y el voucher
 *      guardado no cambia;
 *   c. efectivo sin voucher: NULL en la base;
 *   d. GET /transacciones lo devuelve.
 *
 * El socket-server es el doble de tests/helpers/fake-socket.js: no se sale a
 * la red y, de paso, se comprueba que el voucher no viaja en los avisos.
 *
 * MESAS PROPIAS (criterio de #146 y #158): desde MESA_NUMERO_VOUCHER (1040 por
 * omisión), marcadas en `ubicacion`. La limpieza es la de
 * transacciones-mesa-sql.test.js (transacciones y su auditoría, reservas de
 * inventario devueltas, libro, pedidos y mesas), al empezar y al terminar.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { instalarFakeSocket } = require('../helpers/fake-socket');
const app = require('../../server');
const pool = require('../../src/config/db');
const socketNotifier = require('../../src/services/socket.notifier');
const pedidosService = require('../../src/services/pedidos.service');

const MESA_BASE = parseInt(process.env.MESA_NUMERO_VOUCHER || '1040', 10);
const MARCA_MESA = 'PRUEBA voucher-caja';

let sonda = null;
let hayBase = false;
let socket = null;
let plato = null; // { id_plato, precio_centavos }
let usuario = null; // { id_usuario, token }
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const mesas = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = mesas.rows.map((m) => m.id_mesa);
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1::int AND numero < $1::int + 20 AND ubicacion <> $2::text LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_VOUCHER`);
  }
  if (ids.length === 0) return;

  const t = await sonda.query(
    `DELETE FROM transacciones
      WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_mesa = ANY($1::int[]))
      RETURNING id_transaccion`,
    [ids]
  );
  const idsT = t.rows.map((f) => f.id_transaccion);
  if (idsT.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios
        WHERE tabla_afectada = 'transacciones'
          AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
      [idsT]
    );
  }
  await sonda.query(
    `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
       FROM detalles_pedido dp JOIN pedidos p ON p.id_pedido = dp.id_pedido
      WHERE p.id_mesa = ANY($1::int[]) ORDER BY dp.id_detalle`,
    [ids]
  );
  await sonda.query(
    `DELETE FROM movimientos_inventario
      WHERE id_detalle IN (SELECT dp.id_detalle FROM detalles_pedido dp
                           JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[]))`,
    [ids]
  );
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [ids]);
}

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const p = await sonda.query(
    `SELECT id_plato, ROUND(precio * 100)::bigint AS precio_centavos FROM platos
      WHERE disponible AND stock_suficiente AND NOT personalizable AND precio >= 5000
      ORDER BY id_plato LIMIT 1`
  );
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  plato = p.rows[0] ? { id_plato: p.rows[0].id_plato, precio_centavos: Number(p.rows[0].precio_centavos) } : null;
  usuario = u.rows[0] ? { id_usuario: u.rows[0].id_usuario, token: tokenStaff(u.rows[0].id_usuario, 'admin') } : null;
  hayBase = Boolean(plato && usuario);
  if (!hayBase) return;
  socket = instalarFakeSocket(() => ({ ok: true }));
  await limpiar();
});

test.after(async () => {
  try {
    await socketNotifier.esperarAvisos();
    if (hayBase) await limpiar();
  } finally {
    if (socket) socket.restaurar();
    if (sonda) await sonda.end();
    await pool.end();
  }
});

function saltarSinBase(t) {
  if (!hayBase) {
    t.skip('sin base de pruebas (o sin plato/usuario admin)');
    return true;
  }
  return false;
}

/** Mesa propia con `n` pedidos entregados de un plato. */
async function mesaConPedidos(n) {
  const numero = siguienteMesa++;
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado) VALUES ($1::int, 4, $2::text, 'ocupada') RETURNING id_mesa`,
    [numero, MARCA_MESA]
  );
  const idMesa = m.rows[0].id_mesa;
  const pedidos = [];
  for (let i = 0; i < n; i++) {
    const ped = await pedidosService.crearConDetalles({
      id_mesa: idMesa, id_usuario: usuario.id_usuario, items: [{ id_plato: plato.id_plato, cantidad: 1 }],
    });
    for (const e of ['en_preparacion', 'listo', 'entregado']) {
      await pedidosService.actualizarEstado(ped.id_pedido, e, null, usuario.id_usuario);
    }
    pedidos.push(ped.id_pedido);
  }
  return { idMesa, pedidos };
}

const cobrar = (cuerpo) => request(app)
  .post('/api/transacciones/mesa')
  .set('Authorization', `Bearer ${usuario.token}`)
  .send(cuerpo);

async function vouchersDeMesa(idMesa) {
  const { rows } = await sonda.query(
    `SELECT t.id_pedido, t.metodo_pago, t.voucher
       FROM transacciones t JOIN pedidos p ON p.id_pedido = t.id_pedido
      WHERE p.id_mesa = $1::int ORDER BY t.id_transaccion`,
    [idMesa]
  );
  return rows;
}

test('a. tarjeta sobre 2 pedidos: las dos filas llevan el mismo voucher, normalizado', async (t) => {
  if (saltarSinBase(t)) return;
  const { idMesa, pedidos } = await mesaConPedidos(2);
  const res = await cobrar({
    id_mesa: idMesa,
    monto: (2 * plato.precio_centavos) / 100,
    metodo_pago: 'tarjeta_credito',
    id_cobro: crypto.randomUUID(),
    voucher: '  ab-12 ',
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.transacciones.length, 2);
  for (const fila of res.body.transacciones) assert.strictEqual(fila.voucher, 'AB-12');

  const filas = await vouchersDeMesa(idMesa);
  assert.deepStrictEqual(filas.map((f) => f.id_pedido).sort((x, y) => x - y), [...pedidos].sort((x, y) => x - y));
  assert.deepStrictEqual(filas.map((f) => f.voucher), ['AB-12', 'AB-12']);

  // Ningún aviso al socket-server lleva el voucher.
  await socketNotifier.esperarAvisos();
  for (const aviso of socket.avisos) {
    assert.ok(!JSON.stringify(aviso.cuerpo).includes('AB-12'), `${aviso.ruta} no lleva el voucher`);
  }
});

test('b. reintento con el mismo id_cobro y otro voucher: duplicado y el voucher no cambia', async (t) => {
  if (saltarSinBase(t)) return;
  const { idMesa } = await mesaConPedidos(1);
  const idCobro = crypto.randomUUID();
  const cuerpo = { id_mesa: idMesa, monto: plato.precio_centavos / 100, metodo_pago: 'tarjeta_debito', id_cobro: idCobro };

  const primero = await cobrar({ ...cuerpo, voucher: 'PRIMERO-1' });
  assert.strictEqual(primero.status, 201, JSON.stringify(primero.body));

  const reintento = await cobrar({ ...cuerpo, voucher: 'OTRO-2' });
  assert.ok([200, 201].includes(reintento.status), JSON.stringify(reintento.body));
  assert.strictEqual(reintento.body.duplicado, true);

  const filas = await vouchersDeMesa(idMesa);
  assert.deepStrictEqual(filas.map((f) => f.voucher), ['PRIMERO-1']);
});

test('c. efectivo sin voucher: la fila queda con voucher NULL', async (t) => {
  if (saltarSinBase(t)) return;
  const { idMesa } = await mesaConPedidos(1);
  const res = await cobrar({
    id_mesa: idMesa, monto: plato.precio_centavos / 100, metodo_pago: 'efectivo', id_cobro: crypto.randomUUID(),
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.transacciones[0].voucher, null);
  const filas = await vouchersDeMesa(idMesa);
  assert.deepStrictEqual(filas, [{ id_pedido: filas[0].id_pedido, metodo_pago: 'efectivo', voucher: null }]);
});

test('d. GET /transacciones devuelve el voucher (o null) de cada fila', async (t) => {
  if (saltarSinBase(t)) return;
  const tarjeta = await mesaConPedidos(1);
  const efectivo = await mesaConPedidos(1);
  const conVoucher = await cobrar({
    id_mesa: tarjeta.idMesa, monto: plato.precio_centavos / 100, metodo_pago: 'tarjeta_debito',
    id_cobro: crypto.randomUUID(), voucher: 'lista-77',
  });
  const sinVoucher = await cobrar({
    id_mesa: efectivo.idMesa, monto: plato.precio_centavos / 100, metodo_pago: 'efectivo', id_cobro: crypto.randomUUID(),
  });
  assert.strictEqual(conVoucher.status, 201, JSON.stringify(conVoucher.body));
  assert.strictEqual(sinVoucher.status, 201, JSON.stringify(sinVoucher.body));

  const res = await request(app)
    .get('/api/transacciones?desde=hoy')
    .set('Authorization', `Bearer ${usuario.token}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const deMesa = (idMesa) => res.body.transacciones.filter((f) => f.id_mesa === idMesa);
  assert.deepStrictEqual(deMesa(tarjeta.idMesa).map((f) => f.voucher), ['LISTA-77']);
  assert.deepStrictEqual(deMesa(efectivo.idMesa).map((f) => f.voucher), [null]);
  // Todas las filas traen la clave, aunque sea null.
  for (const fila of res.body.transacciones) assert.ok('voucher' in fila, `fila ${fila.id_transaccion} sin voucher`);
});
