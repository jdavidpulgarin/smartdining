const crypto = require('crypto');
const pool = require('../config/db');

/**
 * Dominio del CHECK de pedidos.estado. Se usa solo para validar que el body
 * traiga un estado existente (trabajo del backend); QUE transiciones son
 * legales lo decide el trigger tr_validar_transicion_estado contra la tabla
 * transiciones_validas, no este archivo.
 */
const ESTADOS_VALIDOS = ['recibido', 'en_preparacion', 'listo', 'entregado', 'pagado', 'cancelado'];

const MAX_INTENTOS_CODIGO = 5;

/**
 * codigo_pedido es VARCHAR(16) UNIQUE en el schema de Jarrison:
 * 'PED-' (4) + AAMMDD (6) + '-' (1) + 5 hex = 16 caracteres exactos.
 */
function generarCodigoPedido(fecha = new Date()) {
  const dia = fecha.toISOString().slice(2, 10).replace(/-/g, '');
  const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `PED-${dia}-${aleatorio}`;
}

/**
 * detalles_pedido solo tiene notas_especiales para el texto libre del ítem, así
 * que ahí va el apodo del comensal que lo agregó al carrito colaborativo, junto
 * con su nota si la escribió: "Ana: sin cebolla".
 */
function componerNotasEspeciales(apodo, notas) {
  const partes = [apodo, notas].map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
  if (partes.length === 0) return null;
  return partes.join(': ');
}

/**
 * Crea un pedido y sus detalles en una sola transacción.
 *
 * La base de datos es la fuente de verdad y aquí NO se replica su lógica:
 * - precio_unitario se congela leyendo platos.precio en el propio INSERT, así el
 *   precio histórico lo fija la base y nunca el body.
 * - subtotal lo calcula el trigger tr_validar_detalle_pedido.
 * - pedidos.total lo recalcula el trigger tr_actualizar_total_pedido, por eso el
 *   pedido se vuelve a leer al final en vez de sumar nada en JavaScript.
 * - que el plato exista y esté disponible lo valida tr_validar_disponibilidad_plato
 *   (responde 409 con su mensaje vía el manejador central de errores).
 *
 * El pedido pertenece a la mesa: id_usuario solo alimenta la auditoría de
 * historial_estados y va null cuando lo crea un comensal.
 */
async function crearConDetalles({ id_mesa, id_usuario = null, items, notas_generales = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // codigo_pedido es único: si choca con uno existente se reintenta con otro
    // sin abortar la transacción completa.
    let pedido = null;
    for (let intento = 0; intento < MAX_INTENTOS_CODIGO && !pedido; intento++) {
      await client.query('SAVEPOINT intento_codigo');
      try {
        const pedidoResult = await client.query(
          `INSERT INTO pedidos (id_mesa, codigo_pedido, notas_generales)
           VALUES ($1, $2, $3) RETURNING *`,
          [id_mesa, generarCodigoPedido(), notas_generales]
        );
        pedido = pedidoResult.rows[0];
      } catch (err) {
        if (err.code !== '23505') throw err;
        await client.query('ROLLBACK TO SAVEPOINT intento_codigo');
      }
    }
    if (!pedido) {
      throw { status: 500, message: 'No se pudo generar un codigo_pedido único' };
    }

    for (const item of items) {
      await client.query(
        `INSERT INTO detalles_pedido
          (id_pedido, id_plato, cantidad, precio_unitario, notas_especiales)
         VALUES ($1, $2, $3, (SELECT precio FROM platos WHERE id_plato = $2), $4)`,
        [
          pedido.id_pedido,
          item.id_plato,
          item.cantidad,
          componerNotasEspeciales(item.apodo, item.notas),
        ]
      );
    }

    await client.query(
      `INSERT INTO historial_estados
        (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
       VALUES ($1, $2, NULL, 'recibido', 'Pedido creado')`,
      [pedido.id_pedido, id_usuario]
    );

    // El total y los subtotales los dejaron los triggers: se releen, no se calculan.
    const conTotal = await client.query('SELECT * FROM pedidos WHERE id_pedido = $1', [
      pedido.id_pedido,
    ]);

    await client.query('COMMIT');
    return conTotal.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listarActivos() {
  const result = await pool.query(
    `SELECT * FROM pedidos WHERE estado IN ('recibido', 'en_preparacion') ORDER BY creado_en ASC`
  );
  return result.rows;
}

async function obtenerConDetalles(id) {
  const pedido = await pool.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id]);
  if (pedido.rows.length === 0) return null;
  const detalles = await pool.query(
    `SELECT dp.*, pl.nombre AS plato_nombre
     FROM detalles_pedido dp
     JOIN platos pl ON pl.id_plato = dp.id_plato
     WHERE dp.id_pedido = $1
     ORDER BY dp.id_detalle ASC`,
    [id]
  );
  return { ...pedido.rows[0], detalles: detalles.rows };
}

/**
 * Cambia el estado del pedido y lo registra en historial_estados.
 *
 * No valida la transición: si no está en transiciones_validas, el trigger
 * tr_validar_transicion_estado aborta el UPDATE con un RAISE EXCEPTION y el
 * manejador central lo devuelve como 409. actualizado_en también lo pone ese
 * trigger. id_usuario va null si el cambio lo hizo un comensal.
 */
async function actualizarEstado(id, estado, observaciones, id_usuario = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id]);
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const estadoAnterior = actual.rows[0].estado;

    const result = await client.query(
      'UPDATE pedidos SET estado = $1 WHERE id_pedido = $2 RETURNING *',
      [estado, id]
    );

    await client.query(
      `INSERT INTO historial_estados
        (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, id_usuario, estadoAnterior, estado, observaciones || null]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Pedidos de una mesa — reemplaza el viejo historial por cliente. */
async function listarPorMesa(idMesa) {
  const result = await pool.query(
    'SELECT * FROM pedidos WHERE id_mesa = $1 ORDER BY creado_en DESC',
    [idMesa]
  );
  return result.rows;
}

module.exports = {
  ESTADOS_VALIDOS,
  generarCodigoPedido,
  componerNotasEspeciales,
  crearConDetalles,
  listarActivos,
  obtenerConDetalles,
  actualizarEstado,
  listarPorMesa,
};
