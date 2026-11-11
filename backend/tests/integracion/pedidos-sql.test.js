const test = require('node:test');
const assert = require('node:assert');

/**
 * El 23503 del AUTOR al crear un pedido o moverlo de estado, contra
 * PostgreSQL real.
 *
 * `POST /pedidos` escribe `historial_estados.id_usuario` con el id del JWT, y la
 * columna tiene su `fk_historial_usuario` contra `usuarios`. Si el usuario se
 * borró mientras su sesión seguía viva, PostgreSQL devuelve 23503 y antes salía
 * como el **409 genérico** de clave ajena, sin decir que el problema era la
 * propia sesión.
 *
 * Lo que un doble de la base NO puede comprobar y aquí sí: que la transacción
 * se deshace entera. Un pedido a medio crear dejaría la comanda en el KDS, los
 * detalles colgando y el stock descontado sin que nadie se lo haya comido.
 *
 * MESA PROPIA (review de #146). Esta suite trabaja sobre una mesa que crea ella
 * misma, con el número de `MESA_NUMERO` (901 por omisión, el mismo criterio que
 * database/tests/integracion/concurrencia-pedidos.js), y no sobre la primera de
 * la base, que es la de la demo: cada corrida le dejaba pedidos abiertos y le
 * gastaba stock al plato hasta agotarlo. Y cuenta SOLO lo de su mesa, no las
 * tablas completas, porque otras suites de integración borran filas a la vez.
 *
 * Al terminar deja la base como la encontró, aunque una prueba falle:
 *   1. cancela los pedidos que siguen en 'recibido' por el servicio, que es
 *      como cancela el backend: `tr_devolver_inventario_pedido` devuelve el
 *      stock y la mesa queda libre;
 *   2. el pedido que el cobro llevó a 'entregado' no se puede cancelar (no es
 *      una transición válida, y de todos modos sería merma): su reserva se
 *      cierra con `fn_cerrar_reserva_detalle(id, false)`, la función de la base
 *      que hace la devolución, para no mover stock a mano;
 *   3. borra el libro de inventario de sus detalles, sus pedidos (los detalles,
 *      el historial y las métricas del KDS caen en cascada) y la mesa.
 * Una corrida interrumpida se limpia al empezar la siguiente.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const kdsService = require('../../src/services/kds.service');
const transaccionesService = require('../../src/services/transacciones.service');
const autorInexistente = require('../../src/services/autor-inexistente');

/** Número de la mesa de prueba. No puede chocar con una mesa de verdad. */
const MESA_NUMERO = parseInt(process.env.MESA_NUMERO || '901', 10);
/** Marca en `ubicacion` para reconocer la mesa como propia y no tocar otra. */
const MARCA_MESA = 'PRUEBA autor-inexistente';

let sonda = null;
let hayBase = false;
let mesa = null;
let plato = null;
let usuarioReal = null;

/**
 * Deja la base como estaba: lo que esta suite creó en su mesa, y nada más.
 * Idempotente, para poder llamarla al empezar (corrida interrumpida) y al final.
 */
