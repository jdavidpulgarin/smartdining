const crypto = require('crypto');

/**
 * Autenticación de las rutas internas: las que llama el socket-server de
 * Roberto, no un navegador.
 *
 * Estas rutas NO llevan JWT. El socket-server no actúa en nombre de un usuario
 * cuando registra un pago de Wompi: es un servicio hablando con otro, y lo
 * único que tiene es la clave compartida `INTERNAL_API_KEY` en la cabecera
 * `x-internal-key` (contrato: socket-server/EVENTS.md §8.2, §8.4 y §8.5).
 *
 * Es el mismo secreto con el que el backend firma sus llamadas a
 * `/internal/*` del socket-server, pero en el sentido contrario.
 */

// Los mismos placeholders que revisa config/verificar-entorno.js. Arrancar con
// uno de ellos es arrancar sin clave, y estas rutas mueven dinero.
const VALORES_DE_EJEMPLO = [
  'cambia-esto-por-un-secreto-largo-y-aleatorio',
  'cambia-esto-por-una-clave-interna-larga',
  'cambia-esto-por-otro-secreto-largo',
];

const MENSAJE_SIN_CLAVE = 'El canal interno no está configurado en este servidor';
const MENSAJE_NO_AUTORIZADO = 'Clave interna inválida';

/** La clave configurada, o null si falta o es un valor de ejemplo. */
function claveConfigurada(env = process.env) {
  const clave = (env.INTERNAL_API_KEY || '').trim();
  if (!clave || VALORES_DE_EJEMPLO.includes(clave)) return null;
  return clave;
}

/**
 * Compara dos cadenas en tiempo constante.
 *
 * timingSafeEqual exige buffers del mismo largo, así que primero se comparan los
 * largos. Eso filtra el largo de la clave, que no es el secreto; lo que no se
 * puede filtrar es cuántos caracteres iniciales acertó quien lo intenta, porque
 * con eso se adivina byte a byte.
 */
function igualEnTiempoConstante(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Exige la cabecera x-internal-key.
 *
 * Falla cerrada: sin clave configurada en el servidor responde 503 en vez de
 * dejar pasar. Si quedara abierta, cualquiera en la red podría registrar pagos
 * y liberar mesas; un 503 solo rompe la integración con el socket-server, y eso
 * se nota y se arregla.
 */
function requireInternalKey(req, res, next) {
  const esperada = claveConfigurada();
  if (!esperada) {
    console.error(
      '[interno] INTERNAL_API_KEY no está configurada (o tiene el valor de ejemplo): '
        + 'las rutas internas responden 503 hasta que se le ponga una clave propia.'
    );
    return res.status(503).json({ error: MENSAJE_SIN_CLAVE });
  }

  const recibida = req.headers['x-internal-key'];
  if (typeof recibida !== 'string' || !igualEnTiempoConstante(recibida, esperada)) {
    return res.status(401).json({ error: MENSAJE_NO_AUTORIZADO });
  }

  return next();
}

module.exports = {
  requireInternalKey,
  claveConfigurada,
  VALORES_DE_EJEMPLO,
  MENSAJE_SIN_CLAVE,
  MENSAJE_NO_AUTORIZADO,
};
