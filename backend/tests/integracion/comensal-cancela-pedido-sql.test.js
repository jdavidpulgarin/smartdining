const test = require('node:test');
const assert = require('node:assert');

/**
 * D-12: el COMENSAL cancela su pedido completo (POST /api/pedidos/:id/cancelar
 * con su sesión) contra PostgreSQL REAL. Lo que se prueba aquí lo hace la base:
 * la devolución de cada línea (tr_devolver_inventario), que el cierre del pedido
 * (tr_devolver_inventario_pedido) NO la repite, el total y la transición.
 *
 * STOCK "EXACTO" CON SUITES EN PARALELO: como en quitar-item-sql, se mira el
 * LIBRO de cada detalle (reserva + devolución = 0, una sola devolución por
 * insumo, sin merma), no el stock global.
 *
 * MESAS PROPIAS (criterio de #146): una por caso, desde
 * MESA_NUMERO_CANCELA_PEDIDO (1000 por omisión, rango de 20; no choca con
 * 960-979 de quitar-item-sql ni con 980-999 de personal-cancela-item-sql),
 * marcadas en `ubicacion`. Se limpia después de CADA caso y en el `after`:
 * transacciones y su auditoría, la reserva de cada detalle con
 * fn_cerrar_reserva_detalle(id, false), el libro de esos detalles, los pedidos y
 * las mesas.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { abrirSonda } = require('../helpers/base-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const { construirTokenQr } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');

const MESA_BASE = parseInt(process.env.MESA_NUMERO_CANCELA_PEDIDO || '1000', 10);
const MARCA_MESA = 'PRUEBA comensal-cancela-pedido';

let sonda = null;
let hayBase = false;
let catalogo = null; // el de plato-prueba.js, con su limpiar()
let plato = null;
let constructor = null;
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1::int AND numero < $1::int + 20 AND ubicacion <> $2::text LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_CANCELA_PEDIDO`);
  }
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
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
  // Plato con receta y plato del constructor PROPIOS (tests/helpers/plato-prueba.js),
  // sobre un insumo propio con stock alto: nada del seed, nada compartido.
  catalogo = await crearCatalogoPrueba(sonda, 'comensal-cancela-pedido', { receta: true, conConstructor: true });
  plato = catalogo.plato;
  constructor = catalogo.constructor;
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

/** Mesa propia, abierta, con su QR vigente; y el JWT de un comensal de ella. */
async function mesaConComensal(alias = 'Ana') {
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
     VALUES ($1::int, 4, $2::text, 'ocupada', NOW()) RETURNING id_mesa`,
    [siguienteMesa++, MARCA_MESA]
  );
  const idMesa = m.rows[0].id_mesa;
  const { token, sid } = construirTokenQr(idMesa);
  await sonda.query('UPDATE mesas SET token_qr = $1::text WHERE id_mesa = $2::int', [token, idMesa]);
  return {
    idMesa,
    tokenQr: token,
    jwtComensal: jwt.sign({ id_mesa: idMesa, sid, rol: 'comensal', comensal: alias }, process.env.JWT_SECRET),
  };
}

async function pedidoCon(idMesa, items) {
  const pedido = await pedidosService.crearConDetalles({ id_mesa: idMesa, id_usuario: null, items });
  const { rows } = await sonda.query(
    'SELECT id_detalle FROM detalles_pedido WHERE id_pedido = $1::int ORDER BY id_detalle',
    [pedido.id_pedido]
  );
  return { idPedido: pedido.id_pedido, detalles: rows.map((r) => r.id_detalle) };
}

const cancelarPedido = (jwtComensal, idPedido) => request(app)
  .post(`/api/pedidos/${idPedido}/cancelar`)
  .set('Authorization', `Bearer ${jwtComensal}`);

const quitarLinea = (jwtComensal, idPedido, idDetalle) => request(app)
  .post(`/api/pedidos/${idPedido}/items/${idDetalle}/cancelar`)
  .set('Authorization', `Bearer ${jwtComensal}`);

/** El libro de un detalle: tipo -> { insumos, suma, filas }. */
async function libroDe(idDetalle) {
  const { rows } = await sonda.query(
    `SELECT tipo, array_agg(id_insumo ORDER BY id_insumo) AS insumos, SUM(cantidad)::numeric AS suma, count(*)::int AS filas
       FROM movimientos_inventario WHERE id_detalle = $1::int GROUP BY tipo`,
    [idDetalle]
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r]));
}

/** Devuelto exacto y UNA sola vez: una devolución por cada reserva, sin merma. */
function devueltoUnaVez(libro, nota) {
  assert.ok(libro.reserva, `${nota}: hubo reserva`);
  assert.ok(libro.devolucion, `${nota}: hubo devolución`);
  assert.strictEqual(libro.merma, undefined, `${nota}: no es merma`);
  assert.deepStrictEqual(libro.devolucion.insumos, libro.reserva.insumos, `${nota}: una devolución por insumo reservado`);
  assert.strictEqual(libro.devolucion.filas, libro.reserva.filas, `${nota}: ni una devolución de más`);
  assert.strictEqual(Number(libro.reserva.suma) + Number(libro.devolucion.suma), 0, `${nota}: vuelve exactamente lo reservado`);
}

const sigueReservado = async (idDetalle) =>
  assert.deepStrictEqual(Object.keys(await libroDe(idDetalle)), ['reserva'], `el detalle ${idDetalle} sigue reservado`);

async function filaPedido(idPedido) {
  const { rows } = await sonda.query('SELECT estado, total FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
  return rows[0];
}

async function estadosItems(idPedido) {
  const { rows } = await sonda.query(
    'SELECT estado_item FROM detalles_pedido WHERE id_pedido = $1::int ORDER BY id_detalle', [idPedido]
  );
  return rows.map((r) => r.estado_item);
}

test('a. 2 líneas suyas (una de cantidad 2 y una del constructor): todo cancelado, devolución exacta una sola vez, la mesa sigue ocupada', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  if (!constructor) return t.skip('la base no tiene un plato del constructor con recetas');
  const { idMesa, tokenQr, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' },
    { id_plato: constructor.id_plato, cantidad: 1, comensal: 'ána', ingredientes: constructor.ingredientes },
  ]);

  const res = await cancelarPedido(jwtComensal, idPedido);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.pedido.estado, 'cancelado');
  assert.strictEqual(res.body.pedido.total, 0);
  assert.deepStrictEqual(res.body.pedido.items.map((i) => i.estado_item), ['cancelado', 'cancelado']);

  assert.deepStrictEqual(await filaPedido(idPedido), { estado: 'cancelado', total: 0 });
  for (const idDetalle of detalles) devueltoUnaVez(await libroDe(idDetalle), `detalle ${idDetalle}`);

  const { rows: hist } = await sonda.query(
    `SELECT id_usuario, estado_anterior, observaciones FROM historial_estados
      WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'`,
    [idPedido]
  );
  assert.deepStrictEqual(hist, [{ id_usuario: null, estado_anterior: 'recibido', observaciones: 'Cancelado por el comensal' }]);

  const { rows: mesa } = await sonda.query('SELECT estado, token_qr FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  assert.deepStrictEqual(mesa[0], { estado: 'ocupada', token_qr: tokenQr }, 'la mesa sigue abierta con su QR');
});

