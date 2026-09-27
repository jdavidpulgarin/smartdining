require('dotenv').config();

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

  // Sin el secreto compartido con el backend no podemos verificar ningún JWT
  // y cualquiera podría conectarse; es mejor no arrancar.
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET es obligatorio (el mismo que usa backend/)');
  }

  return {
    puerto: Number(env.PORT) || 4001,
    entorno: env.NODE_ENV || 'development',
    origenes,
    jwtSecret: env.JWT_SECRET,
    // Opcional: sin ella los endpoints /internal/* responden 503 (cerrados).
    internalApiKey: env.INTERNAL_API_KEY || null,
    // Si falta, se deriva de JWT_SECRET (ver derivarSecretoQr en qr.js).
    qrSecret: env.QR_SECRET || null,
    qrTtlMinutos: Number(env.QR_TTL_MINUTOS) || 360,
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
