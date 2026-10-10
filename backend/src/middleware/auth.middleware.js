const jwt = require('jsonwebtoken');
const mesasService = require('../services/mesas.service');
const { extraerSid } = require('../services/qr.token');

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
 *   - comensal: { id_mesa, sid, rol: 'comensal' }
 *
 * Para un comensal comprueba además que su sesión siga siendo la vigente de la
 * mesa. Va aquí, y no en cada controller, para que ninguna ruta pueda olvidarlo.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  req.user = payload;

  if (payload.rol !== ROL_COMENSAL) return next();

  try {
    if (!(await sesionDeMesaVigente(payload))) {
      return res.status(401).json({ error: MENSAJE_SESION_CERRADA });
    }
  } catch (err) {
    // Un fallo de base de datos no debe dejar pasar una sesión sin comprobar.
    return next(err);
  }

  return next();
}

const MENSAJE_SESION_CERRADA = 'Sesión de mesa cerrada, escanea el QR de nuevo';

/**
 * ¿El JWT de este comensal corresponde al QR que la mesa tiene ahora?
 *
 * El sid identifica al QR concreto con el que entró. Se compara contra el sid
 * del token_qr guardado en la mesa:
 *  - columna en NULL  -> la mesa se liberó, no hay sesión que valer.
 *  - sid distinto     -> se generó otro QR, este JWT es del grupo anterior.
 *
 * Así no hace falta esperar a que expire el JWT: en cuanto la mesa se cierra o
 * rota su QR, las sesiones viejas dejan de servir en la siguiente petición.
 */
async function sesionDeMesaVigente({ id_mesa, sid }) {
  if (!Number.isInteger(id_mesa) || typeof sid !== 'string' || !sid) return false;

  const tokenActual = await mesasService.tokenQrDeMesa(id_mesa);
  if (!tokenActual) return false;

  return extraerSid(tokenActual) === sid;
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

module.exports = {
  requireAuth,
  requireRole,
  esComensal,
  sesionDeMesaVigente,
  ROLES_STAFF,
  ROL_COMENSAL,
  MENSAJE_SESION_CERRADA,
};