test('b. con una línea de otro comensal: 409 pedido_compartido y nada cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Beto' },
  ]);
  const antes = await filaPedido(idPedido);

  const res = await cancelarPedido(jwtComensal, idPedido);
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'pedido_compartido');
  assert.deepStrictEqual(await filaPedido(idPedido), antes);
  assert.deepStrictEqual(await estadosItems(idPedido), ['pendiente', 'pendiente']);
  for (const idDetalle of detalles) await sigueReservado(idDetalle);
});

test('c. con una línea ya quitada (#180) y el resto suyo: se puede, y lo ya devuelto no se devuelve otra vez', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles: [quitada, resto] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  assert.strictEqual((await quitarLinea(jwtComensal, idPedido, quitada)).status, 200);
  const libroQuitada = await libroDe(quitada);
  devueltoUnaVez(libroQuitada, 'la ya quitada');

  const res = await cancelarPedido(jwtComensal, idPedido);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(await libroDe(quitada), libroQuitada, 'la ya quitada no se devuelve otra vez');
  devueltoUnaVez(await libroDe(resto), 'el resto');
  assert.strictEqual((await filaPedido(idPedido)).estado, 'cancelado');
});

test('c2. una línea ya quitada de OTRO comensal no impide cancelar: solo cuentan las vivas', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { id_mesa: idMesaJwt, sid } = jwt.decode(jwtComensal);
  const jwtBeto = jwt.sign({ id_mesa: idMesaJwt, sid, rol: 'comensal', comensal: 'Beto' }, process.env.JWT_SECRET);
  const { idPedido, detalles: [deBeto] } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Beto' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  assert.strictEqual((await quitarLinea(jwtBeto, idPedido, deBeto)).status, 200);
  assert.strictEqual((await cancelarPedido(jwtComensal, idPedido)).status, 200);
});

