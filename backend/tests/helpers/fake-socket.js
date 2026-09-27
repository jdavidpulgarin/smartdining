// Doble del socket-server de Roberto. Sustituye globalThis.fetch para que las
// pruebas NO salgan a la red: registra cada aviso que manda el backend y deja
// decidir qué responde (o si falla) el socket-server simulado.
//
// También fija SOCKET_URL / INTERNAL_API_KEY, así las pruebas no dependen del
// .env local de quien las corra.

const URL_FALSA = 'http://socket-de-prueba:4001';
const CLAVE_FALSA = 'clave-interna-de-prueba';

/**
 * @param {(ruta: string, cuerpo: object, peticion: object) => object|Error|Promise}
 *   responder  Devuelve el cuerpo con el que contesta el socket-server. Si
 *   devuelve (o lanza) un Error, se simula un socket-server caído. Si devuelve
 *   { __status }, se simula ese código HTTP. Por omisión responde { ok: true }.
 */
function instalarFakeSocket(responder) {
  const fetchOriginal = globalThis.fetch;
  const envPrevio = {
    SOCKET_URL: process.env.SOCKET_URL,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    SOCKET_TIMEOUT_MS: process.env.SOCKET_TIMEOUT_MS,
  };

  process.env.SOCKET_URL = URL_FALSA;
  process.env.INTERNAL_API_KEY = CLAVE_FALSA;

  const avisos = [];

  globalThis.fetch = async (url, opciones = {}) => {
    if (!String(url).startsWith(URL_FALSA)) {
      throw new Error(`La prueba intentó salir a la red: ${url}`);
    }
    const ruta = String(url).slice(URL_FALSA.length);
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    const aviso = { ruta, cuerpo, cabeceras: opciones.headers || {}, opciones };
    avisos.push(aviso);

    // El fetch real aborta cuando salta la señal de timeout; el doble tiene que
    // hacer lo mismo o una respuesta que nunca llega colgaría la prueba.
    const abortada = new Promise((_, rechazar) => {
      const señal = opciones.signal;
      if (!señal) return;
      const fallar = () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = señal.reason && señal.reason.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError';
        rechazar(err);
      };
      if (señal.aborted) fallar();
      else señal.addEventListener('abort', fallar, { once: true });
    });

    const respondida = Promise.resolve(responder ? responder(ruta, cuerpo, aviso) : { ok: true });
    const resultado = await Promise.race([respondida, abortada]);
    if (resultado instanceof Error) throw resultado;

    const status = resultado && resultado.__status ? resultado.__status : 200;
    const json = { ...resultado };
    delete json.__status;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
    };
  };

  return {
    avisos,
    /** Primer aviso enviado a esa ruta interna. */
    buscar(ruta) {
      return avisos.find((a) => a.ruta === ruta);
    },
    /** Todos los avisos enviados a esa ruta. */
    todos(ruta) {
      return avisos.filter((a) => a.ruta === ruta);
    },
    clave: CLAVE_FALSA,
    restaurar() {
      globalThis.fetch = fetchOriginal;
      for (const [k, v] of Object.entries(envPrevio)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

/** Un socket-server caído: toda petición falla como si no hubiera nadie escuchando. */
function socketCaido() {
  return instalarFakeSocket(() => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:4001');
    err.name = 'TypeError';
    return err;
  });
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = { instalarFakeSocket, socketCaido, ES_UUID, URL_FALSA, CLAVE_FALSA };
