const crypto = require('crypto');

/**
 * Único punto por donde el backend avisa al socket-server de Roberto.
 *
 * Contrato: socket-server/EVENTS.md (sección 6). Son POST a /internal/* con la
 * cabecera x-internal-key y un eventId UUID v4 por acción; reintentar con el
 * mismo eventId es seguro porque él deduplica.
 *
 * AISLAMIENTO (regla de diseño): el tiempo real es un extra, no parte de la
 * transacción. Ninguna función de aquí lanza: si el socket-server está caído,
 * lento o responde mal, se registra y se devuelve { ok: false }, y el pedido o
 * el pago siguen su curso. Por eso tampoco se hace await en los controllers
 * sobre el resultado para decidir la respuesta HTTP.
 */

const TIMEOUT_POR_DEFECTO_MS = 1500;

function config() {
  return {
    url: (process.env.SOCKET_URL || '').replace(/\/$/, ''),
    clave: process.env.INTERNAL_API_KEY || '',
    timeoutMs: Number(process.env.SOCKET_TIMEOUT_MS) || TIMEOUT_POR_DEFECTO_MS,
  };
}

/** Un eventId por acción del usuario, como exige la idempotencia de Roberto. */
function nuevoEventId() {
  return crypto.randomUUID();
}

/**
 * POST a una ruta interna. Nunca lanza.
 * @returns {Promise<{ok: boolean, motivo?: string, respuesta?: object}>}
 */
async function enviar(ruta, cuerpo) {
  const { url, clave, timeoutMs } = config();

  // Sin configuración no es un error: simplemente el tiempo real está apagado
  // (por ejemplo en las pruebas o en un entorno sin socket-server).
  if (!url || !clave) {
    return { ok: false, motivo: 'SIN_CONFIGURAR' };
  }

  // AbortSignal.timeout corta la espera; sin esto un socket-server colgado
  // dejaría la petición del comensal esperando.
  const control = AbortSignal.timeout(timeoutMs);

  try {
    const res = await fetch(`${url}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': clave },
      body: JSON.stringify(cuerpo),
      signal: control,
    });

    const texto = await res.text();
    let respuesta = null;
    try {
      respuesta = texto ? JSON.parse(texto) : null;
    } catch {
      respuesta = { crudo: texto.slice(0, 200) };
    }

    if (!res.ok) {
      console.error(`[socket] ${ruta} respondio ${res.status}:`, respuesta);
      return { ok: false, motivo: `HTTP_${res.status}`, respuesta };
    }
    return { ok: true, respuesta };
  } catch (err) {
    // Incluye el timeout (AbortError) y que el socket-server no esté levantado.
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] ${ruta} no se pudo notificar (${motivo}):`, err.message);
    return { ok: false, motivo };
  }
}

/**
 * Da forma al pedido tal como lo documenta EVENTS.md, no como lo devuelve la
 * base: los ítems usan `nombre` (no `plato_nombre`) porque ese es el nombre de
 * campo del contrato de Roberto, que es lo que leen los frontends.
 */
function armarPedido(pedido, detalles = []) {
  return {
    id_pedido: pedido.id_pedido,
    codigo_pedido: pedido.codigo_pedido ?? null,
    id_mesa: pedido.id_mesa,
    estado: pedido.estado,
    total: pedido.total,
    notas_generales: pedido.notas_generales ?? null,
    items: detalles.map((d) => ({
      id_plato: d.id_plato,
      nombre: d.plato_nombre ?? null,
      cantidad: d.cantidad,
      notas_especiales: d.notas_especiales ?? null,
    })),
  };
}

/** POST /internal/order-created — comanda nueva hacia KDS, admin y la mesa. */
async function notificarPedidoCreado(pedido, detalles) {
  return enviar('/internal/order-created', {
    eventId: nuevoEventId(),
    pedido: armarPedido(pedido, detalles),
  });
}

/** POST /internal/order-status — cambio de estado hacia KDS, admin y la mesa. */
async function notificarCambioEstado({ id_pedido, id_mesa, codigo_pedido, estado_anterior, estado }) {
  return enviar('/internal/order-status', {
    eventId: nuevoEventId(),
    id_pedido,
    id_mesa,
    codigo_pedido: codigo_pedido ?? null,
    estado_anterior: estado_anterior ?? null,
    estado,
  });
}

/**
 * POST /internal/mesa-liberada — invalida los QR emitidos de esa mesa y borra
 * su carrito y sus suscripciones push, para que el grupo siguiente empiece
 * limpio. Se llama tras un pago efectivo (estado_transaccion 'completada').
 */
async function notificarMesaLiberada(id_mesa) {
  return enviar('/internal/mesa-liberada', { id_mesa });
}

module.exports = {
  nuevoEventId,
  armarPedido,
  notificarPedidoCreado,
  notificarCambioEstado,
  notificarMesaLiberada,
  TIMEOUT_POR_DEFECTO_MS,
};
