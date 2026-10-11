const crypto = require('crypto');

/**
 * Pasarela Wompi (Bancolombia), modo sandbox por defecto. Implementa
 * PasarelaPago (ver PasarelaPago.js).
 *
 * Verificado contra la documentación oficial (docs.wompi.co, oct. 2026):
 * - Firma de integridad del Widget / Web Checkout:
 *     SHA-256 hex de "<referencia><monto_en_centavos><moneda><expiration_time><secreto_integridad>"
 *   (sin expiration_time si no se usa). El widget la recibe en
 *   data-signature:integrity y rechaza el pago si alguien cambió el monto o la
 *   referencia en el navegador, o si pasó la fecha de expiración.
 * - Widget: https://checkout.wompi.co/widget.js · Web Checkout: https://checkout.wompi.co/p/
 * - API: sandbox https://sandbox.wompi.co/v1 · producción https://production.wompi.co/v1
 *
 * - Eventos (webhook): checksum = SHA-256 hex de la concatenación de los
 *   valores de signature.properties (en el ORDEN recibido, rutas dentro de
 *   "data"), seguida de "timestamp" y del secreto de eventos. Llega en
 *   signature.checksum y en la cabecera X-Event-Checksum. Wompi espera un 200 y,
 *   si no lo recibe, reintenta 3 veces en 24 h (30 min, 3 h y 24 h).
 * - GET /transactions/{id} solo con la llave PRIVADA (Bearer prv_...); con la
 *   pública responde 404.
 *
 * Ningún secreto sale del servidor: solo viajan la llave pública y firmas.
 */

const MONEDA = 'COP';
const TIMEOUT_API_MS = 5000;
// Ventana del timestamp del evento. Hacia atrás 25 h y no 5 min: Wompi
// reintenta hasta 24 h después si no recibió un 200 (p. ej. porque el backend
// estaba caído y respondimos 503), y con 5 min ese pago no se registraría
// nunca. El replay de un evento viejo no hace daño: la idempotencia por
// transacción lo descarta y el estado se vuelve a consultar en la API.
// Hacia el futuro solo 5 min (desfase de relojes).
const TOLERANCIA_PASADO_SEG = 25 * 60 * 60;
const TOLERANCIA_FUTURO_SEG = 5 * 60;
const MAX_PROPIEDADES = 20;
const RUTA_PROPIEDAD = /^[a-z_]+(\.[a-z_]+){0,4}$/;
const ID_TRANSACCION = /^[A-Za-z0-9-]{1,64}$/;
const API_PERMITIDAS = ['https://sandbox.wompi.co/v1', 'https://production.wompi.co/v1'];

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

/** Firma de integridad documentada por Wompi. */
function firmaIntegridad({
  referencia, montoCentavos, moneda, expiracion, secreto,
}) {
  return sha256(`${referencia}${montoCentavos}${moneda}${expiracion || ''}${secreto}`);
}

const esHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** Compara dos SHA-256 en hex en tiempo constante. */
function mismoHash(a, b) {
  if (!esHex64(a) || !esHex64(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}

/** Valor de una ruta "transaction.amount_in_cents" dentro de data; undefined si no es escalar. */
function leerRuta(data, ruta) {
  let v = data;
  for (const parte of ruta.split('.')) {
    if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, parte)) return undefined;
    v = v[parte];
  }
  return ['string', 'number', 'boolean'].includes(typeof v) ? v : undefined;
}

/**
 * Verifica un evento de Wompi sobre el cuerpo CRUDO. No hay forma de leer
 * signature.properties sin parsear, así que se parsea, pero NADA de lo que
 * dice el evento se usa hasta que el checksum (secreto incluido) coincide.
 */
