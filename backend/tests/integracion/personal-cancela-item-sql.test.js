const test = require('node:test');
const assert = require('node:assert');

/**
 * D-13 por el PERSONAL: POST /api/pedidos/:id/items/:id_detalle/cancelar con
 * sesión de admin o mesero, contra PostgreSQL REAL. Lo que se prueba aquí
 * lo decide la base: devolución o MERMA (tr_devolver_inventario), el autor del
 * movimiento (app.id_usuario), el total y la transición del pedido.
 *
 * STOCK "EXACTO" CON SUITES EN PARALELO: como en quitar-item-sql, se mira el
 * LIBRO de cada detalle (reserva + devolución = 0, o una merma de cantidad 0
 * que deja el stock sin volver), no el stock global.
 *
 * MESAS PROPIAS (criterio de #146): una por caso, desde
 * MESA_NUMERO_CANCELA_PERSONAL (980 por omisión, rango de 20; no choca con las
 * 960-979 de quitar-item-sql), marcadas en `ubicacion`. Se limpia después de
 * CADA caso y en el `after`: transacciones y su auditoría; la reserva de cada
 * detalle se cierra con fn_cerrar_reserva_detalle(id, false); lo que una MERMA
 * de esta prueba se llevó se devuelve al stock (la merma era simulada: nadie
 * cocinó nada), así el stock y el libro siguen cuadrando; y se borran el libro
 * de esos detalles, los pedidos y las mesas.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

// Sin socket-server real (los avisos quedan SIN_CONFIGURAR) y sin Redis.
process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');

const MESA_BASE = parseInt(process.env.MESA_NUMERO_CANCELA_PERSONAL || '980', 10);
const MARCA_MESA = 'PRUEBA personal-cancela-item';

let sonda = null;
let hayBase = false;
let catalogo = null; // el de plato-prueba.js, con su limpiar()
let plato = null;
let admin = null; // { id, jwt }
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1::int AND numero < $1::int + 20 AND ubicacion <> $2::text LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_CANCELA_PERSONAL`);
  }
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
  if (ids.length === 0) return;
  const detallesDe = `SELECT dp.id_detalle FROM detalles_pedido dp
                        JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[])`;

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
  // La merma de una prueba no devuelve stock (es lo que se prueba): se
  // devuelve aquí lo reservado de esos detalles, que nadie cocinó de verdad.
  await sonda.query(
    `UPDATE insumos s SET stock_actual = s.stock_actual + r.cantidad
       FROM (SELECT m.id_insumo, SUM(-m.cantidad) AS cantidad
               FROM movimientos_inventario m
              WHERE m.tipo = 'reserva' AND m.id_detalle IN (${detallesDe})
                AND EXISTS (SELECT 1 FROM movimientos_inventario x
                             WHERE x.id_detalle = m.id_detalle AND x.tipo = 'merma')
              GROUP BY m.id_insumo) r
      WHERE s.id_insumo = r.id_insumo`,
    [ids]
  );
  await sonda.query(`DELETE FROM movimientos_inventario WHERE id_detalle IN (${detallesDe})`, [ids]);
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [ids]);
}

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  admin = u.rows[0] ? { id: u.rows[0].id_usuario, jwt: tokenStaff(u.rows[0].id_usuario, 'admin') } : null;
  if (!admin) return;
  // Plato con receta PROPIO (tests/helpers/plato-prueba.js), sobre un insumo
  // propio con stock alto: nada del seed, nada compartido con otra suite.
  catalogo = await crearCatalogoPrueba(sonda, 'personal-cancela-item', { receta: true });
  plato = catalogo.plato;
  hayBase = true;
  await limpiar();
});

test.afterEach(async () => {
  if (hayBase) await limpiar();
});

test.after(async () => {
  try {
    if (hayBase) await limpiar();
    if (catalogo) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

async function mesaAbierta() {
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
     VALUES ($1::int, 4, $2::text, 'ocupada', NOW()) RETURNING id_mesa`,
    [siguienteMesa++, MARCA_MESA]
  );
  return m.rows[0].id_mesa;
}

async function pedidoCon(idMesa, items) {
  const pedido = await pedidosService.crearConDetalles({ id_mesa: idMesa, id_usuario: admin.id, items });
  const { rows } = await sonda.query(
    'SELECT id_detalle, cantidad, subtotal FROM detalles_pedido WHERE id_pedido = $1::int ORDER BY id_detalle',
    [pedido.id_pedido]
  );
  return { idPedido: pedido.id_pedido, detalles: rows };
}

const dos = (comensal = 'Ana') => [
  { id_plato: plato.id_plato, cantidad: 2, comensal },
  { id_plato: plato.id_plato, cantidad: 1, comensal },
];

// El motivo es OBLIGATORIO para el personal: por omisión se manda uno.
const cancelar = (idPedido, idDetalle, cuerpo = { motivo: 'Prueba de integración' }) => request(app)
  .post(`/api/pedidos/${idPedido}/items/${idDetalle}/cancelar`)
  .set('Authorization', `Bearer ${admin.jwt}`)
  .send(cuerpo);

/** El libro de un detalle: tipo -> { insumos, suma, filas, usuarios }. */
async function libroDe(idDetalle) {
  const { rows } = await sonda.query(
    `SELECT tipo, array_agg(id_insumo ORDER BY id_insumo) AS insumos, SUM(cantidad)::numeric AS suma,
            count(*)::int AS filas, array_agg(DISTINCT id_usuario) AS usuarios
       FROM movimientos_inventario WHERE id_detalle = $1::int GROUP BY tipo`,
    [idDetalle]
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r]));
}

