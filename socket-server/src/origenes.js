/**
 * Política de orígenes (CORS) para HTTP y para el handshake de Socket.io.
 *
 * Siempre: la lista blanca CORS_ORIGINS, tal cual.
 *
 * "Modo red local" (solo con NODE_ENV=development escrito en el entorno, no
 * con el valor por defecto): además se acepta un celular de la misma Wi-Fi
 * que abre el frontend de Vite por la IP de la máquina. Regla EXACTA:
 *
 *   http://  +  IPv4 privada (10/8, 172.16/12, 192.168/16)  +  :5173 | :5174 | :5175
 *
 * Nada más: ni https, ni otros puertos, ni hostnames, ni rutas. El origen se
 * refleja tal cual (nunca "*": hay credentials: true).
 */

const PUERTOS_VITE = new Set(['5173', '5174', '5175']);
// Octetos en decimal sin ceros a la izquierda ("010" no es 10 para todos).
const OCTETO = '(0|[1-9]\\d{0,2})';
const ORIGEN_IP = new RegExp(`^http://${OCTETO}\\.${OCTETO}\\.${OCTETO}\\.${OCTETO}:(\\d{4})$`);

/** true si a.b.c.d (números 0–255) está en 10/8, 172.16/12 o 192.168/16. */
function esIpPrivada([a, b]) {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** true si `origen` cumple exactamente la regla del modo red local. */
function esOrigenRedLocal(origen) {
  if (typeof origen !== 'string') return false;
  const m = ORIGEN_IP.exec(origen);
  if (!m) return false;
  const octetos = m.slice(1, 5).map(Number);
  if (octetos.some((o) => o > 255)) return false;
  return esIpPrivada(octetos) && PUERTOS_VITE.has(m[5]);
}

/**
 * Valor de `origin` para el paquete cors (HTTP) y para Socket.io.
 * Fuera del modo red local es la MISMA lista de siempre (comportamiento
 * idéntico); en modo red local, una función que acepta la lista o la regla.
 */
function crearOrigenCors({ origenes, redLocal }) {
  if (!redLocal) return origenes;
  return (origen, cb) => cb(null, origenes.includes(origen) || esOrigenRedLocal(origen));
}

module.exports = { crearOrigenCors, esOrigenRedLocal, PUERTOS_VITE };
