const jwt = require('jsonwebtoken');

const ROLES_PERSONAL = ['admin', 'mesero', 'cajero', 'cocina'];
const ROL_COMENSAL = 'comensal';

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
      return { rol: ROL_COMENSAL, id_mesa: p.id_mesa };
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
function autenticarSocket(secreto) {
  return (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('AUTH_REQUERIDA'));
    const identidad = verificarJwt(token, secreto);
    if (!identidad) return next(new Error('TOKEN_INVALIDO'));
    socket.data.identidad = identidad;
    next();
  };
}

module.exports = { verificarJwt, autenticarSocket, ROLES_PERSONAL, ROL_COMENSAL };
