const jwt = require('jsonwebtoken');

/**
 * Roles del personal del restaurante. Son los unicos valores que pueden
 * quedar guardados en usuarios.rol (ver docs/modelo-er.md).
 */
const ROLES_STAFF = ['admin', 'mesero', 'cajero', 'cocina'];

/**
 * Rol del comensal. NO existe en la tabla usuarios: solo vive dentro del JWT
 * que emite POST /api/mesas/qr/:token/sesion. Su payload es
 * { id_mesa, rol: 'comensal' } — no tiene id_usuario.
 */
const ROL_COMENSAL = 'comensal';

/**
 * Verifica el JWT enviado en el header Authorization: Bearer <token>.
 * Si es válido, adjunta el payload decodificado en req.user:
 *   - staff:    { id_usuario, rol }
 *   - comensal: { id_mesa, rol: 'comensal' }
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * RBAC: restringe el acceso a uno o varios roles.
 * Uso: requireRole('admin') o requireRole('comensal', 'mesero', 'admin')
 */
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user || !rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }
    next();
  };
}

/** true si el token corresponde a un comensal (sesión de mesa por QR). */
function esComensal(req) {
  return req.user?.rol === ROL_COMENSAL;
}

module.exports = { requireAuth, requireRole, esComensal, ROLES_STAFF, ROL_COMENSAL };
