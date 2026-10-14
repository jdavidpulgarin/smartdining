const test = require('node:test');
const assert = require('node:assert');

/**
 * ¿Puede H-01 provocar un interbloqueo?
 *
 * Los caminos de pago bloquean MESA y después PEDIDO. En cambio
 * pedidos.service.actualizarEstado hace el UPDATE del pedido (que toma el
 * bloqueo de esa fila) y solo después, si el estado es de cierre
 * ('pagado'/'cancelado'), llama a liberarSiNoQuedanPedidosAbiertos, que bloquea
 * la mesa: PEDIDO y después MESA.
 *
 * Dos órdenes opuestos sobre las mismas dos filas es el patrón clásico de
 * interbloqueo (ABBA). Esta prueba lanza en paralelo un cobro y un cambio de
 * estado del MISMO pedido para ver si PostgreSQL detecta deadlock (40P01).
 *
 * Necesita base real: se salta sola si no hay.
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const transaccionesService = require('../../src/services/transacciones.service');
const pedidosService = require('../../src/services/pedidos.service');

const PRECIO = 34000;
const REPETICIONES = 20;
const SQLSTATE_DEADLOCK = '40P01';

let pool = null;
let hayBase = false;

test.before(async () => {
  try {
    pool = new Pool({ connectionTimeoutMillis: 2000 });
    await pool.query('SELECT 1');
    hayBase = true;
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  if (pool) await pool.end();
});

async function prepararPedidoEntregado() {
  const mesa = (
    await pool.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion, estado)
       VALUES ($1, 4, 'deadlock', 'ocupada') RETURNING id_mesa`,
      [9500 + Math.floor(Math.random() * 400)]
    )
  ).rows[0].id_mesa;

  const categoria = (await pool.query('SELECT id_categoria FROM categorias ORDER BY 1 LIMIT 1'))
    .rows[0].id_categoria;
  const plato = (
    await pool.query(
      `INSERT INTO platos (id_categoria, nombre, precio, disponible)
       VALUES ($1, 'Plato deadlock', $2, TRUE) RETURNING id_plato`,
      [categoria, PRECIO]
    )
  ).rows[0].id_plato;

  const pedido = (
    await pool.query(
      `INSERT INTO pedidos (id_mesa, codigo_pedido, estado)
       VALUES ($1, $2, 'recibido') RETURNING id_pedido`,
      [mesa, `DL-${Date.now().toString(36).toUpperCase().slice(-10)}`]
    )
  ).rows[0].id_pedido;

  await pool.query(
    `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
     VALUES ($1, $2, 1, $3)`,
    [pedido, plato, PRECIO]
  );
  for (const estado of ['en_preparacion', 'listo', 'entregado']) {
    await pool.query('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2', [estado, pedido]);
  }
  return { mesa, plato, pedido };
}

async function limpiar({ mesa, plato, pedido }) {
  await pool.query('DELETE FROM transacciones WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM kds_alertas WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM kds_metricas WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM intentos_pago_fallidos WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM historial_estados WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM detalles_pedido WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM pedidos WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM platos WHERE id_plato = $1', [plato]);
  await pool.query('DELETE FROM mesas WHERE id_mesa = $1', [mesa]);
}

/** Códigos de error de cada rechazo, para distinguir un deadlock de un 409. */
const codigosDe = (resultados) =>
  resultados
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.code || r.reason?.status || r.reason?.message || 'desconocido');

test('pago y cambio de estado en paralelo: ¿hay deadlock (40P01)?', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const vueltas = [];
  let deadlocks = 0;

  for (let vuelta = 1; vuelta <= REPETICIONES; vuelta++) {
    const datos = await prepararPedidoEntregado();
    try {
      // A: cobro completo -> bloquea MESA y despues PEDIDO, y al liquidar
      //    vuelve a tocar la mesa.
      // B: PATCH del estado a 'pagado' -> UPDATE del PEDIDO y despues MESA
      //    (liberarSiNoQuedanPedidosAbiertos).
      const resultados = await Promise.allSettled([
        transaccionesService.registrarPago({
          id_pedido: datos.pedido,
          monto: PRECIO,
          metodo_pago: 'efectivo',
          referencia_externa: `dl-pago-v${vuelta}`,
          id_usuario: null,
        }),
        pedidosService.actualizarEstado(datos.pedido, 'pagado', 'prueba de deadlock', null),
      ]);

      const codigos = codigosDe(resultados);
      const hayDeadlock = codigos.includes(SQLSTATE_DEADLOCK);
      if (hayDeadlock) deadlocks += 1;

      vueltas.push({
        vuelta,
        aceptados: resultados.filter((r) => r.status === 'fulfilled').length,
        codigos,
        deadlock: hayDeadlock,
      });
    } finally {
      await limpiar(datos);
    }
  }

  console.log('\n  Pago + cambio de estado en paralelo, %d vueltas:', REPETICIONES);
  for (const v of vueltas) {
    console.log(
      `    vuelta ${String(v.vuelta).padStart(2)}: ${v.aceptados} ok · rechazos [${v.codigos.join(', ') || '-'}]${v.deadlock ? '  <-- DEADLOCK' : ''}`
    );
  }
  console.log(`    deadlocks detectados: ${deadlocks} de ${REPETICIONES}`);

  // La prueba no falla por encontrar deadlock: su trabajo es MEDIRLO y dejar
  // constancia. Lo que sí se exige es que nunca se sobrecobre.
  assert.ok(deadlocks >= 0);
});

test('ni con deadlock se sobrecobra el pedido', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  for (let vuelta = 1; vuelta <= 5; vuelta++) {
    const datos = await prepararPedidoEntregado();
    try {
      await Promise.allSettled([
        transaccionesService.registrarPago({
          id_pedido: datos.pedido,
          monto: PRECIO,
          metodo_pago: 'efectivo',
          referencia_externa: `dl-seguro-v${vuelta}`,
          id_usuario: null,
        }),
        pedidosService.actualizarEstado(datos.pedido, 'pagado', 'prueba', null),
      ]);

      const cobrado = Number(
        (
          await pool.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM transacciones
             WHERE id_pedido = $1 AND estado_transaccion = 'completada'`,
            [datos.pedido]
          )
        ).rows[0].total
      );
      assert.ok(cobrado <= PRECIO, `vuelta ${vuelta}: cobrado ${cobrado} sobre un total de ${PRECIO}`);
    } finally {
      await limpiar(datos);
    }
  }
});