async function filaPedido(idPedido) {
  const { rows } = await sonda.query('SELECT estado, total, estado_pago FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
  return rows[0];
}

async function estadoItem(idDetalle) {
  const { rows } = await sonda.query('SELECT estado_item, cantidad FROM detalles_pedido WHERE id_detalle = $1::int', [idDetalle]);
  return rows[0];
}

/** Simula lo que hoy no hace el KDS (trabaja por pedido): la línea en cocina o servida. */
async function lineaEn(idDetalle, estado) {
  await sonda.query('UPDATE detalles_pedido SET estado_item = $1::text WHERE id_detalle = $2::int', [estado, idDetalle]);
}

test('a. línea "pendiente" con el pedido en "recibido": devolución exacta, la línea entera y el total baja', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [doble, sencilla] } = await pedidoCon(idMesa, dos());
  const antes = await filaPedido(idPedido);

  const res = await cancelar(idPedido, doble.id_detalle);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(await estadoItem(doble.id_detalle), { estado_item: 'cancelado', cantidad: 2 });

  const libro = await libroDe(doble.id_detalle);
  assert.strictEqual(libro.merma, undefined, 'no es merma');
  assert.deepStrictEqual(libro.devolucion.insumos, libro.reserva.insumos);
  assert.strictEqual(Number(libro.reserva.suma) + Number(libro.devolucion.suma), 0, 'vuelve exactamente lo reservado');
  assert.deepStrictEqual(libro.devolucion.usuarios, [admin.id], 'la devolución lleva al usuario de la sesión');
  assert.strictEqual((await libroDe(sencilla.id_detalle)).devolucion, undefined);

  const despues = await filaPedido(idPedido);
  assert.strictEqual(despues.estado, 'recibido');
  assert.strictEqual(despues.total, antes.total - doble.subtotal);
  assert.strictEqual(res.body.pedido.total, despues.total);
});

test('b. línea "cocinando": MERMA (el stock no vuelve) y el movimiento lleva el id del usuario', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [enCocina] } = await pedidoCon(idMesa, dos());
  await lineaEn(enCocina.id_detalle, 'cocinando');

  const res = await cancelar(idPedido, enCocina.id_detalle, { motivo: 'Se quemó' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual((await estadoItem(enCocina.id_detalle)).estado_item, 'cancelado');

  const libro = await libroDe(enCocina.id_detalle);
  assert.strictEqual(libro.devolucion, undefined, 'no hay devolución');
  assert.ok(libro.merma, 'hay merma');
  assert.strictEqual(Number(libro.merma.suma), 0, 'la merma va en 0: el stock ya se descontó en la reserva y no vuelve');
  assert.deepStrictEqual(libro.merma.insumos, libro.reserva.insumos);
  assert.deepStrictEqual(libro.merma.usuarios, [admin.id], 'la merma lleva al usuario de la sesión');
});

test('c. línea "servido": 409 item_no_cancelable y nada cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [servida] } = await pedidoCon(idMesa, dos());
  await lineaEn(servida.id_detalle, 'servido');
  const antes = await filaPedido(idPedido);
  const libroAntes = await libroDe(servida.id_detalle);

  const res = await cancelar(idPedido, servida.id_detalle, { motivo: 'no' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.motivo, 'item_no_cancelable');
  assert.strictEqual((await estadoItem(servida.id_detalle)).estado_item, 'servido');
  assert.deepStrictEqual(await libroDe(servida.id_detalle), libroAntes);
  assert.deepStrictEqual(await filaPedido(idPedido), antes);
});