test('d. cocina pasa el pedido a en_preparacion: 409 no_cancelable; y a la vez, uno gana y el otro espera', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // En serie.
  const m = await mesaConComensal('Ana');
  const p = await pedidoCon(m.idMesa, [{ id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' }]);
  await pedidosService.actualizarEstado(p.idPedido, 'en_preparacion', null, null);
  const tarde = await cancelarPedido(m.jwtComensal, p.idPedido);
  assert.strictEqual(tarde.status, 409);
  assert.strictEqual(tarde.body.motivo, 'no_cancelable');
  await sigueReservado(p.detalles[0]);

  // A la vez, en los dos órdenes.
  const ganaComensal = await carrera('comensal');
  assert.strictEqual(ganaComensal.comensal.status, 200, JSON.stringify(ganaComensal.comensal.body));
  assert.strictEqual(ganaComensal.cocina.ok, false, 'cocina llega a un pedido ya cancelado');
  assert.strictEqual(ganaComensal.estado, 'cancelado');
  for (const libro of ganaComensal.libros) devueltoUnaVez(libro, 'gana el comensal');

  const ganaCocina = await carrera('cocina');
  assert.strictEqual(ganaCocina.comensal.status, 409, JSON.stringify(ganaCocina.comensal.body));
  assert.strictEqual(ganaCocina.comensal.body.motivo, 'no_cancelable');
  assert.ok(ganaCocina.cocina.ok, `cocina no falla: ${ganaCocina.cocina.err && ganaCocina.cocina.err.message}`);
  assert.strictEqual(ganaCocina.estado, 'en_preparacion');
  for (const libro of ganaCocina.libros) assert.deepStrictEqual(Object.keys(libro), ['reserva'], 'ni devolución ni merma');
});

/**
 * El comensal cancela su pedido mientras cocina lo pasa a 'en_preparacion'. Una
 * tercera conexión retiene el pedido (FOR UPDATE); se lanza `primero`, se espera
 * a verlo BLOQUEADO, se lanza el otro, se espera a ver los dos y se suelta: gana
 * `primero`. Sin temporizadores.
 */
async function carrera(primero) {
  const m = await mesaConComensal('Ana');
  const p = await pedidoCon(m.idMesa, [
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  // Conexiones ya abiertas en el pool de la app (ver quitar-item-sql).
  await Promise.all([1, 2, 3, 4].map(() => pool.query('SELECT 1')));

  const lanzar = {
    comensal: () => cancelarPedido(m.jwtComensal, p.idPedido).then((r) => r),
    cocina: () => pedidosService.actualizarEstado(p.idPedido, 'en_preparacion', null, null)
      .then((r) => ({ ok: true, r }), (err) => ({ ok: false, err })),
  };
  const segundo = primero === 'comensal' ? 'cocina' : 'comensal';
  const enCola = {};

  const reten = await sonda.connect();
  try {
    await reten.query('BEGIN');
    await reten.query('SELECT 1 FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', [p.idPedido]);
    const esperar = async (cuantos) => {
      for (let i = 0; i < 20000; i++) {
        const { rows } = await reten.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
        );
        if (rows[0].n >= cuantos) return;
      }
      assert.fail(`no se vieron ${cuantos} esperando el bloqueo del pedido`);
    };
    enCola[primero] = lanzar[primero]();
    await esperar(1);
    enCola[segundo] = lanzar[segundo]();
    await esperar(2);
  } finally {
    await reten.query('ROLLBACK');
    reten.release();
  }

  const [comensal, cocina] = await Promise.all([enCola.comensal, enCola.cocina]);
  return {
    comensal,
    cocina,
    estado: (await filaPedido(p.idPedido)).estado,
    libros: await Promise.all(p.detalles.map((d) => libroDe(d))),
  };
}

test('e. con un pago registrado: 409 pago_registrado y nada cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles } = await pedidoCon(idMesa, [{ id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' }]);
  await sonda.query(
    `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion)
     VALUES ($1::int, 'efectivo', $2::numeric, 'completada')`,
    [idPedido, 1000]
  );
  const antes = await filaPedido(idPedido);

  const res = await cancelarPedido(jwtComensal, idPedido);
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'pago_registrado');
  assert.deepStrictEqual(await filaPedido(idPedido), antes);
  assert.deepStrictEqual(await estadosItems(idPedido), ['pendiente']);
  await sigueReservado(detalles[0]);
});

test('f. reintento: 409 pedido_ya_cancelado sin doble devolución', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, jwtComensal } = await mesaConComensal('Ana');
  const { idPedido, detalles } = await pedidoCon(idMesa, [
    { id_plato: plato.id_plato, cantidad: 2, comensal: 'Ana' },
    { id_plato: plato.id_plato, cantidad: 1, comensal: 'Ana' },
  ]);
  assert.strictEqual((await cancelarPedido(jwtComensal, idPedido)).status, 200);
  const libros = await Promise.all(detalles.map((d) => libroDe(d)));

  const otra = await cancelarPedido(jwtComensal, idPedido);
  assert.strictEqual(otra.status, 409);
  assert.strictEqual(otra.body.motivo, 'pedido_ya_cancelado');
  assert.deepStrictEqual(await Promise.all(detalles.map((d) => libroDe(d))), libros, 'ni una devolución más');
  for (const libro of libros) devueltoUnaVez(libro, 'tras el reintento');
});
