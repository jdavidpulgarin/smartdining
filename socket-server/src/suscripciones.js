const net = require('net');
const { exito, fallo, manejar } = require('./ack');
const { esEventIdValido } = require('./idempotencia');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson,
} = require('./http');
const { verificarJwt, esComensalSinAlias, ROL_COMENSAL } = require('./auth');
const { estaEnMesa } = require('./salas');
const { log } = require('./log');
const { claveAlias } = require('./alias');

const MAX_SUSCRIPCIONES_POR_MESA = 20; // una mesa tiene pocos comensales; evita llenar memoria
const MAX_ENDPOINT = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/**
 * Valida una suscripción Web Push y devuelve la versión limpia (solo los
 * campos que necesitamos) o { error }.
 *
 * Ojo con el endpoint: el servidor hará un POST a esa URL. Si aceptáramos
 * cualquiera, un cliente podría hacernos llamar a servicios internos (SSRF).
 * Los servicios push reales son siempre HTTPS con nombre de dominio público,
 * así que se exige https y se rechazan IPs literales y "localhost".
 */
function validarSuscripcion(s) {
  if (!s || typeof s !== 'object') return { error: 'subscription es obligatoria' };
  if (typeof s.endpoint !== 'string' || s.endpoint.length > MAX_ENDPOINT) return { error: 'endpoint inválido' };
  let url;
  try {
    url = new URL(s.endpoint);
  } catch {
    return { error: 'endpoint debe ser una URL' };
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || net.isIP(host) || host === 'localhost' || !host.includes('.')) {
    return { error: 'endpoint debe ser una URL https de un servicio push' };
  }
  const { p256dh, auth } = s.keys || {};
  if (typeof p256dh !== 'string' || typeof auth !== 'string'
    || !BASE64URL.test(p256dh) || !BASE64URL.test(auth) || p256dh.length > 200 || auth.length > 100) {
    return { error: 'keys.p256dh y keys.auth son obligatorias (base64url)' };
  }
  return { suscripcion: { endpoint: s.endpoint, keys: { p256dh, auth } } };
}

/**
 * Almacén de suscripciones por mesa (en memoria). Se indexa por endpoint:
 * suscribirse dos veces desde el mismo navegador reemplaza, no duplica, así
 * que el alta es idempotente por naturaleza.
 *
 * Las suscripciones pertenecen a la SESIÓN de mesa: se borran al liberarse la
 * mesa para que el siguiente grupo no reciba avisos del pedido anterior.
 */
function crearAlmacenSuscripciones() {
  const mesas = new Map(); // idMesa -> Map<endpoint, suscripcion>

  return {
    agregar(idMesa, suscripcion) {
      if (!mesas.has(idMesa)) mesas.set(idMesa, new Map());
      const m = mesas.get(idMesa);
      if (!m.has(suscripcion.endpoint) && m.size >= MAX_SUSCRIPCIONES_POR_MESA) return false;
      m.set(suscripcion.endpoint, suscripcion);
      return true;
    },
    quitar(idMesa, endpoint) {
      const m = mesas.get(idMesa);
      const existia = Boolean(m && m.delete(endpoint));
      if (m && m.size === 0) mesas.delete(idMesa);
      return existia;
    },
    listar(idMesa) {
      return [...(mesas.get(idMesa) || new Map()).values()];
    },
    limpiarMesa(idMesa) {
      mesas.delete(idMesa);
    },
  };
}

/**
 * Guarda la suscripción ligada al COMENSAL (alias), no solo a la mesa: así
 * "¡Tu plato está listo!" le llega a quien pidió ese plato y no a toda la
 * mesa. El alias lo pone el servidor (el del join:table de ese socket o uno
 * validado contra la presencia), nunca se acepta uno cualquiera.
 */
async function suscribir(ctx, idMesa, suscripcionCruda, comensal) {
  const { suscripcion, error } = validarSuscripcion(suscripcionCruda);
  if (error) return fallo('PAYLOAD_INVALIDO', error);
  if (!(await ctx.suscripciones.agregar(idMesa, { ...suscripcion, comensal }))) {
    return fallo('PAYLOAD_INVALIDO', `La mesa alcanzó el máximo de ${MAX_SUSCRIPCIONES_POR_MESA} suscripciones`);
  }
  return exito();
}

