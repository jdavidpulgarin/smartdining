const jwt = require('jsonwebtoken');

const ROLES_PERSONAL = ['admin', 'mesero', 'cajero', 'cocina'];
const ROL_COMENSAL = 'comensal';
// Pantalla fija montada en la mesa (tablet) que solo muestra su QR: no es un
// comensal (no pide ni carga carrito) ni personal (no ve otras mesas ni KDS).
const ROL_PANTALLA = 'pantalla';
const MAX_ALIAS = 40;

/**
 * Alias del comensal tal como viene FIRMADO en su JWT (lo pone el backend al
 * abrir la sesión, único en la mesa). Es la única fuente del alias: el que
 * mande el cliente en un evento solo puede coincidir con este.
 */
function aliasDelJwt(p) {
  if (typeof p.comensal !== 'string') return null;
  const alias = p.comensal.trim();
  return alias && alias.length <= MAX_ALIAS ? alias : null;
}

/**
 * Verifica un JWT del backend y devuelve la identidad normalizada, o null si
 * es inválido/expirado. Se fija el algoritmo (HS256) para impedir el ataque
 * de "alg: none" o de cambio de algoritmo.
 */
function verificarJwt(token, secreto) {
  try {
    const p = jwt.verify(token, secreto, { algorithms: ['HS256'] });
    if (p.rol === ROL_COMENSAL) {
      if (!Number.isInteger(p.id_mesa)) return null;
      // Un JWT de comensal sin alias es de antes de que el backend lo firmara:
      // se trata como inválido para obligar a pedir una sesión nueva, en vez de
      // volver a creerle al cliente el alias de cada evento.
      const comensal = aliasDelJwt(p);
      if (!comensal) return null;
      // iat permite saber si la sesión es anterior a la liberación de la mesa.
      return { rol: p.rol, id_mesa: p.id_mesa, iat: p.iat, comensal };
    }
    if (p.rol === ROL_PANTALLA) {
      if (!Number.isInteger(p.id_mesa)) return null;
      return { rol: p.rol, id_mesa: p.id_mesa, iat: p.iat };
    }
    if (ROLES_PERSONAL.includes(p.rol)) {
      return { rol: p.rol, id_usuario: p.id_usuario };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * ¿Es un JWT de comensal bien firmado y vigente, pero SIN alias (sesión
 * antigua)? Sirve para responder TOKEN_INVALIDO por HTTP y que el cliente
 * sepa que debe abrir una sesión nueva, no que le falta permiso.
 */
function esComensalSinAlias(token, secreto) {
  try {
    const p = jwt.verify(token, secreto, { algorithms: ['HS256'] });
    return p.rol === ROL_COMENSAL && Number.isInteger(p.id_mesa) && !aliasDelJwt(p);
  } catch {
    return false;
  }
}

/**
 * Middleware de Socket.io: sin JWT válido no hay conexión. Se valida en el
 * handshake (y no en un evento posterior) para que un socket anónimo nunca
 * llegue a estar dentro de ninguna sala.
 */
function autenticarSocket(secreto, { sesionVigente = () => true } = {}) {
  return (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_REQUERIDA'));
    const identidad = verificarJwt(token, secreto);
    // Un comensal del grupo anterior conserva un JWT vigente (3 h) después de
    // que la mesa se libera: sin esta comprobación podría reconectarse y ver
    // el carrito del grupo siguiente. Se responde TOKEN_INVALIDO, igual que un
    // JWT vencido, para que el cliente pida sesión nueva (y el backend lo
    // mande a escanear el QR actual).
    if (!identidad) return next(new Error('TOKEN_INVALIDO'));
    Promise.resolve(sesionVigente(identidad)).then((vigente) => {
      if (!vigente) return next(new Error('TOKEN_INVALIDO'));
      socket.data.identidad = identidad;
      return next();
    }, () => {
      // No se pudo comprobar (Redis caído): se rechaza en vez de dejar pasar
      // una sesión que podría ser de un grupo anterior.
      next(new Error('ERROR_INTERNO'));
    });
  };
}

module.exports = {
  verificarJwt, esComensalSinAlias, autenticarSocket, ROLES_PERSONAL, ROL_COMENSAL, ROL_PANTALLA, MAX_ALIAS,
};
