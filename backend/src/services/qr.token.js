/**
 * Lectura del token QR que emite el socket-server de Roberto.
 *
 * Formato (socket-server/src/qr.js): v1.<datos base64url>.<firma base64url>
 * y los datos son { m: id_mesa, iat, exp, sid }.
 *
 * Aquí SOLO se decodifica la parte de datos para leer el `sid`: no se verifica
 * la firma, porque eso es del socket-server (POST /qr/validar). El sid se usa
 * para atar el JWT del comensal al QR con el que entró, de modo que cuando la
 * mesa se libera y se genera otro QR, las sesiones del grupo anterior dejan de
 * servir aunque su JWT no haya expirado.
 */

const VERSION = 'v1';

/** Devuelve el sid del token, o null si el token no tiene la forma esperada. */
function extraerSid(token) {
  const datos = leerDatos(token);
  return datos && typeof datos.sid === 'string' ? datos.sid : null;
}

/** Devuelve el objeto de datos del token, o null si no se puede leer. */
function leerDatos(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== VERSION) return null;
  try {
    const json = Buffer.from(partes[1], 'base64url').toString('utf8');
    const datos = JSON.parse(json);
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : null;
  } catch {
    return null;
  }
}

module.exports = { extraerSid, leerDatos, VERSION };
