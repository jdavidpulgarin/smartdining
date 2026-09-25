const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const usuariosService = require('../services/usuarios.service');
const { ROLES_STAFF } = require('../middleware/auth.middleware');

// Solo se registran usuarios del personal: admin, mesero, cajero, cocina.
// El comensal NO se registra — obtiene su sesión escaneando el QR de la mesa
// (POST /api/mesas/qr/:token/sesion) y su rol solo existe dentro del JWT.
// La tabla usuarios no tiene telefono (ver docs/modelo-er.md).
const registerSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  rol: z.enum(ROLES_STAFF),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

function firmarTokenStaff(usuario) {
  return jwt.sign(
    { id_usuario: usuario.id_usuario, rol: usuario.rol },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

/**
 * POST /api/auth/register — solo un admin autenticado puede crear usuarios
 * (la restricción de rol se aplica en las rutas, ver auth.routes.js).
 */
async function register(req, res, next) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { nombre, email, password, rol } = parsed.data;

  try {
    const existente = await usuariosService.buscarPorEmail(email);
    if (existente) {
      return res.status(400).json({ error: 'Ese email ya está registrado' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const usuario = await usuariosService.crear({ nombre, email, password_hash, rol });

    return res.status(201).json({ usuario });
  } catch (err) {
    return next(err);
  }
}

async function login(req, res, next) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }
  const { email, password } = parsed.data;

  try {
    const usuario = await usuariosService.buscarPorEmail(email);
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (!usuario.activo) {
      return res.status(403).json({ error: 'Usuario inactivo' });
    }

    const passwordOk = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    return res.json({
      usuario: {
        id_usuario: usuario.id_usuario,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      },
      token: firmarTokenStaff(usuario),
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login };
