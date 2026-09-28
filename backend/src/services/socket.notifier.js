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

/**
 * POST /qr/generar — pide al socket-server el token del QR de una mesa.
 *
 * Reenvía el JWT del mesero/admin que abrió la mesa porque esa ruta exige
 * `Authorization: Bearer` con rol admin/mesero/cajero: el socket-server decide
 * por sí mismo si quien pide puede generar QR, sin que el backend suplante a
 * nadie con la clave interna.
 *
 * Como en validarTokenQr, aquí el resultado SÍ importa: sin token no se puede
 * abrir la mesa, así que se distingue "me rechazó" de "no pude preguntar".
 *
 * @returns {Promise<{alcanzado: boolean, token?: string, expira_en?: number,
 *                    status?: number, mensaje?: string, motivo?: string}>}
 */
async function generarTokenQr(idMesa, jwtStaff, ttlMinutos) {
  const { url, timeoutMs } = config();
  if (!url) return { alcanzado: false, motivo: 'SIN_CONFIGURAR' };

  const cuerpo = { id_mesa: idMesa };
  if (ttlMinutos !== undefined) cuerpo.ttl_minutos = ttlMinutos;

  try {
    const res = await fetch(`${url}/qr/generar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtStaff}`,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const texto = await res.text();
    let respuesta = null;
    try {
      respuesta = texto ? JSON.parse(texto) : null;
    } catch {
      respuesta = null;
    }

    if (res.status === 201 && respuesta && respuesta.token) {
      return { alcanzado: true, token: respuesta.token, expira_en: respuesta.expira_en };
    }
    // 401/403/400: el socket-server contestó y dijo que no. Es un veredicto, no
    // una caída, así que el llamador puede traducirlo a su propio status.
    if (res.status >= 400 && res.status < 500) {
      return {
        alcanzado: true,
        status: res.status,
        mensaje: (respuesta && respuesta.mensaje) || 'El servicio de QR rechazó la solicitud',
      };
    }
    console.error(`[socket] /qr/generar respondio ${res.status}:`, respuesta);
    return { alcanzado: false, motivo: `HTTP_${res.status}` };
  } catch (err) {
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] /qr/generar no se pudo consultar (${motivo}):`, err.message);
    return { alcanzado: false, motivo };
  }
}

/**
 * POST /qr/validar — decide si un token QR sirve para abrir sesión de mesa.
 *
 * A diferencia del resto de este módulo, aquí el resultado SÍ importa: sin
 * validar no se puede entrar, así que el llamador tiene que distinguir "token
 * inválido" de "no pude preguntar" y responder 503 en el segundo caso.
 *
 * La ruta es pública en el socket-server (el comensal aún no tiene sesión
 * cuando escanea), por eso no lleva x-internal-key.
 *
 * @returns {Promise<{alcanzado: boolean, valido?: boolean, id_mesa?: number,
 *                    motivo?: string}>}
 */
async function validarTokenQr(token) {
  const { url, timeoutMs } = config();
  if (!url) return { alcanzado: false, motivo: 'SIN_CONFIGURAR' };

  try {
    const res = await fetch(`${url}/qr/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const texto = await res.text();
    let cuerpo = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = null;
    }

    // 200 => válido; 401 => inválido con motivo. Cualquier otro status es un
    // problema del socket-server, no un veredicto sobre el token.
    if (res.status === 200 && cuerpo && cuerpo.valido) {
      return { alcanzado: true, valido: true, id_mesa: cuerpo.id_mesa, expira_en: cuerpo.expira_en };
    }
    if (res.status === 401) {
      return { alcanzado: true, valido: false, motivo: (cuerpo && cuerpo.motivo) || 'invalido' };
    }
    console.error(`[socket] /qr/validar respondio ${res.status}:`, cuerpo);
    return { alcanzado: false, motivo: `HTTP_${res.status}` };
  } catch (err) {
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] /qr/validar no se pudo consultar (${motivo}):`, err.message);
    return { alcanzado: false, motivo };
  }
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
  generarTokenQr,
  validarTokenQr,
  notificarPedidoCreado,
  notificarCambioEstado,
  notificarMesaLiberada,
  TIMEOUT_POR_DEFECTO_MS,
};
