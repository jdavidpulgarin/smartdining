const net = require('net');
const { exito, fallo, manejar } = require('./ack');
const { esEventIdValido } = require('./idempotencia');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson,
} = require('./http');
const { verificarJwt, ROL_COMENSAL } = require('./auth');

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

function suscribir(ctx, idMesa, suscripcionCruda) {
  const { suscripcion, error } = validarSuscripcion(suscripcionCruda);
  if (error) return fallo('PAYLOAD_INVALIDO', error);
  if (!ctx.suscripciones.agregar(idMesa, suscripcion)) {
    return fallo('PAYLOAD_INVALIDO', `La mesa alcanzó el máximo de ${MAX_SUSCRIPCIONES_POR_MESA} suscripciones`);
  }
  return exito();
}

function registrarSuscripcionesSocket(socket, ctx) {
  const identidad = socket.data.identidad;

  socket.on('push:subscribe', manejar('push:subscribe', (p) => {
    if (!esEventIdValido(p.eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
    if (identidad.rol !== ROL_COMENSAL) {
      return fallo('NO_AUTORIZADO', 'Solo el comensal se suscribe a push', { eventId: p.eventId });
    }
    const clave = `push:${identidad.id_mesa}:${p.eventId}`;
    if (ctx.registro.obtener(clave)) return exito({ eventId: p.eventId, duplicado: true });

    const r = suscribir(ctx, identidad.id_mesa, p.subscription);
    if (!r.ok) return { ...r, eventId: p.eventId };
    ctx.registro.guardar(clave, true);
    return exito({ eventId: p.eventId, duplicado: false });
  }));

  socket.on('push:unsubscribe', manejar('push:unsubscribe', (p) => {
    if (identidad.rol !== ROL_COMENSAL) return fallo('NO_AUTORIZADO', 'Solo el comensal gestiona sus suscripciones');
    if (typeof p.endpoint !== 'string') return fallo('PAYLOAD_INVALIDO', 'endpoint es obligatorio');
    ctx.suscripciones.quitar(identidad.id_mesa, p.endpoint);
    return exito();
  }));
}

/** Identifica al comensal desde el Bearer; la mesa sale del JWT, nunca del cuerpo. */
function comensalDeRequest(req, ctx) {
  const auth = req.headers.authorization || '';
  const identidad = auth.startsWith('Bearer ') ? verificarJwt(auth.slice(7), ctx.config.jwtSecret) : null;
  if (!identidad) throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Se requiere un JWT válido');
  if (identidad.rol !== ROL_COMENSAL) throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Solo el comensal puede suscribirse');
  return identidad;
}

const rutasSuscripciones = {
  'POST /push/suscripcion': async (req, res, ctx) => {
    const { id_mesa: idMesa } = comensalDeRequest(req, ctx);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    const r = suscribir(ctx, idMesa, cuerpo.subscription);
    if (!r.ok) throw new ErrorHttp(400, r.codigo, r.mensaje);
    enviarJson(res, 201, { ok: true });
  },
  'DELETE /push/suscripcion': async (req, res, ctx) => {
    const { id_mesa: idMesa } = comensalDeRequest(req, ctx);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    if (typeof cuerpo.endpoint !== 'string') throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'endpoint es obligatorio');
    ctx.suscripciones.quitar(idMesa, cuerpo.endpoint);
    enviarJson(res, 200, { ok: true });
  },
};

// Texto que ve el comensal por cada estado. Solo se avisa de lo que le
// importa a quien espera: "recibido", "entregado" y "pagado" no requieren
// interrumpirlo con una notificación.
const MENSAJES_ESTADO = {
  en_preparacion: 'Tu pedido está en preparación',
  listo: 'Tu pedido está listo',
  cancelado: 'Tu pedido fue cancelado',
};

/**
 * Envía la notificación push a las suscripciones de la mesa y elimina las
 * caducadas. Se llama sin `await` desde la difusión: un servicio push lento
 * no debe retrasar el evento en vivo ni el ack.
 */
async function notificarCambioEstado(ctx, cambio) {
  const titulo = MENSAJES_ESTADO[cambio.estado];
  if (!titulo || !ctx.push.habilitado) return;
  const payload = {
    titulo,
    cuerpo: cambio.codigo_pedido || `Pedido #${cambio.id_pedido}`,
    id_pedido: cambio.id_pedido,
    estado: cambio.estado,
    id_mesa: cambio.id_mesa,
  };
  await Promise.all(ctx.suscripciones.listar(cambio.id_mesa).map(async (s) => {
    const r = await ctx.push.enviar(s, payload);
    if (r.caducada) ctx.suscripciones.quitar(cambio.id_mesa, s.endpoint);
  }));
}

module.exports = {
  crearAlmacenSuscripciones, registrarSuscripcionesSocket, rutasSuscripciones, notificarCambioEstado, validarSuscripcion,
};
