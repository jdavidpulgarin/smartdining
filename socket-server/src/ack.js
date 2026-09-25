// Formato único de respuesta (ack) para todos los eventos. Tener un solo
// formato evita que cada frontend tenga que adivinar cómo leer un error.

function exito(extra = {}) {
  return { ok: true, ...extra };
}

function fallo(codigo, mensaje, extra = {}) {
  return { ok: false, codigo, mensaje, ...extra };
}

// Un cliente puede emitir sin callback; sin este chequeo, llamar a `ack`
// lanzaría un TypeError y tumbaría el manejador del evento.
function responder(ack, respuesta) {
  if (typeof ack === 'function') ack(respuesta);
}

/**
 * Envuelve un manejador de evento para que cualquier excepción llegue al
 * cliente como ERROR_INTERNO en vez de quedar sin ack (el cliente esperaría
 * para siempre) o tumbar el proceso.
 */
function manejar(nombre, handler) {
  return async (payload, ack) => {
    try {
      // Si el cliente manda un no-objeto (null, string...) se trata como vacío
      // para que los manejadores puedan leer campos sin comprobar el tipo.
      const seguro = payload && typeof payload === 'object' ? payload : {};
      responder(ack, await handler(seguro));
    } catch (err) {
      console.error(`[socket] error en ${nombre}:`, err);
      responder(ack, fallo('ERROR_INTERNO', 'Error inesperado del servidor'));
    }
  };
}

module.exports = { exito, fallo, responder, manejar };
