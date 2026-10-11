require('dotenv').config();
const { exigirSecretos } = require('./secretos');

// Se lee el entorno en una función (y no al cargar el módulo) para que las
// pruebas puedan cambiar process.env y volver a construir la configuración.
function cargarConfig(env = process.env) {
  const origenes = (env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Un comodín con credenciales dejaría a cualquier sitio abrir un socket
  // en nombre del comensal; preferimos fallar al arrancar que quedar expuestos.
  if (origenes.includes('*')) {
    throw new Error('CORS_ORIGINS no admite "*": lista los orígenes explícitos');
  }
  if (origenes.length === 0) {
    throw new Error('CORS_ORIGINS es obligatorio (orígenes separados por comas)');
  }

  // Sin secretos fuertes y propios no se arranca: un JWT_SECRET de ejemplo
  // dejaría a cualquiera firmar tokens de personal, y una INTERNAL_API_KEY de
  // ejemplo, liberar mesas o inventar comandas por /internal/* (ver secretos.js).
  exigirSecretos(env);

  const entorno = env.NODE_ENV || 'development';
  const redisUrl = (env.REDIS_URL || '').trim() || null;
  // En producción el estado (carritos, idempotencia, revocaciones de QR) DEBE
  // sobrevivir a un reinicio: arrancar en memoria en silencio perdería los
  // carritos y, peor, volvería a aceptar QR revocados. Sin Redis no se arranca.
  if (entorno === 'production' && !redisUrl) {
    throw new Error('REDIS_URL es obligatoria con NODE_ENV=production (el estado no puede vivir solo en memoria)');
  }

  return {
    puerto: Number(env.PORT) || 4001,
    entorno,
    // Sin REDIS_URL (solo fuera de producción) el estado vive en memoria.
    redisUrl,
    origenes,
    jwtSecret: env.JWT_SECRET,
    internalApiKey: env.INTERNAL_API_KEY,
    qrSecret: env.QR_SECRET,
    qrTtlMinutos: Number(env.QR_TTL_MINUTOS) || 360,
    // Vigencia del JWT de la pantalla de mesa (modelo "QR en vidrio"): larga a
    // propósito, la tablet queda montada de sesión en sesión, no por horas.
    pantallaExpiresIn: env.PANTALLA_TOKEN_EXPIRES_IN || '30d',
    // Webhook de pagos: sin secreto el endpoint responde 503 (cerrado).
    pagosWebhookSecret: env.PAYMENT_WEBHOOK_SECRET || null,
    pagosToleranciaSegundos: Number(env.PAYMENT_WEBHOOK_TOLERANCIA_SEG) || 300,
    // Web Push (opcional): sin las tres, las notificaciones quedan deshabilitadas.
    vapidPublica: env.VAPID_PUBLIC_KEY || null,
    vapidPrivada: env.VAPID_PRIVATE_KEY || null,
    vapidSubject: env.VAPID_SUBJECT || null,
  };
}

module.exports = { cargarConfig };