test('d. última línea (pedido en preparación): pedido cancelado, historial con el usuario y el motivo, la mesa sigue ocupada', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [unica] } = await pedidoCon(idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);
  await pedidosService.actualizarEstado(idPedido, 'en_preparacion', null, admin.id);

  const res = await cancelar(idPedido, unica.id_detalle, { motivo: '  Se acabó el pollo  ' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.pedido.estado, 'cancelado');
  assert.strictEqual(res.body.pedido.total, 0);

  const { rows: hist } = await sonda.query(
    `SELECT id_usuario, estado_anterior, estado_nuevo, observaciones FROM historial_estados
      WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'`,
    [idPedido]
  );
  assert.deepStrictEqual(hist, [{ id_usuario: admin.id, estado_anterior: 'en_preparacion', estado_nuevo: 'cancelado', observaciones: 'Se acabó el pollo' }]);
  // El pedido ya estaba en preparación: la línea pendiente es MERMA.
  assert.ok((await libroDe(unica.id_detalle)).merma);

  const { rows: mesa } = await sonda.query('SELECT estado FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  assert.strictEqual(mesa[0].estado, 'ocupada', 'la mesa no se libera');
});

test('d2. última línea con el pedido en "listo" (script 31): el pedido se cancela, lo cocinado es merma UNA vez por insumo y la mesa sigue ocupada', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [unica] } = await pedidoCon(idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);
  await pedidosService.actualizarEstado(idPedido, 'en_preparacion', null, admin.id);
  await pedidosService.actualizarEstado(idPedido, 'listo', null, admin.id);

  const res = await cancelar(idPedido, unica.id_detalle, { motivo: 'El cliente se fue' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.pedido.estado, 'cancelado');
  assert.strictEqual((await estadoItem(unica.id_detalle)).estado_item, 'cancelado');
  assert.strictEqual((await filaPedido(idPedido)).estado, 'cancelado');

  const { rows: hist } = await sonda.query(
    `SELECT id_usuario, estado_anterior, observaciones FROM historial_estados
      WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'`,
    [idPedido]
  );
  assert.deepStrictEqual(hist, [{ id_usuario: admin.id, estado_anterior: 'listo', observaciones: 'El cliente se fue' }]);

  // Lo cocinado es merma, UNA sola vez por insumo: sin devolución y sin una
  // segunda merma del trigger del pedido (tr_devolver_inventario_pedido).
  const libro = await libroDe(unica.id_detalle);
  assert.deepStrictEqual(Object.keys(libro).sort(), ['merma', 'reserva'], 'ni devolución');
  assert.strictEqual(libro.merma.filas, libro.reserva.filas, 'una merma por cada insumo reservado');
  assert.deepStrictEqual(libro.merma.insumos, libro.reserva.insumos);
  assert.strictEqual(Number(libro.merma.suma), 0, 'la merma va en 0: el stock no vuelve');
  assert.deepStrictEqual(libro.merma.usuarios, [admin.id]);

  const { rows: mesa } = await sonda.query('SELECT estado FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  assert.strictEqual(mesa[0].estado, 'ocupada', 'la mesa no se libera');
});

// pago_registrado del PERSONAL (decisión de Jarrison): se permite si lo ya
// pagado NO supera el total nuevo (sin la línea). El estado_pago lo recalcula
// la base al cambiar el total (script 33). `dos()` deja una línea doble y una
// sencilla del mismo plato: al quitar la doble, queda el subtotal de la sencilla.

async function pagar(idPedido, monto) {
  await sonda.query(
    `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion)
     VALUES ($1::int, 'efectivo', $2::numeric, 'completada')`,
    [idPedido, monto]
  );
}

test('e1. cobro parcial MENOR que lo que queda: 200, el total baja y estado_pago queda "parcial"', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [doble, sencilla] } = await pedidoCon(idMesa, dos());
  await pagar(idPedido, sencilla.subtotal / 2);
  assert.strictEqual((await filaPedido(idPedido)).estado_pago, 'parcial');

  const res = await cancelar(idPedido, doble.id_detalle, { motivo: 'cliente cambió de idea' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual((await estadoItem(doble.id_detalle)).estado_item, 'cancelado');
  assert.strictEqual((await libroDe(doble.id_detalle)).devolucion.filas > 0, true, 'el stock vuelve (devolución)');
  assert.deepStrictEqual(await filaPedido(idPedido), { estado: 'recibido', total: sencilla.subtotal, estado_pago: 'parcial' });
});

