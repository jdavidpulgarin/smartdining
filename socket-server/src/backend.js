/**
 * Cliente HTTP del socket-server hacia el backend (servidor a servidor).
 *
 * - Siempre con x-internal-key: las rutas /internal del backend no son
 *   públicas y Nginx las bloquea desde fuera.
 * - Siempre con timeout (AbortController, 1500 ms por defecto): un backend
 *   colgado no debe dejar colgado un evento de socket ni un webhook.
 * - Nunca registra la clave ni el cuerpo en los logs.
 * - Se inyecta `fetch` para que las pruebas no salgan a la red.
 *
 * Devuelve { ok, status, cuerpo } cuando el backend contestó (aunque sea con
 * un 4xx/5xx) y lanza un Error con .codigo 'BACKEND_TIMEOUT' o
 * 'BACKEND_INALCANZABLE' cuando no hubo respuesta: quien llama decide si eso
 * es un 5xx (webhook) o un reintento más tarde (rotación de QR).
 */
const TIMEOUT_POR_DEFECTO_MS = 1500;

function crearClienteBackend({
  url, claveInterna, fetch: fetchFn = globalThis.fetch, timeoutMs = TIMEOUT_POR_DEFECTO_MS,
}) {
  if (!url) throw new Error('crearClienteBackend requiere url');
  const base = url.replace(/\/+$/, '');

  async function pedir(metodo, ruta, cuerpo) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}${ruta}`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', 'x-internal-key': claveInterna },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: control.signal,
      });
      const texto = await res.text();
      let json = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null; // respuesta no JSON: se trata como sin cuerpo
      }
      return { ok: res.ok, status: res.status, cuerpo: json };
    } catch (err) {
      const e = new Error(control.signal.aborted ? 'El backend no respondió a tiempo' : 'No se pudo contactar al backend');
      e.codigo = control.signal.aborted ? 'BACKEND_TIMEOUT' : 'BACKEND_INALCANZABLE';
      throw e;
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    get: (ruta) => pedir('GET', ruta),
    post: (ruta, cuerpo) => pedir('POST', ruta, cuerpo),
  };
}

module.exports = { crearClienteBackend, TIMEOUT_POR_DEFECTO_MS };
