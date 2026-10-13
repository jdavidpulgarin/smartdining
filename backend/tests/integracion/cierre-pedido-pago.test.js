const test = require('node:test');
const assert = require('node:assert');

/**
 * REGLA DE CIERRE (H-03): el pedido pasa a 'pagado' cuando esta entregado Y
 * totalmente pagado, en cualquiera de los dos ordenes.
 *
 * Esto NO se puede probar con un doble: lo que decide es la base. El trigger
 * tr_validar_transicion_estado es quien rechaza pasar a 'pagado' desde 'listo'
 * (y antes hacia perder el pago entero), y el trigger
 * tr_sincronizar_estado_pago_pedido del script 22 es quien mantiene
 * pedidos.estado_pago. Un fake-db contestaria lo que se le pida.
 *
 * Reproduce los dos casos medidos en la verificacion de H-03:
 *   2A. cobro total por CAJA de un pedido en 'listo' -> el pago se perdia (409
 *       del trigger y ROLLBACK de la transaccion completa).
 *   2B. cobro total por el CANAL INTERNO de un pedido en 'listo' -> el pago
 *       quedaba, pero el pedido no volvia nunca a 'pagado' y la mesa se quedaba
 *       ocupada con su QR vivo para siempre.
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const pedidosService = require('../../src/services/pedidos.service');
const transaccionesService = require('../../src/services/transacciones.service');

const PRECIO = 24000;

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

/**
 * Mesa ocupada con su token_qr y sesion abierta, y un pedido llevado hasta
 * `hasta` por la maquina de estados de verdad (pasando por cada transicion,
 * porque el trigger no deja saltarse ninguna).
 */
