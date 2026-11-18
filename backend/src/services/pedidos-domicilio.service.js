const pool = require('../config/db');
const pedidosService = require('./pedidos.service');

/**
 * D-20b: pedidos PARA LLEVAR y A DOMICILIO desde la app, con pago anticipado
 * (docs/api-spec.md, "D-20b"). Sobre el script 36: el pedido nace en
 * 'por_pagar' y solo la base lo mueve (registrar_pago_anticipado,
 * cancelar_pedido_por_pagar y cancelar_por_pagar_vencidos, las tres bloquean el
 * pedido: por_pagar -> recibido y por_pagar -> cancelado nunca pasan los dos).
 *
 * ORDEN DE BLOQUEOS, el de todos los caminos: pedidos -> pedidos_domicilio ->
 * detalles_pedido (crearConDetalles inserta en ese orden; las funciones de la
 * base bloquean el pedido primero).
 */

const CANALES = Object.freeze(['para_llevar', 'domicilio']);
const MAX_MIOS = 50;
const MONEDA = 'COP';

/**
 * La referencia del cobro de un pedido: SIEMPRE la misma para ese pedido (una
 * sola intención por pedido, sin tocar la base): `SD-P-<id_pedido>-<los 5
 * caracteres aleatorios de codigo_pedido>`.
 */
function referenciaDelPedido(idPedido, codigoPedido) {
  return `SD-P-${idPedido}-${String(codigoPedido).slice(-5)}`;
}

/** ¿Es una referencia de ESE pedido? (`SD-P-<id>-` y algo más, sin espacios). */
function esReferenciaDelPedido(referencia, idPedido) {
  const prefijo = `SD-P-${idPedido}-`;
  return typeof referencia === 'string' && referencia.startsWith(prefijo)
    && referencia.length > prefijo.length && /^[A-Za-z0-9-]+$/.test(referencia);
}

/**
 * Los pedidos de la app tal como salen en la API. `vence_en` solo mientras
 * está en 'por_pagar' (la base lo calcula con minutos_pago_anticipado).
 */
const SQL_VISTA = `
  SELECT p.id_pedido, p.codigo_pedido, p.canal, p.estado, p.total, p.creado_en, p.id_cliente,
         CASE WHEN p.estado = 'por_pagar'
              THEN p.creado_en + make_interval(mins => fn_minutos_pago_anticipado())
         END AS vence_en,
         d.costo_envio, d.direccion_texto, d.barrio, d.estado_entrega, z.nombre AS zona
    FROM pedidos p
    LEFT JOIN pedidos_domicilio d ON d.id_pedido = p.id_pedido
    LEFT JOIN zonas_envio z ON z.id_zona = d.id_zona`;

/** Uno, por id. */
const SQL_VISTA_POR_ID = `${SQL_VISTA}
   WHERE p.id_pedido = $1::int`;

/** Uno de la app de ESE cliente (GET /pedidos-domicilio/:id). */
const SQL_VISTA_DEL_CLIENTE = `${SQL_VISTA}
   WHERE p.id_pedido = $1::int AND p.id_cliente = $2::int AND p.canal <> 'mesa'`;

/** Los de la app de un cliente, del más nuevo al más viejo (tope MAX_MIOS). */
const SQL_VISTA_MIOS = `${SQL_VISTA}
   WHERE p.id_cliente = $1::int AND p.canal <> 'mesa'
   ORDER BY p.creado_en DESC, p.id_pedido DESC
   LIMIT ${MAX_MIOS}`;

async function vistas(sql, valores) {
  const { rows } = await pool.query(sql, valores);
  if (rows.length === 0) return [];
  const detalles = await pedidosService.detallesDePedidos(rows.map((r) => r.id_pedido));
  const porPedido = new Map(rows.map((r) => [r.id_pedido, []]));
  for (const d of detalles) if (porPedido.has(d.id_pedido)) porPedido.get(d.id_pedido).push(d);
  return rows.map((r) => ({
    id_pedido: r.id_pedido,
    codigo_pedido: r.codigo_pedido,
    canal: r.canal,
    estado: r.estado,
    total: Number(r.total),
    costo_envio: r.costo_envio === null || r.costo_envio === undefined ? 0 : Number(r.costo_envio),
    vence_en: r.vence_en,
    creado_en: r.creado_en,
    entrega: r.canal === 'domicilio'
      ? { direccion: r.direccion_texto, barrio: r.barrio, zona: r.zona, estado_entrega: r.estado_entrega }
      : null,
    items: porPedido.get(r.id_pedido),
  }));
}

async function vistaDe(idPedido) {
  const [p] = await vistas(SQL_VISTA_POR_ID, [idPedido]);
  return p || null;
}

