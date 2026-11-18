/**
 * Detección de la IPv4 de la red local (LAN) de esta máquina.
 *
 * Para qué: el comensal entra escaneando un QR desde su celular, y un celular
 * no sabe qué es `localhost`. En desarrollo el enlace del QR tiene que llevar
 * la IP de la Wi-Fi de quien está probando, que cambia de casa en casa y de día
 * en día (DHCP), así que no sirve dejarla escrita en ninguna parte.
 *
 * Esto es SOLO para desarrollo: quien decide si se usa es la regla de
 * activación (`NODE_ENV === 'development'`), no este módulo. Aquí no se mira el
 * entorno más que para `HOST_LAN_IP`.
 *
 * Todo entra por parámetro (`interfaces`, `env`) para poder probarlo sin
 * depender de la máquina que corra la suite: en el CI no hay Wi-Fi, y en el
 * portátil de cada uno las interfaces son distintas.
 */

const os = require('os');

/**
 * Adaptadores que NO son la red local aunque tengan una IP privada: máquinas
 * virtuales, contenedores y redes superpuestas. Si se cuela una de estas, el QR
 * lleva una IP que el celular no puede alcanzar y el comensal ve un error de
 * conexión sin ninguna pista de por qué.
 *
 * Se compara por nombre de interfaz en minúsculas y por inclusión, porque
 * Windows los nombra con adornos ("vEthernet (WSL (Hyper-V firewall))",
 * "VirtualBox Host-Only Network #2").
 */
const NOMBRES_VIRTUALES = [
  'vethernet',
  'wsl',
  'docker',
  'virtualbox',
  'vmware',
  'hyper-v',
  'loopback',
  'tailscale',
  'zerotier',
  'vpn',
];

/** Prioridad por rango: la Wi-Fi de casa es casi siempre 192.168. */
const PRIORIDAD = { '192.168': 0, '10': 1, '172': 2 };

/** true si a.b.c.d está en 10/8, 172.16/12 o 192.168/16. */
function esIpv4Privada(ip) {
  const octetos = partirIpv4(ip);
  if (!octetos) return false;
  const [a, b] = octetos;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Parte una IPv4 en sus cuatro octetos, o null si no lo es.
 *
 * Estricto a propósito: cuatro grupos de dígitos, 0–255 y **sin ceros a la
 * izquierda**. "010.1.1.1" se rechaza porque no todo el mundo lo lee como 10
 * (hay bibliotecas que lo interpretan en octal), y una IP que se lee de dos
 * formas distintas no sirve para decidir nada.
 */
function partirIpv4(valor) {
  if (typeof valor !== 'string') return null;
  const partes = valor.trim().split('.');
  if (partes.length !== 4) return null;

  const octetos = [];
  for (const parte of partes) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parte)) return null;
    const n = Number(parte);
    if (n > 255) return null;
    octetos.push(n);
  }
  return octetos;
}

/** true si el nombre del adaptador es de una red virtual. */
function esAdaptadorVirtual(nombre) {
  const n = String(nombre).toLowerCase();
  return NOMBRES_VIRTUALES.some((marca) => n.includes(marca));
}

/** Rango al que pertenece la IP, para ordenar candidatas. */
function rangoDe(ip) {
  const [a, b] = partirIpv4(ip);
  if (a === 192 && b === 168) return '192.168';
  if (a === 10) return '10';
  return '172';
}

/**
 * IPv4 privada de la red local, o null si no hay ninguna.
 *
 * `HOST_LAN_IP` manda: es la salida para una máquina con varias tarjetas donde
 * la heurística elige la que no es, o para fijar la IP en una demo. Si lo que
 * trae no es una IPv4 válida se IGNORA con un aviso, en vez de armar un enlace
 * roto en silencio; el aviso no imprime el valor, que podría venir de un
 * entorno con datos que no son nuestros.
 *
 * @param {{interfaces?: object, env?: object, log?: Function}} opciones
 *   interfaces: lo que devuelve os.networkInterfaces() (inyectable para probar).
 * @returns {string|null}
 */
function detectarIpLocal({ interfaces, env = process.env, log = console.warn } = {}) {
  const forzada = (env.HOST_LAN_IP || '').trim();
  if (forzada) {
    if (partirIpv4(forzada)) return forzada;
    log('[red-local] HOST_LAN_IP no es una IPv4 valida; se ignora y se detecta la IP sola');
  }

  const tarjetas = interfaces || os.networkInterfaces();
  const candidatas = [];

  for (const [nombre, direcciones] of Object.entries(tarjetas || {})) {
    if (!Array.isArray(direcciones) || esAdaptadorVirtual(nombre)) continue;

    for (const dir of direcciones) {
      if (!dir || dir.internal) continue;
      // `family` es 'IPv4' en Node 18+ y 4 en algunas versiones/plataformas.
      const esV4 = dir.family === 'IPv4' || dir.family === 4;
      if (!esV4) continue;
      if (!esIpv4Privada(dir.address)) continue;
      candidatas.push(dir.address);
    }
  }

  if (candidatas.length === 0) return null;

  // Orden estable: primero por rango, y a igualdad la primera que apareció, que
  // es el orden en que el sistema lista los adaptadores.
  candidatas.sort((a, b) => PRIORIDAD[rangoDe(a)] - PRIORIDAD[rangoDe(b)]);
  return candidatas[0];
}

/** Cuánto vale una detección antes de volver a preguntar al sistema. */
const TTL_CACHE_MS = 30 * 1000;

let cache = { ip: null, hasta: 0 };

/**
 * Igual que detectarIpLocal, con una caché de 30 s.
 *
 * Se llama por petición (el enlace del QR se arma al abrir o rotar la mesa), y
 * recorrer las tarjetas en cada una es gasto para un dato que no cambia tan
 * rápido. Pero caducar en 30 s importa: si alguien cambia de Wi-Fi o el DHCP le
 * da otra IP, el QR siguiente ya sale bien **sin reiniciar el backend**, que es
 * justo lo que hacía perder el tiempo antes.
 *
 * `opciones.interfaces` salta la caché: si una prueba inyecta tarjetas, quiere
 * una respuesta sobre ESAS tarjetas, no la que quedó guardada. Lo demás (entre
 * ello HOST_LAN_IP) sí se cachea, porque tampoco cambia dentro de la ventana.
 */
function ipLocalConCache(opciones = {}) {
  if (opciones.interfaces) return detectarIpLocal(opciones);

  const ahora = Date.now();
  if (ahora < cache.hasta) return cache.ip;

  const ip = detectarIpLocal(opciones);
  cache = { ip, hasta: ahora + TTL_CACHE_MS };
  return ip;
}

/** Vacía la caché. Para las pruebas; en producción nadie la llama. */
function olvidarCache() {
  cache = { ip: null, hasta: 0 };
}

module.exports = {
  detectarIpLocal,
  ipLocalConCache,
  olvidarCache,
  esIpv4Privada,
  partirIpv4,
  esAdaptadorVirtual,
  NOMBRES_VIRTUALES,
  TTL_CACHE_MS,
};
