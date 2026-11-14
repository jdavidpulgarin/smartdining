const crypto = require('crypto');
const { enviarJson, exigirClaveInterna } = require('./http');

/**
 * Identidad de ESTE proceso del socket-server (T5, EVENTS.md §6.5).
 *
 * `instanciaId` es un UUID nuevo en cada arranque y no se guarda en ningún
 * sitio. El backend lo lee en el encabezado `X-Instancia-Id` de cualquier
 * respuesta de /internal/* (o en GET /internal/salud). Si cambia respecto al
 * último que vio, el socket-server se reinició y los sockets de ahora no
 * recibieron la carta, así que el backend la vuelve a emitir.
 *
 * Se compara el id y no `arrancadoEn`: los relojes del backend y del
 * socket-server pueden diferir, y dos arranques en el mismo milisegundo darían
 * la misma hora. `arrancadoEn` es solo informativo (logs, diagnóstico).
 */
function crearInstancia({ generarId = crypto.randomUUID, ahora = () => new Date() } = {}) {
  return Object.freeze({ instanciaId: generarId(), arrancadoEn: ahora().toISOString() });
}

// El encabezado X-Instancia-Id lo pone crearRouter (http.js) en toda respuesta
// de /internal/*, con ctx.instancia.

const rutasInstancia = {
  /**
   * GET /internal/salud — con x-internal-key, como el resto de /internal/*.
   * 200 { instanciaId, arrancadoEn, redis: 'ok' | 'caido' }. Sin datos
   * sensibles. No pasa por ningún límite de peticiones (igual que /health):
   * el backend la consulta para saber si el socket-server se reinició.
   *
   * A diferencia de /health, Redis caído NO es un 503: el proceso responde, y
   * lo que el backend necesita es su instanciaId. Sin REDIS_URL (solo
   * desarrollo) no hay nada caído: 'ok'.
   */
  'GET /internal/salud': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const redis = !ctx.redis || ctx.redis.disponible() ? 'ok' : 'caido';
    enviarJson(res, 200, { instanciaId: ctx.instancia.instanciaId, arrancadoEn: ctx.instancia.arrancadoEn, redis });
  },
};

module.exports = { crearInstancia, rutasInstancia };
