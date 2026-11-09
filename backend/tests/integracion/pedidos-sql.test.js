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
const autorInexistente = require('../../src/services/autor-inexistente');

let sonda = null;
let hayBase = false;
let mesa = null;
let plato = null;
let usuarioReal = null;

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    const m = await sonda.query('SELECT id_mesa FROM mesas ORDER BY id_mesa LIMIT 1');
    // Un plato NO personalizable: uno del constructor exigiría elegir opciones
    // de cada paso y el pedido fallaría por otra razón (P0001).
    const p = await sonda.query(
      `SELECT id_plato FROM platos
        WHERE disponible AND stock_suficiente AND NOT personalizable
        ORDER BY id_plato LIMIT 1`
    );
    const u = await sonda.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1');
    mesa = m.rows[0] || null;
    plato = p.rows[0] || null;
    usuarioReal = u.rows[0] || null;
    hayBase = Boolean(mesa && plato && usuarioReal);
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  if (sonda) await sonda.end();
  await pool.end();
});

/** Un id de usuario que seguro no existe. */
async function idFantasma() {
  const { rows } = await sonda.query(
    'SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS inexistente FROM usuarios'
  );
  return Number(rows[0].inexistente);
}

/** Cuántas filas hay ahora mismo en una tabla, para comparar antes/después. */
async function cuantas(sql, params = []) {
  const { rows } = await sonda.query(sql, params);
  return Number(rows[0].n);
}

/** El stock de los insumos que gasta un plato, como un mapa id → cantidad. */
async function stockDe(idPlato) {
  const { rows } = await sonda.query(
    `SELECT i.id_insumo, i.stock_actual
       FROM insumos i
       JOIN recetas_plato r ON r.id_insumo = i.id_insumo
      WHERE r.id_plato = $1
      ORDER BY i.id_insumo`,
    [idPlato]
  );
  return new Map(rows.map((f) => [f.id_insumo, Number(f.stock_actual)]));
}

const unItem = () => [{ id_plato: plato.id_plato, cantidad: 1 }];

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
  const pedidosAntes = await cuantas('SELECT COUNT(*) AS n FROM pedidos WHERE id_mesa = $1', [
    mesa.id_mesa,
  ]);
  const detallesAntes = await cuantas('SELECT COUNT(*) AS n FROM detalles_pedido');
  const historialAntes = await cuantas('SELECT COUNT(*) AS n FROM historial_estados');
  const movimientosAntes = await cuantas('SELECT COUNT(*) AS n FROM movimientos_inventario');
  const stockAntes = await stockDe(plato.id_plato);

  await assert.rejects(() => pedidosService.crearConDetalles({
    id_mesa: mesa.id_mesa,
    id_usuario: fantasma,
    items: unItem(),
  }));

  assert.strictEqual(
    await cuantas('SELECT COUNT(*) AS n FROM pedidos WHERE id_mesa = $1', [mesa.id_mesa]),
    pedidosAntes,
    'no quedo ningun pedido'
  );
  assert.strictEqual(
    await cuantas('SELECT COUNT(*) AS n FROM detalles_pedido'),
    detallesAntes,
    'ni sus detalles'
  );
  assert.strictEqual(
    await cuantas('SELECT COUNT(*) AS n FROM historial_estados'),
    historialAntes,
    'ni una linea de historial'
  );
  assert.strictEqual(
    await cuantas('SELECT COUNT(*) AS n FROM movimientos_inventario'),
    movimientosAntes,
    'ni un movimiento de inventario'
  );

  const stockDespues = await stockDe(plato.id_plato);
  for (const [insumo, cantidad] of stockAntes) {
    assert.strictEqual(stockDespues.get(insumo), cantidad, `el insumo ${insumo} no se descuento`);
  }
});

test('POST /pedidos con un usuario que existe: entra y deja su linea de historial', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const pedido = await pedidosService.crearConDetalles({
    id_mesa: mesa.id_mesa,
    id_usuario: usuarioReal.id_usuario,
    items: unItem(),
  });

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
  const pedido = await pedidosService.crearConDetalles({
    id_mesa: mesa.id_mesa,
    id_usuario: usuarioReal.id_usuario,
    items: unItem(),
  });

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
  const pedido = await pedidosService.crearConDetalles({
    id_mesa: mesa.id_mesa,
    id_usuario: usuarioReal.id_usuario,
    items: unItem(),
  });

  await assert.rejects(
    () => kdsService.cambiarEstado(pedido.id_pedido, 'en_preparacion', null, fantasma),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      return true;
    }
  );
});