function registrarSuscripcionesSocket(socket, ctx) {
  const identidad = socket.data.identidad;

  socket.on('push:subscribe', manejar('push:subscribe', async (p) => {
    if (!esEventIdValido(p.eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
    if (identidad.rol !== ROL_COMENSAL) {
      return fallo('NO_AUTORIZADO', 'Solo el comensal se suscribe a push', { eventId: p.eventId });
    }
    // El alias es el del JWT (join:table lo copia en socket.data.alias).
    if (!estaEnMesa(socket, identidad.id_mesa)) {
      return fallo('SIN_SALA', 'Haz join:table antes de suscribirte', { eventId: p.eventId });
    }
    const clave = `push:${identidad.id_mesa}:${p.eventId}`;
    if (await ctx.registro.obtener(clave)) return exito({ eventId: p.eventId, duplicado: true });

    // Dar de alta el mismo endpoint dos veces ya es idempotente (se indexa por
    // endpoint), así que aquí basta con marcar el eventId después del alta.
    const r = await suscribir(ctx, identidad.id_mesa, p.subscription, socket.data.alias);
    if (!r.ok) return { ...r, eventId: p.eventId };
    await ctx.registro.guardar(clave, true);
    return exito({ eventId: p.eventId, duplicado: false });
  }));

  socket.on('push:unsubscribe', manejar('push:unsubscribe', async (p) => {
    if (identidad.rol !== ROL_COMENSAL) return fallo('NO_AUTORIZADO', 'Solo el comensal gestiona sus suscripciones');
    if (typeof p.endpoint !== 'string') return fallo('PAYLOAD_INVALIDO', 'endpoint es obligatorio');
    await ctx.suscripciones.quitar(identidad.id_mesa, p.endpoint);
    return exito();
  }));
}

/** Identifica al comensal desde el Bearer; la mesa sale del JWT, nunca del cuerpo. */
function comensalDeRequest(req, ctx) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const identidad = token ? verificarJwt(token, ctx.config.jwtSecret) : null;
  if (!identidad) {
    if (token && esComensalSinAlias(token, ctx.config.jwtSecret)) {
      throw new ErrorHttp(401, 'TOKEN_INVALIDO', 'Sesión antigua sin nombre: escanea el QR de nuevo');
    }
    throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Se requiere un JWT válido');
  }
  if (identidad.rol !== ROL_COMENSAL) throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Solo el comensal puede suscribirse');
  return identidad;
}

const rutasSuscripciones = {
  'POST /push/suscripcion': async (req, res, ctx) => {
    const { id_mesa: idMesa, comensal } = comensalDeRequest(req, ctx);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    // El alias es el del JWT. `comensal` en el cuerpo es opcional; si viene
    // distinto, alguien intenta recibir los avisos de otro.
    if (cuerpo.comensal !== undefined && cuerpo.comensal !== comensal) {
      throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Solo puedes suscribirte con tu propio nombre');
    }
    const r = await suscribir(ctx, idMesa, cuerpo.subscription, comensal);
    if (!r.ok) throw new ErrorHttp(400, r.codigo, r.mensaje);
    enviarJson(res, 201, { ok: true });
  },
  'DELETE /push/suscripcion': async (req, res, ctx) => {
    const { id_mesa: idMesa } = comensalDeRequest(req, ctx);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    if (typeof cuerpo.endpoint !== 'string') throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'endpoint es obligatorio');
    await ctx.suscripciones.quitar(idMesa, cuerpo.endpoint);
    enviarJson(res, 200, { ok: true });
  },
};

// Push SOLO en: pedido "listo" y "cancelado" (al dueño del pedido) y pago
// confirmado (a quien pagó, más abajo). "en_preparacion" y los demás estados
// no (se ven en vivo en la PWA con order:status): con un aviso por cada paso,
// Chrome en Android marcaba las notificaciones como «Posible spam».
const MENSAJES_ESTADO = {
  listo: '¡Tu plato está listo!',
  cancelado: 'Tu pedido fue cancelado',
};
// Al tocar la notificación, la PWA abre el seguimiento del pedido.
const URL_SEGUIMIENTO = '/seguimiento';
// Y, en la del pago, la pantalla de pago.
const URL_PAGO = '/pago';
const TITULO_PAGO = 'Tu pago está confirmado';

