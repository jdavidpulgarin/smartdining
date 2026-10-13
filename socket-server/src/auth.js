const jwt = require('jsonwebtoken');

const ROLES_PERSONAL = ['admin', 'mesero', 'cajero', 'cocina'];
const ROL_COMENSAL = 'comensal';
// Pantalla fija montada en la mesa (tablet) que solo muestra su QR: no es un
// comensal (no pide ni carga carrito) ni personal (no ve otras mesas ni KDS).
const ROL_PANTALLA = 'pantalla';

/**
 * Verifica un JWT del backend y devuelve la identidad normalizada, o null si
 * es inválido/expirado. Se fija el algoritmo (HS256) para impedir el ataque
 * de "alg: none" o de cambio de algoritmo.
 */
function verificarJwt(token, secreto) {
  try {
    const p = jwt.verify(token, secreto, { algorithms: ['HS256'] });
    if (p.rol === ROL_COMENSAL || p.rol === ROL_PANTALLA) {
      if (!Number.isInteger(p.id_mesa)) return null;
      // iat permite saber si la sesión es anterior a la liberación de la mesa.
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
  verificarJwt, autenticarSocket, ROLES_PERSONAL, ROL_COMENSAL, ROL_PANTALLA,
};
