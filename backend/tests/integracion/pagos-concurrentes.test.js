const test = require('node:test');
const assert = require('node:assert');

/**
 * H-01: sobrecobro por pagos simultáneos. Prueba de CONCURRENCIA REAL.
 *
 * No usa dobles: necesita PostgreSQL de verdad, porque lo que se prueba es el
 * bloqueo de filas (SELECT ... FOR UPDATE) y el trigger
 * tr_validar_transaccion_financiera. Un fake-db serializa las consultas por
 * construcción y no podría fallar nunca.
 *
 * Por eso vive en tests/integracion/ y se SALTA sola si no hay base: el
 * `npm test` de la suite normal no la ejecuta.
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const transaccionesService = require('../../src/services/transacciones.service');

const PRECIO_PEDIDO = 34000;
const MONTO_POR_PAGO = 20000;
const PAGOS_SIMULTANEOS = 5;
const REPETICIONES = 10;

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

/** Crea una mesa, un plato y un pedido 'entregado' por PRECIO_PEDIDO. */
async function prepararPedidoEntregado() {
  const mesa = (
    await pool.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion, estado)
       VALUES ($1, 4, 'h-01', 'ocupada') RETURNING id_mesa`,
      [9000 + Math.floor(Math.random() * 900)]
    )
  ).rows[0].id_mesa;

  const categoria = (await pool.query('SELECT id_categoria FROM categorias ORDER BY 1 LIMIT 1'))
    .rows[0].id_categoria;
  const plato = (
    await pool.query(
      `INSERT INTO platos (id_categoria, nombre, precio, disponible)
       VALUES ($1, 'Plato h-01', $2, TRUE) RETURNING id_plato`,
      [categoria, PRECIO_PEDIDO]
    )
  ).rows[0].id_plato;

  const pedido = (
    await pool.query(
      `INSERT INTO pedidos (id_mesa, codigo_pedido, estado)
       VALUES ($1, $2, 'recibido') RETURNING id_pedido`,
      [mesa, `H01-${Date.now().toString(36).toUpperCase().slice(-9)}`]
    )
  ).rows[0].id_pedido;

  await pool.query(
    `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
     VALUES ($1, $2, 1, $3)`,
    [pedido, plato, PRECIO_PEDIDO]
  );

  // Hasta 'entregado', que es el único estado desde el que se puede cobrar.
  for (const estado of ['en_preparacion', 'listo', 'entregado']) {
    await pool.query('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2', [estado, pedido]);
  }

  return { mesa, plato, pedido };
}

/** Borra lo que creó la prueba, para no dejar basura en la base local. */
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

test('H-01: cinco pagos simultaneos del mismo pedido no lo sobrecobran', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const resumen = [];

  for (let vuelta = 1; vuelta <= REPETICIONES; vuelta++) {
    const datos = await prepararPedidoEntregado();
    try {
      // Los cinco pagos salen a la vez, cada uno con su propia conexión del pool.
      const resultados = await Promise.allSettled(
        Array.from({ length: PAGOS_SIMULTANEOS }, (_, i) =>
          transaccionesService.registrarPago({
            id_pedido: datos.pedido,
            monto: MONTO_POR_PAGO,
            metodo_pago: 'efectivo',
            referencia_externa: `h01-v${vuelta}-p${i}`,
            id_usuario: null,
          })
        )
      );

      const aceptados = resultados.filter((r) => r.status === 'fulfilled').length;
      const rechazados = resultados.length - aceptados;

      // Los rechazos deben ser del trigger (regla de negocio), no errores raros.
      const codigos = resultados
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason?.code || r.reason?.status || 'desconocido');

      const cobrado = Number(
        (
          await pool.query(
            `SELECT COALESCE(SUM(monto), 0) AS total FROM transacciones
             WHERE id_pedido = $1 AND estado_transaccion = 'completada'`,
            [datos.pedido]
          )
        ).rows[0].total
      );

      const filas = Number(
        (
          await pool.query('SELECT count(*)::int AS n FROM transacciones WHERE id_pedido = $1', [
            datos.pedido,
          ])
        ).rows[0].n
      );

      resumen.push({ vuelta, aceptados, rechazados, cobrado, filas, codigos });

      assert.strictEqual(
        aceptados,
        1,
        `vuelta ${vuelta}: exactamente un pago debe entrar (entraron ${aceptados})`
      );
      assert.strictEqual(rechazados, PAGOS_SIMULTANEOS - 1, `vuelta ${vuelta}: el resto se rechaza`);
      assert.ok(
        cobrado <= PRECIO_PEDIDO,
        `vuelta ${vuelta}: lo cobrado (${cobrado}) nunca puede pasar del total (${PRECIO_PEDIDO})`
      );
      assert.strictEqual(cobrado, MONTO_POR_PAGO, `vuelta ${vuelta}: solo el pago que entró`);
      assert.ok(
        codigos.every((c) => c === 'P0001'),
        `vuelta ${vuelta}: los rechazos son del trigger, no fallos inesperados (${codigos.join(', ')})`
      );
    } finally {
      await limpiar(datos);
    }
  }

  console.log('\n  H-01 · 5 pagos de %d sobre un pedido de %d, %d vueltas:', MONTO_POR_PAGO, PRECIO_PEDIDO, REPETICIONES);
  for (const r of resumen) {
    console.log(
      `    vuelta ${String(r.vuelta).padStart(2)}: ${r.aceptados} x 201 · ${r.rechazados} x 409 · cobrado ${r.cobrado} · filas ${r.filas}`
    );
  }
  const maximo = Math.max(...resumen.map((r) => r.cobrado));
  console.log(`    maximo cobrado en cualquier vuelta: ${maximo} (tope ${PRECIO_PEDIDO})`);
});

test('H-01: dos abonos simultaneos que caben NO se rechazan', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedidoEntregado();
  try {
    // 17.000 + 17.000 = 34.000: caben exactos. El bloqueo serializa, no rechaza
    // lo que es legal; si rechazara, el arreglo de H-01 estaría de más.
    const resultados = await Promise.allSettled(
      [0, 1].map((i) =>
        transaccionesService.registrarPago({
          id_pedido: datos.pedido,
          monto: PRECIO_PEDIDO / 2,
          metodo_pago: 'efectivo',
          referencia_externa: `h01-mitades-${i}`,
          id_usuario: null,
        })
      )
    );

    const aceptados = resultados.filter((r) => r.status === 'fulfilled').length;
    const cobrado = Number(
      (
        await pool.query(
          `SELECT COALESCE(SUM(monto), 0) AS total FROM transacciones
           WHERE id_pedido = $1 AND estado_transaccion = 'completada'`,
          [datos.pedido]
        )
      ).rows[0].total
    );

    assert.strictEqual(aceptados, 2, 'los dos abonos caben');
    assert.strictEqual(cobrado, PRECIO_PEDIDO, 'y suman exactamente el total');

    const estado = (
      await pool.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [datos.pedido])
    ).rows[0].estado;
    assert.strictEqual(estado, 'pagado', 'el segundo abono liquida el pedido');

    console.log(`\n  H-01 · dos abonos de ${PRECIO_PEDIDO / 2}: ${aceptados} x 201 · cobrado ${cobrado} · pedido ${estado}`);
  } finally {
    await limpiar(datos);
  }
});
