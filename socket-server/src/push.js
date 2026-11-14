const { enviarJson, ErrorHttp } = require('./http');
const { log } = require('./log');

// Códigos con los que el servicio push (FCM, Mozilla...) indica que la
// suscripción ya no existe: el usuario revocó el permiso o desinstaló la PWA.
const CODIGOS_SUSCRIPCION_CADUCADA = [404, 410];
const TTL_PUSH_SEG = 30 * 60;

/**
 * Solo el HOST del servicio push (fcm.googleapis.com, web.push.apple.com,
 * updates.push.services.mozilla.com…), para saber a quién se le habló. Nunca
 * la URL completa: el resto del endpoint identifica al dispositivo.
 */
function servicioDe(suscripcion) {
  try {
    return new URL(suscripcion.endpoint).host || 'desconocido';
  } catch {
    return 'desconocido';
  }
}

/** Código HTTP con que respondió el servicio push, o null si no respondió (red, DNS…). */
const codigoHttp = (r) => (r && Number.isInteger(r.statusCode) ? r.statusCode : null);

// Apple responde { "reason": "BadJwtToken" } (y parecidos): se registra solo si
// tiene esa forma, una palabra corta, para no copiar al log nada que venga en
// el cuerpo de la respuesta.
const RAZON_SEGURA = /^[A-Za-z]{1,40}$/;
function razonDe(err) {
  try {
    const razon = JSON.parse(err.body).reason;
    return typeof razon === 'string' && RAZON_SEGURA.test(razon) ? razon : null;
  } catch {
    return null;
  }
}

/**
 * Servicio de Web Push. Se inyecta `webpush` para poder probarlo sin salir a
 * internet ni depender de un navegador real.
 *
 * Si no hay llaves VAPID configuradas el servicio queda deshabilitado en vez
 * de impedir el arranque: el resto del socket-server (carrito, pedidos) debe
 * seguir funcionando aunque las notificaciones aún no estén configuradas.
 */
function crearServicioPush(config, { webpush = require('web-push') } = {}) {
  const { vapidPublica, vapidPrivada, vapidSubject } = config;
  const habilitado = Boolean(vapidPublica && vapidPrivada && vapidSubject);

  if (habilitado) {
    // setVapidDetails valida el formato de las llaves y del subject y lanza
    // si son incorrectos: preferimos fallar al arrancar que al primer envío.
    webpush.setVapidDetails(vapidSubject, vapidPublica, vapidPrivada);
  } else {
    log.warn('push: VAPID no configurado, Web Push deshabilitado (usa "npm run vapid")');
  }

  /**
   * Envía una notificación a una suscripción.
   * Devuelve { ok, caducada, servicio, status } (`motivo` si falló) —
   * `caducada` le indica al llamador que debe borrar esa suscripción porque
   * nunca volverá a servir. Nunca lanza: un fallo de push no debe romper la
   * difusión por socket.
   *
   * Cada envío deja UNA línea en el log (T9): el host del servicio, el código
   * HTTP y si la suscripción caducó. Sin el endpoint completo, sin las llaves
   * de la suscripción (p256dh, auth) y sin el payload.
   */
  async function enviar(suscripcion, payload) {
    if (!habilitado) return { ok: false, caducada: false, motivo: 'deshabilitado' };
    const servicio = servicioDe(suscripcion);
    try {
      // TTL 30 min: si el dispositivo está apagado más tiempo, "tu plato está
      // listo" ya no sirve (o ya lo recogieron). urgency high: que no lo
      // retrase el ahorro de batería.
      const r = await webpush.sendNotification(suscripcion, JSON.stringify(payload), { TTL: TTL_PUSH_SEG, urgency: 'high' });
      const status = codigoHttp(r);
      log.info('push: enviado', { servicio_push: servicio, status, caducada: false });
      return { ok: true, caducada: false, servicio, status };
    } catch (err) {
      const status = codigoHttp(err);
      const caducada = CODIGOS_SUSCRIPCION_CADUCADA.includes(status);
      const campos = { servicio_push: servicio, status, caducada };
      const razon = razonDe(err);
      if (razon) campos.razon = razon;
      // Sin respuesta HTTP: el código de red (ECONNRESET, ENOTFOUND…).
      if (status === null && typeof err.code === 'string') campos.codigo = err.code;
      // Caducada es lo normal (desinstaló la PWA o quitó el permiso): info.
      if (caducada) log.info('push: suscripción caducada', campos);
      else log.error('push: error al enviar', campos);
      return {
        ok: false, caducada, motivo: status || 'error', servicio, status,
      };
    }
  }

  return { habilitado, clavePublica: habilitado ? vapidPublica : null, enviar };
}

const rutasPush = {
  // La clave pública no es secreta: el navegador la necesita como
  // applicationServerKey para crear la suscripción.
  'GET /push/clave-publica': async (req, res, ctx) => {
    if (!ctx.push.habilitado) throw new ErrorHttp(503, 'NO_CONFIGURADO', 'Web Push no está configurado');
    enviarJson(res, 200, { clave: ctx.push.clavePublica });
  },
};

module.exports = {
  crearServicioPush, rutasPush, servicioDe, CODIGOS_SUSCRIPCION_CADUCADA, TTL_PUSH_SEG,
};