test('e2. cobro IGUAL a lo que queda: 200 (igual vale) y estado_pago pasa a "pagado" (script 33); el estado de cocina no cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [doble, sencilla] } = await pedidoCon(idMesa, dos());
  await pagar(idPedido, sencilla.subtotal);
  assert.strictEqual((await filaPedido(idPedido)).estado_pago, 'parcial');

  const res = await cancelar(idPedido, doble.id_detalle);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(await filaPedido(idPedido), { estado: 'recibido', total: sencilla.subtotal, estado_pago: 'pagado' });
  const { rows } = await sonda.query('SELECT obtener_saldo_pendiente($1::int)::numeric AS saldo', [idPedido]);
  assert.strictEqual(Number(rows[0].saldo), 0, 'saldo 0');
});

test('e3. cobro MAYOR que lo que quedaría: 409 pago_registrado y nada cambia (línea viva, stock, total y estado_pago)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [doble, sencilla] } = await pedidoCon(idMesa, dos());
  // Un centavo por encima: la comparación es en centavos enteros.
  await pagar(idPedido, sencilla.subtotal + 0.01);
  const antes = await filaPedido(idPedido);
  const libroAntes = await libroDe(doble.id_detalle);

  const res = await cancelar(idPedido, doble.id_detalle, { motivo: 'cliente cambió de idea' });
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'pago_registrado');
  assert.strictEqual((await estadoItem(doble.id_detalle)).estado_item, 'pendiente', 'la línea sigue viva');
  // Stock "igual" por el libro del detalle (criterio de la suite: el stock
  // global lo pueden mover otras suites en paralelo): el ROLLBACK deshizo la
  // devolución, así que solo queda la reserva.
  assert.deepStrictEqual(await libroDe(doble.id_detalle), libroAntes);
  assert.deepStrictEqual(Object.keys(libroAntes), ['reserva']);
  assert.deepStrictEqual(await filaPedido(idPedido), antes, 'total y estado_pago iguales');
  const { rows: hist } = await sonda.query(
    "SELECT count(*)::int AS n FROM historial_estados WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'",
    [idPedido]
  );
  assert.strictEqual(hist[0].n, 0);
});

test('e4. ÚLTIMA línea viva con algo pagado: 409 pago_registrado y el pedido NO se cancela', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [unica] } = await pedidoCon(idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);
  await pagar(idPedido, 100);
  const antes = await filaPedido(idPedido);

  const res = await cancelar(idPedido, unica.id_detalle, { motivo: 'El cliente se fue' });
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'pago_registrado');
  assert.strictEqual((await estadoItem(unica.id_detalle)).estado_item, 'pendiente');
  assert.deepStrictEqual(await filaPedido(idPedido), antes);
  assert.strictEqual(antes.estado, 'recibido');
});

test('f. reintento sobre una línea ya cancelada: 409 item_ya_cancelado sin doble devolución', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [primera] } = await pedidoCon(idMesa, dos());
  assert.strictEqual((await cancelar(idPedido, primera.id_detalle)).status, 200);
  const libroAntes = await libroDe(primera.id_detalle);
  const totalAntes = (await filaPedido(idPedido)).total;

  const otra = await cancelar(idPedido, primera.id_detalle);
  assert.strictEqual(otra.status, 409);
  assert.strictEqual(otra.body.motivo, 'item_ya_cancelado');
  assert.deepStrictEqual(await libroDe(primera.id_detalle), libroAntes, 'ni una devolución más');
  assert.strictEqual(libroAntes.devolucion.filas, libroAntes.reserva.filas);
  assert.strictEqual((await filaPedido(idPedido)).total, totalAntes);
});

test('g. el personal cancela la línea de cualquier comensal (sin regla de dueño), y también una sin comensal', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const idMesa = await mesaAbierta();
  const { idPedido, detalles: [deBeto, sinDueno] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Beto' },
    { id_plato: plato.id_plato, cantidad: 1 },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  assert.strictEqual((await cancelar(idPedido, deBeto.id_detalle)).status, 200);
  assert.strictEqual((await cancelar(idPedido, sinDueno.id_detalle)).status, 200);
});