/**
 * La entrega de un domicilio: la dirección del cliente (si es suya), su zona
 * con cotizar_zona (la base decide la cobertura) y el teléfono de contacto: el
 * que mandó la app o, si no, el del perfil del cliente (ajuste de Juan).
 *
 * @returns {Promise<{noEncontrada: true} | {fueraDeCobertura: true} | {telefonoRequerido: true}
 *   | {domicilio: object}>}
 */
async function prepararEntrega(idCliente, idDireccion, telefonoContacto = null) {
  const { rows } = await pool.query(
    `SELECT d.id_direccion, d.direccion, d.barrio, d.referencia, d.lat, d.lng, c.telefono,
            z.id_zona, z.costo_envio
       FROM direcciones d
       JOIN clientes c ON c.id_cliente = d.id_cliente
       LEFT JOIN LATERAL cotizar_zona(d.barrio::text) z ON TRUE
      WHERE d.id_direccion = $1::int AND d.id_cliente = $2::int`,
    [idDireccion, idCliente]
  );
  const f = rows[0];
  if (!f) return { noEncontrada: true };
  if (f.id_zona === null || f.id_zona === undefined) return { fueraDeCobertura: true };
  const telefono = telefonoContacto || f.telefono || null;
  if (!telefono) return { telefonoRequerido: true };
  return {
    domicilio: {
      id_direccion: f.id_direccion,
      direccion: f.direccion,
      barrio: f.barrio,
      referencia: f.referencia,
      lat: f.lat,
      lng: f.lng,
      telefono_contacto: telefono,
      id_zona: f.id_zona,
      costo_envio: f.costo_envio,
    },
  };
}

/**
 * POST /api/v1/pedidos-domicilio. Los ítems llegan ya validados (las mismas
 * reglas que POST /pedidos). El pedido nace en 'por_pagar'. Si el cliente ya
 * tiene uno en 'por_pagar' sin vencer, no se crea otro: `pendiente` con ese.
 *
 * @returns {Promise<{noEncontrada: true} | {fueraDeCobertura: true} | {telefonoRequerido: true}
 *   | {pendiente: object} | {pedido: object}>}
 */
async function crear({ idCliente, canal, idDireccion = null, telefonoContacto = null, items, notasGenerales = null }) {
  let domicilio = null;
  if (canal === 'domicilio') {
    const entrega = await prepararEntrega(idCliente, idDireccion, telefonoContacto);
    if (!entrega.domicilio) return entrega;
    domicilio = entrega.domicilio;
  }
  const creado = await pedidosService.crearConDetalles({
    id_mesa: null,
    id_usuario: null,
    items,
    notas_generales: notasGenerales,
    anticipado: { canal, id_cliente: idCliente, domicilio },
  });
  if (creado.pendiente) return { pendiente: await vistaDe(creado.pendiente) };
  return { pedido: await vistaDe(creado.id_pedido) };
}

/** GET /api/v1/pedidos-domicilio/:id: uno de la app de ESE cliente, o null. */
async function obtener(idPedido, idCliente) {
  const [p] = await vistas(SQL_VISTA_DEL_CLIENTE, [idPedido, idCliente]);
  return p || null;
}

/** GET /api/v1/pedidos-domicilio/mios: los del cliente, del más nuevo al más viejo. */
async function listarMios(idCliente) {
  return vistas(SQL_VISTA_MIOS, [idCliente]);
}

/** El pedido de la app de ESE cliente (sin bloquear), o null. */
async function pedidoDelCliente(idPedido, idCliente) {
  const { rows } = await pool.query(
    `SELECT id_pedido, estado, canal FROM pedidos
      WHERE id_pedido = $1::int AND id_cliente = $2::int AND canal <> 'mesa'`,
    [idPedido, idCliente]
  );
  return rows[0] || null;
}

/**
 * POST /api/v1/pedidos-domicilio/:id/cancelar: solo en 'por_pagar', con
 * cancelar_pedido_por_pagar (bloquea el pedido; misma guarda que el pago y el
 * vencimiento). El stock vuelve por el trigger del script 27.
 *
 * @returns {Promise<{noExiste: true} | {yaCancelado: true} | {pagado: true, estado: string} | {pedido: object}>}
 */
async function cancelar(idPedido, idCliente) {
  if (!(await pedidoDelCliente(idPedido, idCliente))) return { noExiste: true };
  const { rows } = await pool.query('SELECT cancelar_pedido_por_pagar($1::int) AS ok', [idPedido]);
  if (rows[0].ok) return { pedido: await vistaDe(idPedido) };
  // Ya no estaba en por_pagar: se lee cómo quedó (la función ya soltó el bloqueo).
  const ahora = await pedidoDelCliente(idPedido, idCliente);
  if (ahora && ahora.estado === 'cancelado') return { yaCancelado: true };
  return { pagado: true, estado: ahora ? ahora.estado : null };
}

