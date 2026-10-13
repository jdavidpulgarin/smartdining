const net = require('node:net');

/**
 * IP real del cliente detrás de Nginx.
 *
 * Detrás del proxy, req.socket.remoteAddress es SIEMPRE la IP de Nginx: los
 * logs no sirven para rastrear un abuso y cualquier límite por IP metería a
 * todos los clientes en el mismo saco. Nginx fija X-Real-IP con
 * `proxy_set_header X-Real-IP $remote_addr` (infra/nginx/snippets/proxy.conf),
 * que REEMPLAZA lo que haya mandado el cliente.
 *
 * Pero esa cabecera la puede escribir cualquiera que llegue directo al
 * servicio. Por eso solo se cree si la conexión viene de una IP listada en
 * TRUST_PROXY (la de Nginx en la red interna de Docker). Sin TRUST_PROXY, o
 * desde cualquier otra IP, se usa la dirección de la conexión y la cabecera
 * se ignora.
 *
 * Se usa X-Real-IP y no X-Forwarded-For: este último lo ENCADENA Nginx al
 * valor que trae el cliente, y elegir bien el elemento depende de cuántos
 * proxies haya; X-Real-IP es un solo valor que puso nuestro proxy.
 */

// Una IPv4 que llega por un socket IPv6 se ve como ::ffff:1.2.3.4.
const normalizar = (ip) => {
  const t = String(ip || '').trim();
  return t.toLowerCase().startsWith('::ffff:') && net.isIPv4(t.slice(7)) ? t.slice(7) : t;
};

const familia = (ip) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');

/**
 * TRUST_PROXY: IPs o rangos CIDR separados por comas (p. ej. "172.31.250.10"
 * o "10.0.0.0/24, fd00::/64"). Vacío = no se confía en ningún proxy.
 * Devuelve un net.BlockList o null. Lanza si algo no es válido: una lista
 * mal escrita no debe convertirse en silencio en "confiar en nadie" ni, peor,
 * en "confiar en todos".
 */
function parsearProxiesConfiables(valor) {
  const entradas = String(valor || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (entradas.length === 0) return null;
  const lista = new net.BlockList();
  for (const entrada of entradas) {
    const [dir, prefijo, sobra] = entrada.split('/');
    const ip = normalizar(dir);
    const tipo = net.isIP(ip);
    const invalida = new Error(`TRUST_PROXY: "${entrada}" no es una IP ni un rango CIDR válido`);
    if (!tipo || sobra !== undefined) throw invalida;
    if (prefijo === undefined) {
      lista.addAddress(ip, familia(ip));
      continue;
    }
    const n = /^\d{1,3}$/.test(prefijo) ? Number(prefijo) : NaN;
    if (!(n <= (tipo === 4 ? 32 : 128))) throw invalida;
    // /0 es "cualquier IP": dejaría a cualquiera elegir su IP con una cabecera.
    if (n === 0) throw new Error(`TRUST_PROXY: "${entrada}" confía en todo Internet; usa la IP del proxy`);
    lista.addSubnet(ip, n, familia(ip));
  }
  return lista;
}

/**
 * Devuelve ipCliente(req) para peticiones HTTP y para el handshake de
 * Socket.io (socket.request). `confiables` es lo que da
 * parsearProxiesConfiables (null = no hay proxy de confianza).
 */
function crearIpCliente(confiables) {
  return function ipCliente(req) {
    const directa = normalizar(req && req.socket && req.socket.remoteAddress);
    if (!confiables || !net.isIP(directa) || !confiables.check(directa, familia(directa))) {
      return directa || null;
    }
    // Si llegó repetida, Node la une con ", " y deja de ser una IP: se ignora.
    const cabecera = req.headers && req.headers['x-real-ip'];
    const real = typeof cabecera === 'string' ? normalizar(cabecera) : '';
    return net.isIP(real) ? real : directa;
  };
}

module.exports = { parsearProxiesConfiables, crearIpCliente };