function verificarEventoWompi(crudo, cabeceras, {
  secretoEventos, ahora = Date.now, toleranciaPasadoSeg = TOLERANCIA_PASADO_SEG, toleranciaFuturoSeg = TOLERANCIA_FUTURO_SEG,
}) {
  if (!Buffer.isBuffer(crudo)) return { valido: false, motivo: 'cuerpo' };
  let e;
  try {
    e = JSON.parse(crudo.toString('utf8'));
  } catch {
    return { valido: false, motivo: 'json' };
  }
  if (!e || typeof e !== 'object' || typeof e.event !== 'string' || !e.data || typeof e.data !== 'object') {
    return { valido: false, motivo: 'formato' };
  }
  const firma = e.signature;
  if (!firma || !Array.isArray(firma.properties) || firma.properties.length === 0
    || firma.properties.length > MAX_PROPIEDADES || !esHex64(firma.checksum)) {
    return { valido: false, motivo: 'formato_firma' };
  }
  if (!Number.isSafeInteger(e.timestamp)) return { valido: false, motivo: 'timestamp' };

  // Las propiedades se concatenan en el orden recibido, sin fijarlas en el
  // código: Wompi decide qué campos firma en cada evento.
  let concatenado = '';
  for (const ruta of firma.properties) {
    if (typeof ruta !== 'string' || !RUTA_PROPIEDAD.test(ruta)) return { valido: false, motivo: 'propiedad' };
    const valor = leerRuta(e.data, ruta);
    if (valor === undefined) return { valido: false, motivo: 'propiedad' };
    concatenado += String(valor);
  }
  const esperado = sha256(`${concatenado}${e.timestamp}${secretoEventos}`);
  if (!mismoHash(esperado, firma.checksum)) return { valido: false, motivo: 'checksum' };
  // Si viene la cabecera, también debe coincidir (no puede contradecir al cuerpo).
  const cabecera = cabeceras && cabeceras['x-event-checksum'];
  if (cabecera !== undefined && !mismoHash(esperado, String(cabecera))) return { valido: false, motivo: 'checksum_cabecera' };

  const edad = Math.floor(ahora() / 1000) - e.timestamp;
  if (edad > toleranciaPasadoSeg || -edad > toleranciaFuturoSeg) return { valido: false, motivo: 'timestamp' };

  const evento = { tipo: e.event };
  const tx = e.data.transaction;
  if (e.event === 'transaction.updated') {
    if (!tx || typeof tx !== 'object' || typeof tx.id !== 'string' || !ID_TRANSACCION.test(tx.id)
      || typeof tx.reference !== 'string' || tx.reference.length > 100 || typeof tx.status !== 'string'
      || !Number.isSafeInteger(tx.amount_in_cents) || typeof tx.currency !== 'string') {
      return { valido: false, motivo: 'transaccion' };
    }
    Object.assign(evento, {
      id_transaccion: tx.id,
      referencia: tx.reference,
      estado: tx.status,
      monto_centavos: tx.amount_in_cents,
      moneda: tx.currency,
    });
  }
  return { valido: true, evento };
}

function crearPasarelaWompi({
  llavePublica, llavePrivada, secretoIntegridad, secretoEventos, apiUrl,
  fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_API_MS, ahora = Date.now, toleranciaPasadoSeg,
}) {
  if (!llavePublica || !secretoIntegridad) throw new Error('Wompi requiere llave pública y secreto de integridad');

  return {
    nombre: 'wompi',
    moneda: MONEDA,
    apiUrl,

    /** @returns {import('./PasarelaPago').IntencionPago} */
    crearIntencion({
      referencia, montoCentavos, moneda = MONEDA, expiraEn,
    }) {
      if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) throw new RangeError('montoCentavos inválido');
      if (moneda !== MONEDA) throw new RangeError(`Wompi opera en ${MONEDA}`);
      const expiracion = expiraEn.toISOString();
      return {
        referencia,
        monto_en_centavos: montoCentavos,
        moneda,
        llave_publica: llavePublica,
        firma_integridad: firmaIntegridad({
          referencia, montoCentavos, moneda, expiracion, secreto: secretoIntegridad,
        }),
        expira_en: expiracion,
      };
    },

    /** @returns {import('./PasarelaPago').ResultadoEvento} */
    verificarEvento(crudo, cabeceras) {
      if (!secretoEventos) return { valido: false, motivo: 'sin_secreto' };
      return verificarEventoWompi(crudo, cabeceras, {
        secretoEventos, ahora, ...(toleranciaPasadoSeg ? { toleranciaPasadoSeg } : {}),
      });
    },

  };
}

module.exports = {
  crearPasarelaWompi, firmaIntegridad, verificarEventoWompi, sha256, MONEDA, API_PERMITIDAS, TOLERANCIA_PASADO_SEG,
};