async function prepararPedido(hasta) {
  const mesa = (
    await pool.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr, sesion_iniciada_en)
       VALUES ($1, 4, 'h-03', 'ocupada', $2, NOW()) RETURNING id_mesa`,
      [9100 + Math.floor(Math.random() * 800), `qr-h03-${Date.now().toString(36)}`]
    )
  ).rows[0].id_mesa;

  const categoria = (await pool.query('SELECT id_categoria FROM categorias ORDER BY 1 LIMIT 1'))
    .rows[0].id_categoria;
  const plato = (
    await pool.query(
      `INSERT INTO platos (id_categoria, nombre, precio, disponible)
       VALUES ($1, 'Plato h-03', $2, TRUE) RETURNING id_plato`,
      [categoria, PRECIO]
    )
  ).rows[0].id_plato;

  const pedido = (
    await pool.query(
      `INSERT INTO pedidos (id_mesa, codigo_pedido, estado)
       VALUES ($1, $2, 'recibido') RETURNING id_pedido`,
      [mesa, `H03-${Date.now().toString(36).toUpperCase().slice(-9)}`]
    )
  ).rows[0].id_pedido;

  await pool.query(
    `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
     VALUES ($1, $2, 1, $3)`,
    [pedido, plato, PRECIO]
  );

  const camino = ['en_preparacion', 'listo', 'entregado'];
  for (const estado of camino.slice(0, camino.indexOf(hasta) + 1)) {
    await pool.query('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2', [estado, pedido]);
  }

  return { mesa, plato, pedido };
}

/** Los cuatro datos que se miden en cada caso. */
async function foto(idPedido) {
  const r = await pool.query(
    `SELECT p.estado, p.estado_pago, m.estado AS mesa_estado,
            (m.token_qr IS NOT NULL) AS tiene_token,
            (SELECT count(*)::int FROM transacciones t WHERE t.id_pedido = p.id_pedido) AS transacciones,
            COALESCE((SELECT SUM(t.monto) FROM transacciones t
                       WHERE t.id_pedido = p.id_pedido
                         AND t.estado_transaccion = 'completada'), 0) AS cobrado,
            obtener_saldo_pendiente(p.id_pedido) AS saldo
     FROM pedidos p JOIN mesas m ON m.id_mesa = p.id_mesa
     WHERE p.id_pedido = $1`,
    [idPedido]
  );
  return r.rows[0];
}

const resumir = (f) =>
  `estado=${f.estado} · estado_pago=${f.estado_pago} · mesa=${f.mesa_estado} · ` +
  `token_qr=${f.tiene_token ? 'presente' : 'NULL'} · transacciones=${f.transacciones} · ` +
  `cobrado=${Number(f.cobrado)} · saldo=${Number(f.saldo)}`;

/** Borra lo que creo la prueba, para no dejar basura en la base local. */
async function limpiar({ mesa, plato, pedido }) {
  for (const tabla of [
    'transacciones',
    'kds_alertas',
    'kds_metricas',
    'intentos_pago_fallidos',
    'historial_estados',
    'detalles_pedido',
  ]) {
    await pool.query(`DELETE FROM ${tabla} WHERE id_pedido = $1`, [pedido]);
  }
  await pool.query('DELETE FROM pedidos WHERE id_pedido = $1', [pedido]);
  await pool.query('DELETE FROM platos WHERE id_plato = $1', [plato]);
  await pool.query('DELETE FROM mesas WHERE id_mesa = $1', [mesa]);
}

// ---------------------------------------------------------------------------
// 2A: cobro por caja de un pedido que todavia no se entrego
// ---------------------------------------------------------------------------

test("H-03 caso 2A: cobrar en caja un pedido en 'listo' NO pierde el pago", async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedido('listo');
  try {
    const antes = await foto(datos.pedido);
    assert.strictEqual(antes.estado, 'listo');
    assert.strictEqual(antes.estado_pago, 'pendiente');

    const r = await transaccionesService.registrarPago({
      id_pedido: datos.pedido,
      monto: PRECIO,
      metodo_pago: 'efectivo',
      referencia_externa: `h03-2a-${Date.now()}`,
      id_usuario: null,
    });

    const despues = await foto(datos.pedido);
    console.log('\n  H-03 2A (caja, pedido en listo):', resumir(despues));

    // Lo que fallaba: el trigger abortaba el UPDATE a 'pagado' y el ROLLBACK se
    // llevaba tambien el INSERT de la transaccion.
    assert.strictEqual(despues.transacciones, 1, 'el pago quedo guardado');
    assert.strictEqual(Number(despues.cobrado), PRECIO);
    assert.strictEqual(Number(despues.saldo), 0, 'la cuenta queda cubierta');
    assert.strictEqual(despues.estado_pago, 'pagado', 'lo pone el trigger del script 22');

    // Y el estado de cocina no se toca: la comida no ha salido.
    assert.strictEqual(despues.estado, 'listo');
    assert.strictEqual(despues.mesa_estado, 'ocupada');
    assert.strictEqual(despues.tiene_token, true, 'el comensal sigue en su sesion');

    assert.strictEqual(r.pedidoLiquidado, true, 'saldo en cero');
    assert.strictEqual(r.pedidoCerrado, false, 'pero el pedido no cambio de estado');
    assert.strictEqual(r.mesaLiberada, false);
  } finally {
    await limpiar(datos);
  }
});

test('H-03 caso 2A: al entregarlo despues, el pedido se cierra y la mesa queda libre', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedido('listo');
  try {
    await transaccionesService.registrarPago({
      id_pedido: datos.pedido,
      monto: PRECIO,
      metodo_pago: 'efectivo',
      referencia_externa: `h03-2a-cierre-${Date.now()}`,
      id_usuario: null,
    });

    // El mesero entrega: aqui se cierra el circulo.
    const pedido = await pedidosService.actualizarEstado(datos.pedido, 'entregado', null, null);

    const despues = await foto(datos.pedido);
    console.log('  H-03 2A tras entregar:    ', resumir(despues));

    assert.strictEqual(pedido.estado, 'pagado', 'se pidio entregado y termino cerrado');
    assert.strictEqual(pedido.estado_anterior, 'listo');
    assert.strictEqual(pedido.cerradoPorPago, true);
    assert.strictEqual(pedido.mesaLiberada, true);

    assert.strictEqual(despues.estado, 'pagado');
    assert.strictEqual(despues.estado_pago, 'pagado');
    assert.strictEqual(despues.mesa_estado, 'disponible', 'la mesa vuelve a servir');
    assert.strictEqual(despues.tiene_token, false, 'y su QR deja de valer');
    assert.strictEqual(Number(despues.cobrado), PRECIO, 'sin cobrar de mas');
    assert.strictEqual(despues.transacciones, 1);

    // La auditoria tiene los dos saltos, no solo el ultimo.
    const historial = (
      await pool.query(
        `SELECT estado_anterior, estado_nuevo FROM historial_estados
         WHERE id_pedido = $1 ORDER BY id_historial ASC`,
        [datos.pedido]
      )
    ).rows;
    const ultimos = historial.slice(-2).map((h) => `${h.estado_anterior}->${h.estado_nuevo}`);
    assert.deepStrictEqual(ultimos, ['listo->entregado', 'entregado->pagado']);
  } finally {
    await limpiar(datos);
  }
});

// ---------------------------------------------------------------------------
// 2B: pago en linea de un pedido que todavia no se entrego
// ---------------------------------------------------------------------------

test('H-03 caso 2B: el pago en linea deja de secuestrar la mesa', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedido('listo');
  try {
    const pago = await transaccionesService.registrarPagoInterno({
      referencia_externa: `h03-2b-${Date.now()}`,
      id_mesa: datos.mesa,
      monto_centavos: PRECIO * 100,
      metodo_pago: 'online',
      comensal: null,
    });
    assert.strictEqual(pago.saldo_restante_centavos, 0, 'la mesa queda sin saldo');
    assert.strictEqual(pago.mesa_liberada, false, 'todavia no: falta entregar');

    const pagada = await foto(datos.pedido);
    console.log('\n  H-03 2B (canal interno):  ', resumir(pagada));
    assert.strictEqual(pagada.estado, 'listo');
    assert.strictEqual(pagada.estado_pago, 'pagado');
    assert.strictEqual(pagada.mesa_estado, 'ocupada');

    // Lo que fallaba: ni liberar a mano ni entregar sacaban la mesa de aqui.
    const aMano = await require('../../src/services/mesas.service').liberarSesion(datos.mesa);
    assert.strictEqual(aMano.pedidosAbiertos, 1, 'con comida sin entregar la mesa no se suelta');

    const pedido = await pedidosService.actualizarEstado(datos.pedido, 'entregado', null, null);

    const despues = await foto(datos.pedido);
    console.log('  H-03 2B tras entregar:    ', resumir(despues));

    assert.strictEqual(pedido.cerradoPorPago, true);
    assert.strictEqual(despues.estado, 'pagado', 'esto es lo que antes no pasaba nunca');
    assert.strictEqual(despues.mesa_estado, 'disponible');
    assert.strictEqual(despues.tiene_token, false);
    assert.strictEqual(Number(despues.saldo), 0);
  } finally {
    await limpiar(datos);
  }
});

// ---------------------------------------------------------------------------
// Lo que NO debe cambiar
// ---------------------------------------------------------------------------

test('H-03: entregar un pedido sin pagar lo deja en entregado y la mesa ocupada', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedido('listo');
  try {
    const pedido = await pedidosService.actualizarEstado(datos.pedido, 'entregado', null, null);
    const despues = await foto(datos.pedido);

    assert.strictEqual(pedido.estado, 'entregado', 'falta cobrar: lo cerrara la caja');
    assert.strictEqual(pedido.cerradoPorPago, false);
    assert.strictEqual(despues.estado, 'entregado');
    assert.strictEqual(despues.estado_pago, 'pendiente');
    assert.strictEqual(despues.mesa_estado, 'ocupada');
    assert.strictEqual(despues.tiene_token, true);
  } finally {
    await limpiar(datos);
  }
});

test('H-03: un abono parcial no cierra el pedido al entregarlo', async (t) => {
  if (!hayBase) {
    t.skip('sin PostgreSQL disponible: prueba de integracion saltada');
    return;
  }

  const datos = await prepararPedido('listo');
  try {
    await transaccionesService.registrarPago({
      id_pedido: datos.pedido,
      monto: PRECIO / 2,
      metodo_pago: 'efectivo',
      referencia_externa: `h03-abono-${Date.now()}`,
      id_usuario: null,
    });

    const abonado = await foto(datos.pedido);
    assert.strictEqual(abonado.estado_pago, 'parcial');

    const pedido = await pedidosService.actualizarEstado(datos.pedido, 'entregado', null, null);
    const despues = await foto(datos.pedido);

    assert.strictEqual(pedido.estado, 'entregado', 'queda la mitad por cobrar');
    assert.strictEqual(pedido.cerradoPorPago, false);
    assert.strictEqual(despues.mesa_estado, 'ocupada', 'nadie se va sin pagar');
    assert.strictEqual(Number(despues.saldo), PRECIO / 2);
  } finally {
    await limpiar(datos);
  }
});