/**
 * (a) GET /api/pedidos-domicilio/:id/cobro/interno?id_cliente=N: lo que el
 * socket-server necesita para crear la intención de Wompi. Solo lee.
 *
 * @returns {Promise<{noExiste: true} | {noPorPagar: true, estado: string} | {vencido: true} | {cobro: object}>}
 */
async function cobroInterno(idPedido, idCliente) {
  const { rows } = await pool.query(
    `SELECT p.id_pedido, p.id_cliente, p.codigo_pedido, p.estado,
            ROUND(p.total * 100)::bigint AS monto_centavos,
            v.vence_en, (now() >= v.vence_en) AS vencido
       FROM pedidos p
       CROSS JOIN LATERAL (SELECT p.creado_en + make_interval(mins => fn_minutos_pago_anticipado()) AS vence_en) v
      WHERE p.id_pedido = $1::int AND p.id_cliente = $2::int AND p.canal <> 'mesa'`,
    [idPedido, idCliente]
  );
  const f = rows[0];
  if (!f) return { noExiste: true };
  if (f.estado !== 'por_pagar') return { noPorPagar: true, estado: f.estado };
  if (f.vencido) return { vencido: true };
  return {
    cobro: {
      id_pedido: f.id_pedido,
      id_cliente: f.id_cliente,
      moneda: MONEDA,
      monto_centavos: Number(f.monto_centavos),
      referencia: referenciaDelPedido(f.id_pedido, f.codigo_pedido),
      vence_en: f.vence_en,
    },
  };
}

/**
 * (b) POST /api/pedidos-domicilio/:id/pago/interno: el pago que Wompi ya aprobó.
 * Llama registrar_pago_anticipado, que bloquea el pedido y decide: 'confirmado'
 * (por_pagar -> recibido), 'por_devolver' (queda en pagos_por_devolver) o
 * 'duplicado' (esa referencia ya se procesó). NUNCA rechaza un pago aprobado.
 *
 * @returns {Promise<{noExiste: true} | {duplicado: boolean, resultado: 'confirmado'|'por_devolver',
 *   id_transaccion: number|null, id_por_devolver: number|null, motivo_devolucion: string|null}>}
 */
async function confirmarPagoInterno(idPedido, { referencia_externa, monto_centavos, metodo_pago }) {
  let fila;
  for (let intento = 1; ; intento += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT resultado, transaccion, por_devolver
           FROM registrar_pago_anticipado($1::int, ($2::bigint)::numeric / 100, $3::varchar, $4::varchar)`,
        [idPedido, monto_centavos, metodo_pago, referencia_externa]
      );
      await client.query('COMMIT');
      fila = rows[0];
      break;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err && err.code === 'P0002') return { noExiste: true };
      // Dos confirmaciones del mismo pago a la vez ya se ponen en fila en el
      // bloqueo del pedido; si aun así chocara un índice único de la referencia,
      // el segundo intento la encuentra y responde 'duplicado'.
      if (err && err.code === '23505' && intento === 1) continue;
      throw err;
    } finally {
      client.release();
    }
  }

  const duplicado = fila.resultado === 'duplicado';
  const resultado = fila.transaccion !== null ? 'confirmado' : 'por_devolver';
  let motivo = null;
  if (resultado === 'por_devolver') {
    const m = await pool.query('SELECT motivo FROM pagos_por_devolver WHERE id = $1::int', [fila.por_devolver]);
    motivo = m.rows[0] ? m.rows[0].motivo : null;
  }
  return {
    duplicado,
    resultado,
    id_transaccion: fila.transaccion,
    id_por_devolver: fila.por_devolver,
    motivo_devolucion: motivo,
  };
}

/** El pedido con sus ítems, para el aviso de pedido pagado (formato de order:created). */
async function pedidoParaAviso(idPedido) {
  const { rows } = await pool.query('SELECT * FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
  if (!rows[0]) return null;
  const detalles = await pedidosService.detallesDePedidos([idPedido]);
  return { pedido: rows[0], detalles };
}

module.exports = {
  CANALES,
  MAX_MIOS,
  MONEDA,
  referenciaDelPedido,
  esReferenciaDelPedido,
  crear,
  obtener,
  listarMios,
  cancelar,
  cobroInterno,
  confirmarPagoInterno,
  pedidoParaAviso,
};
