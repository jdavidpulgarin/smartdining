const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Se exige UUID (y no cualquier string) para que el id sea impredecible y de
// tamaño acotado: un cliente no puede llenar la memoria con claves gigantes.
const esEventIdValido = (v) => typeof v === 'string' && UUID.test(v);

/**
 * Registro de eventos ya procesados. Guarda la respuesta de cada eventId
 * durante `ttlMs`, de modo que si el cliente reenvía el mismo evento (porque
 * perdió el ack en una reconexión) el servidor NO vuelve a aplicar el cambio
 * y responde lo mismo.
 *
 * Vive en memoria: sirve para una sola instancia del servidor. Si se escala a
 * varias, la interfaz (obtener/guardar) se puede respaldar con Redis sin
 * tocar a quien la usa.
 *
 * `clave` debe incluir el ámbito (p. ej. "cart:5:<eventId>") para que el mismo
 * UUID en otra mesa u otro tipo de evento no se confunda con un duplicado.
 */
function crearRegistroIdempotencia({ ttlMs = 10 * 60 * 1000, maxEntradas = 50000, ahora = Date.now } = {}) {
  const entradas = new Map(); // clave -> { respuesta, expira }

  // Map conserva el orden de inserción, así que las más viejas están primero:
  // podamos desde el principio hasta encontrar una vigente.
  function podar() {
    const t = ahora();
    for (const [clave, e] of entradas) {
      if (e.expira > t && entradas.size <= maxEntradas) break;
      entradas.delete(clave);
    }
  }

  return {
    obtener(clave) {
      const e = entradas.get(clave);
      if (!e) return undefined;
      if (e.expira <= ahora()) {
        entradas.delete(clave);
        return undefined;
      }
      return e.respuesta;
    },
    guardar(clave, respuesta) {
      entradas.set(clave, { respuesta, expira: ahora() + ttlMs });
      podar();
    },
    get tamano() { return entradas.size; },
  };
}

module.exports = { crearRegistroIdempotencia, esEventIdValido };