async function limpiarMesaDePrueba() {
  const m = await sonda.query('SELECT id_mesa, ubicacion FROM mesas WHERE numero = $1', [
    MESA_NUMERO,
  ]);
  if (m.rows.length === 0) return;
  if (m.rows[0].ubicacion !== MARCA_MESA) {
    throw new Error(
      `la mesa ${MESA_NUMERO} existe y no es de esta prueba: usa otro MESA_NUMERO`
    );
  }
  const idMesa = m.rows[0].id_mesa;

  // 1. Cancelar por el servicio lo que se pueda: devuelve el stock por el
  //    trigger y libera la mesa, igual que lo haría un mesero.
  const abiertos = await sonda.query(
    `SELECT id_pedido FROM pedidos WHERE id_mesa = $1 AND estado = 'recibido' ORDER BY id_pedido`,
    [idMesa]
  );
  for (const { id_pedido } of abiertos.rows) {
    await pedidosService.actualizarEstado(
      id_pedido,
      'cancelado',
      'limpieza de la prueba de integracion',
      usuarioReal ? usuarioReal.id_usuario : null
    );
  }

  // 2. Lo que no se puede cancelar (el pedido entregado del cobro): cerrar su
  //    reserva con la función de la base. Devuelve 0 si ya estaba cerrada, así
  //    que repetirla no duplica nada.
  await sonda.query(
    `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
       FROM detalles_pedido dp
       JOIN pedidos p ON p.id_pedido = dp.id_pedido
      WHERE p.id_mesa = $1
      ORDER BY dp.id_detalle`,
    [idMesa]
  );

  // 3. El libro de inventario de esos detalles (reserva + devolución, que ya se
  //    netearon en el stock), los pedidos y la mesa. detalles_pedido,
  //    historial_estados, kds_metricas y kds_alertas caen en cascada.
  await sonda.query(
    `DELETE FROM movimientos_inventario
      WHERE id_detalle IN (
        SELECT dp.id_detalle FROM detalles_pedido dp
        JOIN pedidos p ON p.id_pedido = dp.id_pedido
        WHERE p.id_mesa = $1)`,
    [idMesa]
  );
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = $1', [idMesa]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = $1', [idMesa]);
}

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    // Un plato NO personalizable: uno del constructor exigiría elegir opciones
    // de cada paso y el pedido fallaría por otra razón (P0001).
    const p = await sonda.query(
      `SELECT id_plato FROM platos
        WHERE disponible AND stock_suficiente AND NOT personalizable
        ORDER BY id_plato LIMIT 1`
    );
    const u = await sonda.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1');
    plato = p.rows[0] || null;
    usuarioReal = u.rows[0] || null;
    hayBase = Boolean(plato && usuarioReal);
    if (!hayBase) return;

    // Si quedó algo de una corrida interrumpida, se limpia antes de empezar.
    await limpiarMesaDePrueba();
    const m = await sonda.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion) VALUES ($1, 4, $2) RETURNING id_mesa`,
      [MESA_NUMERO, MARCA_MESA]
    );
    mesa = m.rows[0];
  } catch (err) {
    // Sin base no hay nada que probar; con base y un problema de verdad (la
    // mesa es de otro) se quiere ver el error, no un skip silencioso.
    if (err && typeof err.message === 'string' && err.message.includes('MESA_NUMERO')) throw err;
    hayBase = false;
  }
});

test.after(async () => {
  try {
    if (hayBase) await limpiarMesaDePrueba();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Un id de usuario que seguro no existe. */
async function idFantasma() {
  const { rows } = await sonda.query(
    'SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS inexistente FROM usuarios'
  );
  return Number(rows[0].inexistente);
}

/**
 * Lo que hay ahora mismo de ESTA mesa: pedidos, y detalles, historial y
 * movimientos de inventario de sus pedidos. Nada de tablas completas: otras
 * suites crean y borran filas a la vez y los totales bailan.
 */
async function huellaDeLaMesa() {
  const { rows } = await sonda.query(
    `SELECT
       (SELECT count(*) FROM pedidos p WHERE p.id_mesa = $1)::int AS pedidos,
       (SELECT count(*) FROM detalles_pedido dp
          JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = $1)::int AS detalles,
       (SELECT count(*) FROM historial_estados h
          JOIN pedidos p ON p.id_pedido = h.id_pedido WHERE p.id_mesa = $1)::int AS historial,
       (SELECT count(*) FROM movimientos_inventario m
          JOIN detalles_pedido dp ON dp.id_detalle = m.id_detalle
          JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = $1)::int AS movimientos`,
    [mesa.id_mesa]
  );
  return rows[0];
}

const unItem = () => [{ id_plato: plato.id_plato, cantidad: 1 }];

const crearConUsuarioReal = () => pedidosService.crearConDetalles({
  id_mesa: mesa.id_mesa,
  id_usuario: usuarioReal.id_usuario,
  items: unItem(),
});

test('POST /pedidos con el autor borrado: 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const fantasma = await idFantasma();

  await assert.rejects(
    () => pedidosService.crearConDetalles({
      id_mesa: mesa.id_mesa,
      id_usuario: fantasma,
      items: unItem(),
    }),
    (err) => {
      assert.strictEqual(err.status, 409, 'traducido, no el 500 ni el 409 generico');
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );
});

test('POST /pedidos: la transaccion se deshace entera, sin pedido ni stock gastado', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const fantasma = await idFantasma();
  const antes = await huellaDeLaMesa();

  await assert.rejects(() => pedidosService.crearConDetalles({
    id_mesa: mesa.id_mesa,
    id_usuario: fantasma,
    items: unItem(),
  }));

  const despues = await huellaDeLaMesa();
  assert.strictEqual(despues.pedidos, antes.pedidos, 'no quedo ningun pedido en la mesa');
  assert.strictEqual(despues.detalles, antes.detalles, 'ni sus detalles');
  assert.strictEqual(despues.historial, antes.historial, 'ni una linea de historial');
  // El stock se mueve por el libro: sin reserva de un detalle de esta mesa no
  // hay nada descontado. Se mira el libro de la mesa y no el stock del insumo,
  // que es global y lo pueden estar moviendo otras suites en este instante.
  assert.strictEqual(despues.movimientos, antes.movimientos, 'ni una reserva de inventario');
});

test('POST /pedidos con un usuario que existe: entra y deja su linea de historial', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const pedido = await crearConUsuarioReal();

  assert.strictEqual(pedido.estado, 'recibido');

  const { rows } = await sonda.query(
    `SELECT id_usuario, estado_nuevo FROM historial_estados
      WHERE id_pedido = $1 ORDER BY id_historial LIMIT 1`,
    [pedido.id_pedido]
  );
  assert.strictEqual(rows[0].id_usuario, usuarioReal.id_usuario);
  assert.strictEqual(rows[0].estado_nuevo, 'recibido');
});

test('PATCH /pedidos/:id/estado con el autor borrado: 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const fantasma = await idFantasma();
  const pedido = await crearConUsuarioReal();

  await assert.rejects(
    () => pedidosService.actualizarEstado(pedido.id_pedido, 'en_preparacion', null, fantasma),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y el pedido NO se movio: el estado es parte de la misma transaccion.
  const { rows } = await sonda.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [
    pedido.id_pedido,
  ]);
  assert.strictEqual(rows[0].estado, 'recibido', 'sigue donde estaba');
});

test('El tablero del KDS pasa por el mismo servicio, y traduce igual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const fantasma = await idFantasma();
  const pedido = await crearConUsuarioReal();

  await assert.rejects(
    () => kdsService.cambiarEstado(pedido.id_pedido, 'en_preparacion', null, fantasma),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      return true;
    }
  );
});

test('El cobro que liquida la cuenta tambien escribe historial, y traduce igual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const fantasma = await idFantasma();
  const pedido = await crearConUsuarioReal();
  // Solo un cobro que liquida Y con el pedido ENTREGADO escribe historial: es
  // la unica transicion legal hacia 'pagado'. Este pedido no se puede cancelar
  // despues; su reserva la cierra la limpieza con fn_cerrar_reserva_detalle.
  for (const estado of ['en_preparacion', 'listo', 'entregado']) {
    await pedidosService.actualizarEstado(pedido.id_pedido, estado, null, usuarioReal.id_usuario);
  }
  const { rows: saldo } = await sonda.query('SELECT obtener_saldo_pendiente($1) AS s', [
    pedido.id_pedido,
  ]);

  await assert.rejects(
    () => transaccionesService.registrarPago({
      id_pedido: pedido.id_pedido,
      metodo_pago: 'efectivo',
      monto: Number(saldo[0].s),
      estado: 'completada',
      id_usuario: fantasma,
    }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y el pago no quedo a medias: ni transaccion, ni pedido en 'pagado'.
  const { rows: transacciones } = await sonda.query(
    'SELECT count(*)::int AS n FROM transacciones WHERE id_pedido = $1',
    [pedido.id_pedido]
  );
  assert.strictEqual(transacciones[0].n, 0, 'la transaccion se deshizo con el resto');
  const { rows } = await sonda.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [
    pedido.id_pedido,
  ]);
  assert.strictEqual(rows[0].estado, 'entregado', 'el pedido sigue sin cobrar');
});
