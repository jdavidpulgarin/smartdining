require('dotenv').config();
const { exigirSecretos, esDeEjemplo } = require('./secretos');
const { API_PERMITIDAS } = require('./pasarelas/wompi');

const VARIABLES_WOMPI = ['WOMPI_PUBLIC_KEY', 'WOMPI_PRIVATE_KEY', 'WOMPI_INTEGRITY_SECRET', 'WOMPI_EVENTS_SECRET', 'WOMPI_API_URL'];

/**
 * Pagos con Wompi: todo o nada. Sin ninguna variable WOMPI_* los pagos quedan
 * apagados (POST /pagos/intencion responde 503). Si hay alguna, deben estar
 * todas y ser coherentes; si no, el servidor NO arranca: es preferible a
 * descubrir con el primer pago real que falta el secreto de eventos (y que el
 * webhook acepta cualquier cosa) o que se mezclan llaves de sandbox y producción.
 */
function leerWompi(env, backendUrl) {
  const definidas = VARIABLES_WOMPI.filter((v) => (env[v] || '').trim());
  if (definidas.length === 0) return null;
  const v = Object.fromEntries(VARIABLES_WOMPI.map((k) => [k, (env[k] || '').trim()]));
  const problemas = [];
  for (const k of VARIABLES_WOMPI) if (!v[k]) problemas.push(`${k} es obligatoria si se configuran pagos`);
  if (problemas.length) throw new Error(`Configuración de Wompi incompleta:\n  - ${problemas.join('\n  - ')}`);

  const formatos = {
    WOMPI_PUBLIC_KEY: /^pub_(test|prod)_[A-Za-z0-9]+$/,
    WOMPI_PRIVATE_KEY: /^prv_(test|prod)_[A-Za-z0-9]+$/,
    WOMPI_INTEGRITY_SECRET: /^(test|prod)_integrity_[A-Za-z0-9]+$/,
    WOMPI_EVENTS_SECRET: /^(test|prod)_events_[A-Za-z0-9]+$/,
  };
  const entornos = new Set();
  for (const [k, re] of Object.entries(formatos)) {
    const m = v[k].match(re);
    if (!m || esDeEjemplo(v[k])) {
      problemas.push(`${k} no tiene el formato de Wompi o es un valor de ejemplo`);
      continue;
    }
    entornos.add(m[1]);
    // Las llaves públicas son cortas; los secretos deben tener entropía real.
    if (k !== 'WOMPI_PUBLIC_KEY' && v[k].length < 32) problemas.push(`${k} es demasiado corta`);
  }
  if (entornos.size > 1) problemas.push('Las llaves de Wompi mezclan sandbox (test) y producción (prod)');
  // Lista blanca: la llave privada solo puede viajar a la API oficial de Wompi.
  if (!API_PERMITIDAS.includes(v.WOMPI_API_URL)) {
    problemas.push(`WOMPI_API_URL debe ser una de: ${API_PERMITIDAS.join(', ')}`);
  } else if (entornos.size === 1) {
    const esperada = entornos.has('test') ? API_PERMITIDAS[0] : API_PERMITIDAS[1];
    if (v.WOMPI_API_URL !== esperada) problemas.push(`Con llaves ${[...entornos][0]} WOMPI_API_URL debe ser ${esperada}`);
  }
  // El monto sale de la cuenta que calcula el backend: sin él no hay pagos.
  if (!backendUrl) problemas.push('BACKEND_URL es obligatoria si se configuran pagos');
  const ttl = env.PAGOS_TTL_MINUTOS === undefined ? 30 : Number(env.PAGOS_TTL_MINUTOS);
  // Antigüedad máxima aceptada de un evento (ver TOLERANCIA_PASADO_SEG en wompi.js).
  const toleranciaSeg = env.PAGOS_WEBHOOK_TOLERANCIA_SEG === undefined ? undefined : Number(env.PAGOS_WEBHOOK_TOLERANCIA_SEG);
  if (toleranciaSeg !== undefined && (!Number.isInteger(toleranciaSeg) || toleranciaSeg < 60 || toleranciaSeg > 48 * 3600)) {
    problemas.push('PAGOS_WEBHOOK_TOLERANCIA_SEG debe ser un entero entre 60 y 172800');
  }
  if (!Number.isInteger(ttl) || ttl < 5 || ttl > 120) problemas.push('PAGOS_TTL_MINUTOS debe ser un entero entre 5 y 120');
  if (problemas.length) throw new Error(`Configuración de Wompi inválida:\n  - ${problemas.join('\n  - ')}`);

  return {
    llavePublica: v.WOMPI_PUBLIC_KEY,
    llavePrivada: v.WOMPI_PRIVATE_KEY,
    secretoIntegridad: v.WOMPI_INTEGRITY_SECRET,
    secretoEventos: v.WOMPI_EVENTS_SECRET,
    apiUrl: v.WOMPI_API_URL,
    sandbox: entornos.has('test'),
    ttlMinutos: ttl,
    toleranciaPasadoSeg: toleranciaSeg,
  };
}

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

  // URL del backend para llamadas servidor a servidor (rotación automática del
  // QR y, más adelante, pagos). Opcional: sin ella esas funciones quedan apagadas.
  const backendUrl = (env.BACKEND_URL || '').trim().replace(/\/+$/, '') || null;
  if (backendUrl && !/^https?:\/\/[^/\s]+/.test(backendUrl)) {
    throw new Error('BACKEND_URL debe ser una URL http(s), p. ej. http://localhost:4000');
  }
  const rotacionMin = env.ROTACION_QR_MINUTOS === undefined ? 3 : Number(env.ROTACION_QR_MINUTOS);
  if (!Number.isFinite(rotacionMin) || rotacionMin < 1 || rotacionMin > 60) {
    throw new Error('ROTACION_QR_MINUTOS debe ser un número entre 1 y 60');
  }

  const wompi = leerWompi(env, backendUrl);

  return {
    puerto: Number(env.PORT) || 4001,
    backendUrl,
    // null = pagos apagados. Ojo: este objeto lleva secretos, nunca se registra.
    wompi,
    rotacionQrMs: rotacionMin * 60 * 1000,
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
    // Web Push (opcional): sin las tres, las notificaciones quedan deshabilitadas.
    vapidPublica: env.VAPID_PUBLIC_KEY || null,
    vapidPrivada: env.VAPID_PRIVATE_KEY || null,
    vapidSubject: env.VAPID_SUBJECT || null,
  };
}

module.exports = { cargarConfig };
