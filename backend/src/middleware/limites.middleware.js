const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { enPruebas } = require('../config/entorno');

/**
 * Límites de intentos para las dos rutas públicas que se pueden martillear:
 * el login del personal (H-04) y la apertura de sesión por QR (H-27).
 *
 * Las dos tienen el mismo problema de fondo: no piden sesión previa, así que
 * cualquiera puede probar combinaciones hasta acertar. En la auditoría se
 * midieron 40 intentos de login en 2,75 s sin un solo 429, y bcrypt aguanta
 * unos 30 logins por segundo, así que además de abrir la puerta a la fuerza
 * bruta es una forma barata de tumbar el servidor.
 *
 * LIMITACIÓN CONOCIDA: el contador vive en memoria del proceso. Con varias
 * instancias del backend (Docker con réplicas, PM2 en cluster) el límite es
 * por instancia, no global: con N instancias el techo real es 5×N. Para que
 * fuera global haría falta un store compartido en Redis; se deja anotado en
 * vez de añadir otra dependencia que no hace falta hoy.
 */

/** Minutos a milisegundos, para que los valores por defecto se lean solos. */
const UN_MINUTO_MS = 60 * 1000;

/** Lee un entero de una variable de entorno, con respaldo si no es válido. */
function entero(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const MENSAJE_LOGIN =
  'Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo.';
const MENSAJE_QR =
  'Demasiados intentos de abrir la sesión de la mesa. Espera un momento y vuelve a intentarlo.';

/**
 * Respuesta del 429. express-rate-limit ya pone Retry-After; aquí solo se da
 * un cuerpo con la misma forma que el resto de errores de la API ({ error }).
 */
function responder429(mensaje) {
  return (req, res) => res.status(429).json({ error: mensaje });
}

/**
 * Limitador del login: cuenta por IP **y** email.
 *
 * Por IP sola, un atacante con una botnet esquiva el límite; por email solo,
 * cualquiera puede bloquear la cuenta de otro a propósito. La combinación
 * limita "esta IP probando esta cuenta", que es justo el ataque.
 *
 * Solo cuenta los intentos FALLIDOS (skipSuccessfulRequests): un cajero que
 * entra y sale varias veces en un minuto no debe bloquearse a sí mismo.
 *
 * ipKeyGenerator normaliza la IP (en IPv6 agrupa por subred /64, para que un
 * atacante con un rango entero no cuente como miles de clientes distintos).
 */
function crearLimitadorLogin(env = process.env) {
  return rateLimit({
    windowMs: entero(env.RATE_LIMIT_LOGIN_VENTANA_MS, UN_MINUTO_MS),
    limit: entero(env.RATE_LIMIT_LOGIN_MAX, 5),
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => enPruebas(env),
    keyGenerator: (req) => {
      // El email se normaliza igual que al buscar el usuario, para que
      // "Ana@x.com" y "ana@x.com " compartan contador.
      const email = String(req.body?.email || '').trim().toLowerCase();
      return `${ipKeyGenerator(req.ip)}:${email}`;
    },
    handler: responder429(MENSAJE_LOGIN),
  });
}

/**
 * Limitador de la apertura de sesión por QR.
 *
 * Más holgado que el login a propósito: los comensales de una mesa comparten
 * el wifi del local, así que varias personas escaneando a la vez salen con la
 * misma IP pública. 20 por minuto deja trabajar a una mesa entera y sigue
 * cortando a quien prueba tokens en serie.
 *
 * Aquí se cuentan TODOS los intentos, no solo los fallidos: un token válido
 * que se reusa muchas veces por segundo también es tráfico que no debería
 * pasar.
 */
function crearLimitadorQr(env = process.env) {
  return rateLimit({
    windowMs: entero(env.RATE_LIMIT_QR_VENTANA_MS, UN_MINUTO_MS),
    limit: entero(env.RATE_LIMIT_QR_MAX, 20),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => enPruebas(env),
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: responder429(MENSAJE_QR),
  });
}

module.exports = {
  crearLimitadorLogin,
  crearLimitadorQr,
  enPruebas,
  entero,
  MENSAJE_LOGIN,
  MENSAJE_QR,
};
