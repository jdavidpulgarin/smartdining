/**
 * Enlace que se codifica en el QR de la mesa (el que abre el comensal).
 *
 * MODO RED LOCAL (solo con `NODE_ENV === 'development'` escrito en el entorno):
 * el host `localhost` del enlace se cambia por la IPv4 de la LAN, porque el
 * comensal escanea con su celular y para el celular `localhost` es él mismo. Si
 * no hay `FRONTEND_CLIENTE_URL`, el enlace se arma con la IP y el puerto del
 * cliente. Si no se detecta ninguna IP, queda igual que siempre.
 *
 * FUERA DE ESE MODO no cambia NADA: con 'production', 'test', vacío o ausente
 * el enlace se arma exactamente como antes de este módulo. Eso incluye el caso
 * de producción sin `FRONTEND_CLIENTE_URL`: ahí no se detecta ninguna IP ni se
 * toca el host. Un dominio real tampoco se toca nunca, ni en desarrollo: solo
 * se sustituye `localhost` y `127.0.0.1`.
 */

const { ipLocalConCache } = require('./ip-local');

/**
 * Puerto del cliente (frontend-cliente). El panel va en 5173 y el KDS en 5175.
 *
 * Antes el valor por defecto de FRONTEND_CLIENTE_URL era `localhost:5173`, que
 * es el puerto del PANEL: el enlace del QR llevaba al comensal a la pantalla de
 * administración. El cliente tiene puerto fijo propio (strictPort), así que
 * este es el único valor correcto.
 */
const PUERTO_CLIENTE = 5174;

/** Base del enlace cuando no hay FRONTEND_CLIENTE_URL. */
const BASE_POR_DEFECTO = `http://localhost:${PUERTO_CLIENTE}`;

/** Hosts que significan "esta misma máquina" y que un celular no puede abrir. */
const HOSTS_LOCALES = ['localhost', '127.0.0.1'];

/**
 * Regla de activación, la MISMA que el socket-server (origenes.js de Roberto):
 * `NODE_ENV` tiene que valer 'development' escrito en el entorno. Un valor por
 * omisión no activa nada, para que a un despliegue al que le falte la variable
 * no se le cambie el enlace ni se le abra el CORS.
 */
function enModoRedLocal(env = process.env) {
  return env.NODE_ENV === 'development';
}

/** Quita las barras finales, como hacía el controller. */
const sinBarraFinal = (base) => base.replace(/\/+$/, '');

/**
 * Cambia solo el host de una URL y conserva protocolo, puerto y path.
 * Devuelve null si la base no es una URL que se pueda analizar, para que el
 * llamador use el comportamiento de siempre en vez de reventar.
 */
function conOtroHost(base, host) {
  try {
    const u = new URL(base);
    if (!HOSTS_LOCALES.includes(u.hostname)) return null;
    u.hostname = host;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * @param {string} token Token QR vigente de la mesa.
 * @param {{env?: object, detectarIp?: Function}} opciones
 *   detectarIp: inyectable para las pruebas; por omisión la detección cacheada.
 * @returns {string} Enlace completo, con el token ya codificado.
 */
function urlDelComensal(token, { env = process.env, detectarIp = ipLocalConCache } = {}) {
  const configurada = String(env.FRONTEND_CLIENTE_URL || '').trim();
  const sufijo = `/?token=${encodeURIComponent(token)}`;

  if (!enModoRedLocal(env)) {
    return sinBarraFinal(configurada || BASE_POR_DEFECTO) + sufijo;
  }

  const ip = detectarIp({ env });

  // (c) Sin IP detectada: igual que hoy.
  if (!ip) return sinBarraFinal(configurada || BASE_POR_DEFECTO) + sufijo;

  // (b) Sin variable configurada: se arma con la IP y el puerto del cliente.
  if (!configurada) return `http://${ip}:${PUERTO_CLIENTE}` + sufijo;

  // (a) Con variable: solo se sustituye el host si es local. Un dominio real
  // se respeta, incluso en desarrollo (alguien puede estar apuntando a un
  // entorno de pruebas remoto a propósito).
  const conIp = conOtroHost(configurada, ip);
  return sinBarraFinal(conIp || configurada) + sufijo;
}

module.exports = {
  urlDelComensal,
  enModoRedLocal,
  PUERTO_CLIENTE,
  BASE_POR_DEFECTO,
  HOSTS_LOCALES,
};
