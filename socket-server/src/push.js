const { enviarJson, ErrorHttp } = require('./http');

// Códigos con los que el servicio push (FCM, Mozilla...) indica que la
// suscripción ya no existe: el usuario revocó el permiso o desinstaló la PWA.
const CODIGOS_SUSCRIPCION_CADUCADA = [404, 410];

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
    console.warn('[push] VAPID no configurado: Web Push deshabilitado (usa "npm run vapid")');
  }

  /**
   * Envía una notificación a una suscripción.
   * Devuelve { ok:true } o { ok:false, caducada } — `caducada` le indica al
   * llamador que debe borrar esa suscripción porque nunca volverá a servir.
   * Nunca lanza: un fallo de push no debe romper la difusión por socket.
   */
  async function enviar(suscripcion, payload) {
    if (!habilitado) return { ok: false, caducada: false, motivo: 'deshabilitado' };
    try {
      // TTL: si el dispositivo está apagado, el aviso "tu pedido está listo"
      // pierde sentido pasada una hora, así que no se encola más tiempo.
      await webpush.sendNotification(suscripcion, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
      return { ok: true };
    } catch (err) {
      const caducada = CODIGOS_SUSCRIPCION_CADUCADA.includes(err.statusCode);
      if (!caducada) console.error('[push] error al enviar:', err.statusCode || err.message);
      return { ok: false, caducada, motivo: err.statusCode || 'error' };
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

module.exports = { crearServicioPush, rutasPush, CODIGOS_SUSCRIPCION_CADUCADA };
