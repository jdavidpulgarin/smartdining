/**
 * Orígenes permitidos para CORS (H-10).
 *
 * Antes se usaba `cors()` sin argumentos, que responde
 * `Access-Control-Allow-Origin: *`: cualquier página de internet podía llamar a
 * la API desde el navegador de un empleado con sesión abierta.
 *
 * La lista viene de `CORS_ORIGINS` (separada por comas). En **producción** es
 * obligatoria: si falta, no se permite ningún origen cruzado, porque un
 * despliegue sin configurar debe quedarse corto, no abierto. En desarrollo y en
 * pruebas se usan los tres puertos locales de los frontends, para que nadie
 * tenga que configurar nada para trabajar.
 */

const { esIpv4Privada, partirIpv4 } = require('../utils/ip-local');

/** Puertos de Vite de los tres frontends (restaurante, cliente, KDS). */
const ORIGENES_LOCALES = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

/** Los mismos tres puertos, para la regla del modo red local. */
const PUERTOS_VITE = new Set(['5173', '5174', '5175']);

/**
 * Regla de activación del MODO RED LOCAL, la misma que el socket-server
 * (socket-server/src/origenes.js): `NODE_ENV` tiene que valer 'development'
 * escrito en el entorno. No vale un valor por omisión, para que a un despliegue
 * al que le falte la variable no se le abra el CORS a toda la red.
 */
function enModoRedLocal(env = process.env) {
  return env.NODE_ENV === 'development';
}

/**
 * true si `origen` es exactamente un frontend de Vite abierto por la IP de la
 * LAN: `http://` + IPv4 privada (10/8, 172.16/12, 192.168/16) + :5173|:5174|:5175.
 *
 * Nada más: ni https, ni otro puerto, ni un hostname que se parezca, ni una
 * ruta, ni usuario en la URL, ni barra final. Se decide sobre la cadena CRUDA
 * con un patrón anclado, no con `new URL`, por lo mismo que el resto de la
 * lista se compara letra por letra: `new URL` normaliza (acepta la barra final,
 * el host en mayúsculas) y esas variantes no son orígenes que manda un
 * navegador, así que aceptarlas solo ensancharía la regla.
 *
 * Así, `http://192.168.1.57.evil.com:5174` no cumple el patrón (el host no es
 * una IPv4) y `http://192.168.1.57:5174/algo` tampoco (sobra la ruta).
 */
const ORIGEN_RED_LOCAL = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{4})$/;

function esOrigenRedLocal(origen) {
  if (typeof origen !== 'string') return false;

  const m = ORIGEN_RED_LOCAL.exec(origen);
  if (!m) return false;

  const [, ip, puerto] = m;
  // partirIpv4 exige 0–255 y sin ceros a la izquierda.
  return Boolean(partirIpv4(ip)) && esIpv4Privada(ip) && PUERTOS_VITE.has(puerto);
}

/** CORS_ORIGINS troceada: sin espacios y sin entradas vacías. */
function listaDe(env) {
  return String(env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Lista de orígenes permitidos según el entorno. */
function origenesPermitidos(env = process.env) {
  const configurados = listaDe(env);

  if (configurados.length > 0) return configurados;
  if (env.NODE_ENV === 'production') return [];
  return ORIGENES_LOCALES;
}

/**
 * Opciones para el middleware `cors`.
 *
 * `credentials` se queda **fuera** a propósito: el backend autentica con
 * `Authorization: Bearer`, no con cookies, así que no hace falta y activarlo
 * obligaría a no poder usar comodines nunca más.
 *
 * Una petición **sin** cabecera `Origin` (curl, el socket-server, una prueba)
 * se deja pasar: CORS es una protección del navegador y esas peticiones no
 * vienen de uno. Lo que decide el acceso en esos casos es el JWT o la clave
 * interna, no esta lista.
 *
 * MODO RED LOCAL: con `NODE_ENV=development` **y** sin `CORS_ORIGINS`, además
 * de los tres localhost se acepta la regla de `esOrigenRedLocal`, que es lo que
 * deja a un celular de la misma Wi-Fi llamar a la API tras abrir el cliente por
 * la IP de la máquina. Si `CORS_ORIGINS` está configurado manda esa lista y no
 * se amplía nada: quien la escribió sabe lo que quiere permitir.
 */
function opcionesCors(env = process.env) {
  const permitidos = origenesPermitidos(env);
  // Se mide igual que en origenesPermitidos: una lista de solo comas y
  // espacios no es una lista, y ahí el modo sí debe poder activarse.
  const redLocal = enModoRedLocal(env) && listaDe(env).length === 0;

  return {
    origin(origen, callback) {
      if (!origen) return callback(null, true);
      if (permitidos.includes(origen)) return callback(null, true);
      return callback(null, redLocal && esOrigenRedLocal(origen));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
  };
}

module.exports = {
  opcionesCors,
  origenesPermitidos,
  ORIGENES_LOCALES,
  esOrigenRedLocal,
  enModoRedLocal,
  PUERTOS_VITE,
};
