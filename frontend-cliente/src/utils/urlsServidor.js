/**
 * Resuelve las URLs de API y socket-server según el entorno y la ubicación del cliente.
 * Función pura para pruebas sin depender de window ni de variables globales.
 *
 * @param {object} [opciones]
 * @param {string} [opciones.apiEnv] - Valor de VITE_API_URL
 * @param {string} [opciones.socketEnv] - Valor de VITE_SOCKET_URL
 * @param {boolean} [opciones.esDev=false] - Indica si el entorno es desarrollo
 * @param {{ protocol?: string, hostname?: string }} [opciones.ubicacion] - Ubicación del cliente
 * @returns {{ api: string, socket: string|undefined }}
 */
export function resolverUrls({
  apiEnv,
  socketEnv,
  esDev = false,
  ubicacion = {},
} = {}) {
  const protoRaw = (ubicacion?.protocol || 'http:').trim();
  const protocol = protoRaw.endsWith(':') ? protoRaw : `${protoRaw}:`;
  const hostname = (ubicacion?.hostname || 'localhost').trim();

  let api;
  if (typeof apiEnv === 'string' && apiEnv.trim().length > 0) {
    api = apiEnv.trim().replace(/\/+$/, '');
  } else if (esDev) {
    api = `${protocol}//${hostname}:4000/api`;
  } else {
    api = 'http://localhost:4000/api';
  }

  let socket;
  if (typeof socketEnv === 'string' && socketEnv.trim().length > 0) {
    socket = socketEnv.trim().replace(/\/+$/, '');
  } else if (esDev) {
    socket = `${protocol}//${hostname}:4001`;
  } else {
    socket = undefined;
  }

  return {
    api,
    socket,
  };
}

/**
 * Función de conveniencia que resuelve las URLs usando import.meta.env y window.location.
 *
 * @returns {{ api: string, socket: string|undefined }}
 */
export function urlsServidor() {
  const ubicacion =
    typeof window !== 'undefined' && window.location
      ? {
          protocol: window.location.protocol,
          hostname: window.location.hostname,
        }
      : {
          protocol: 'http:',
          hostname: 'localhost',
        };

  return resolverUrls({
    apiEnv: import.meta.env?.VITE_API_URL,
    socketEnv: import.meta.env?.VITE_SOCKET_URL,
    esDev: Boolean(import.meta.env?.DEV),
    ubicacion,
  });
}

export default urlsServidor;