/**
 * Las suscripciones de quien pidió el pedido (sus dueños). Mismo mecanismo
 * para "listo" y "cancelado": si no se sabe quién lo pidió, nadie (la sala
 * igual recibe order:status en vivo). Otro comensal de la mesa no lo recibe.
 */
async function soloDuenosDelPedido(ctx, idPedido, suscripciones) {
  const duenos = ctx.duenosPedidos ? await ctx.duenosPedidos.obtener(idPedido) : [];
  return suscripciones.filter((s) => s.comensal && duenos.includes(s.comensal));
}

/**
 * Envía la notificación push a las suscripciones de la mesa y elimina las
 * caducadas. Se llama sin `await` desde la difusión: un servicio push lento
 * no debe retrasar el evento en vivo ni el ack.
 */
async function notificarCambioEstado(ctx, cambio) {
  const titulo = MENSAJES_ESTADO[cambio.estado];
  if (!titulo || !ctx.push.habilitado) return;
  // Payload mínimo: sin nombres, sin montos, sin mesa. El navegador lo
  // muestra en la pantalla bloqueada del teléfono.
  const payload = {
    titulo,
    cuerpo: cambio.codigo_pedido || `Pedido #${cambio.id_pedido}`,
    id_pedido: cambio.id_pedido,
    estado: cambio.estado,
    url: URL_SEGUIMIENTO,
  };
  const destinatarios = await soloDuenosDelPedido(ctx, cambio.id_pedido, await ctx.suscripciones.listar(cambio.id_mesa));
  const resultados = await Promise.all(destinatarios.map(async (s) => {
    const r = await ctx.push.enviar(s, payload);
    if (r.caducada) await ctx.suscripciones.quitar(cambio.id_mesa, s.endpoint);
    return r;
  }));
  log.info('push: resumen del envío', resumirEnvio(cambio.estado, resultados));
}

/**
 * Push del pago confirmado (Wompi o caja), SOLO a quien pagó: sus
 * suscripciones en esa mesa (mismo alias, comparado con claveAlias como la
 * presencia). Sin alias (la caja cobró la mesa entera) no se avisa a nadie:
 * la mesa igual recibe payment:confirmed en vivo. Payload sin montos ni
 * nombres, como el de los pedidos. Se llama sin `await` y nunca lanza.
 */
async function notificarPagoConfirmado(ctx, { id_mesa: idMesa, comensal }) {
  if (!ctx.push?.habilitado || !ctx.suscripciones || typeof comensal !== 'string') return;
  const clave = claveAlias(comensal);
  if (!clave) return;
  const payload = {
    titulo: TITULO_PAGO,
    cuerpo: 'Gracias. Ya quedó registrado en la cuenta de la mesa.',
    url: URL_PAGO,
  };
  const destinatarios = (await ctx.suscripciones.listar(idMesa))
    .filter((s) => s.comensal && claveAlias(s.comensal) === clave);
  const resultados = await Promise.all(destinatarios.map(async (s) => {
    const r = await ctx.push.enviar(s, payload);
    if (r.caducada) await ctx.suscripciones.quitar(idMesa, s.endpoint);
    return r;
  }));
  log.info('push: resumen del envío', resumirEnvio('pago_confirmado', resultados));
}

/**
 * Un resumen por cambio de estado (T9): a cuántas suscripciones se mandó y
 * cómo les fue, y cuántas por servicio (solo el host). `destinatarios: 0` es
 * también un dato: nadie de la mesa tenía avisos activados.
 */
function resumirEnvio(estado, resultados) {
  const resumen = {
    estado, destinatarios: resultados.length, enviados: 0, fallidos: 0, caducados: 0, servicios: {},
  };
  for (const r of resultados) {
    if (r.ok) resumen.enviados += 1;
    else if (r.caducada) resumen.caducados += 1;
    else resumen.fallidos += 1;
    const servicio = r.servicio || 'desconocido';
    resumen.servicios[servicio] = (resumen.servicios[servicio] || 0) + 1;
  }
  return resumen;
}

module.exports = {
  crearAlmacenSuscripciones, registrarSuscripcionesSocket, MAX_SUSCRIPCIONES_POR_MESA, URL_SEGUIMIENTO, URL_PAGO, rutasSuscripciones, notificarCambioEstado, notificarPagoConfirmado, soloDuenosDelPedido, resumirEnvio, validarSuscripcion,
};
