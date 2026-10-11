/**
 * Logger JSON estructurado: una línea por evento, fácil de filtrar con jq o
 * de enviar a cualquier agregador.
 *
 * Nunca escribe secretos. Se redacta en dos niveles:
 *  1. Por NOMBRE de campo: token, firma, checksum, clave, secret, password,
 *     authorization, endpoint de push, datos de tarjeta o email → "[REDACTADO]".
 *  2. Por FORMA del valor, también dentro del mensaje: JWT (eyJ…), tokens QR
 *     v1.…, llaves de Wompi (pub_/prv_/test_/prod_…) y cadenas hex o base64
 *     largas (firmas, hashes) → "[REDACTADO]".
 * Así un `log.error('falló', { headers: req.headers })` olvidadizo no filtra
 * el Bearer ni la x-internal-key.
 */

const NIVELES = {
  debug: 10, info: 20, warn: 30, error: 40, silencio: 100,
};
const REDACTADO = '[REDACTADO]';

const CAMPO_SENSIBLE = /token|firma|signature|checksum|clave|key|secret|password|contrase|authorization|cookie|subscription|endpoint|p256dh|^auth$|tarjeta|card|cvc|email|correo/i;
const VALORES_SENSIBLES = [
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /\bv1\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // token QR firmado
  /\b(pub|prv)_(test|prod)_[A-Za-z0-9]+/g, // llaves de Wompi
  /\b(test|prod)_(integrity|events)_[A-Za-z0-9]+/g, // secretos de Wompi
  /\bBearer\s+[^\s"']+/gi,
  /\b[0-9a-f]{32,}\b/gi, // hex largo: firmas HMAC/SHA-256, claves generadas
];
const MAX_PROFUNDIDAD = 5;
const MAX_TEXTO = 2000;

function limpiarTexto(texto) {
  let t = texto.length > MAX_TEXTO ? `${texto.slice(0, MAX_TEXTO)}…` : texto;
  for (const re of VALORES_SENSIBLES) t = t.replace(re, REDACTADO);
  return t;
}

/** Copia redactada de cualquier valor (objetos, arreglos, errores). */
function redactar(valor, profundidad = 0) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') return limpiarTexto(valor);
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (profundidad >= MAX_PROFUNDIDAD) return '[…]';
  if (valor instanceof Error) {
    // Del error: nombre, código y mensaje (redactado). La pila solo con debug.
    const e = { nombre: valor.name, mensaje: limpiarTexto(String(valor.message || '')) };
    if (valor.codigo || valor.code) e.codigo = valor.codigo || valor.code;
    if (process.env.LOG_NIVEL === 'debug' && valor.stack) e.pila = limpiarTexto(valor.stack);
    return e;
  }
  if (Buffer.isBuffer(valor)) return `[buffer ${valor.length} bytes]`;
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => redactar(v, profundidad + 1));
  if (typeof valor === 'object') {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) {
      salida[k] = CAMPO_SENSIBLE.test(k) ? REDACTADO : redactar(v, profundidad + 1);
    }
    return salida;
  }
  return String(valor);
}

function nivelPorDefecto() {
  if (process.env.LOG_NIVEL && NIVELES[process.env.LOG_NIVEL] !== undefined) return process.env.LOG_NIVEL;
  // Dentro de `node --test` no se ensucia la salida de las pruebas.
  return process.env.NODE_TEST_CONTEXT ? 'silencio' : 'info';
}

function crearLog({
  nivel = nivelPorDefecto(),
  servicio = 'socket-server',
  ahora = () => new Date().toISOString(),
  escribir = (linea, n) => (n === 'error' || n === 'warn' ? process.stderr : process.stdout).write(`${linea}\n`),
  base = {},
} = {}) {
  const minimo = NIVELES[nivel] ?? NIVELES.info;

  const emitir = (n) => (mensaje, campos = {}) => {
    if (NIVELES[n] < minimo) return;
    const extra = campos instanceof Error ? { error: campos } : campos;
    const linea = {
      ts: ahora(),
      nivel: n,
      servicio,
      msg: limpiarTexto(String(mensaje)),
      ...redactar({ ...base, ...extra }),
    };
    escribir(JSON.stringify(linea), n);
  };

  return {
    debug: emitir('debug'),
    info: emitir('info'),
    warn: emitir('warn'),
    error: emitir('error'),
    /** Logger con campos fijos (p. ej. { modulo: 'pagos' }). */
    hijo: (campos) => crearLog({
      nivel, servicio, ahora, escribir, base: { ...base, ...campos },
    }),
  };
}

const log = crearLog();

module.exports = {
  log, crearLog, redactar, REDACTADO, NIVELES,
};
