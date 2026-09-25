const jwt = require('jsonwebtoken');
const { z } = require('zod');
const mesasService = require('../services/mesas.service');
const { ROL_COMENSAL } = require('../middleware/auth.middleware');

// Vigencia de la sesión del comensal: una estadía en la mesa (3 h por defecto).
const COMENSAL_EXPIRES_IN = process.env.JWT_COMENSAL_EXPIRES_IN || '3h';

const mesaSchema = z.object({
  numero: z.number().int().positive(),
  capacidad: z.number().int().positive().optional(),
  ubicacion: z.string().optional(),
  estado: z.enum(mesasService.ESTADOS_MESA).optional(),
  token_qr: z.string().optional(),
});

async function listar(req, res, next) {
  try {
    const mesas = await mesasService.listar();
    return res.json({ mesas });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const mesa = await mesasService.obtenerPorId(req.params.id);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(mesa);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/mesas/qr/:token — usado por frontend-cliente al escanear el QR.
 * Solo confirma que el token corresponde a una mesa; no emite sesión.
 *
 * NOTA/pendiente de coordinar con Roberto: la vigencia real (TTL) del token QR
 * vive en Redis, del lado del socket-server — falta acordar si ese chequeo se
 * hace aquí (consultando Redis desde el backend) o si el backend confía en que
 * Roberto ya validó el token antes de que la PWA llegue aquí.
 */
async function obtenerPorToken(req, res, next) {
  try {
    const mesa = await mesasService.obtenerPorToken(req.params.token);
    if (!mesa) return res.status(404).json({ error: 'Token de mesa inválido' });
    return res.json(mesa);
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/mesas/qr/:token/sesion — punto de entrada del comensal.
 *
 * Valida que el token_qr exista en la tabla mesas y emite un JWT
 * { id_mesa, rol: 'comensal' } con 3 h de vigencia. El rol 'comensal' NO
 * existe en la tabla usuarios: la sesión pertenece a la mesa, no a una
 * persona, y es la que autoriza POST /api/pedidos y GET /api/pedidos/mesa.
 */
async function crearSesionPorToken(req, res, next) {
  try {
    const mesa = await mesasService.obtenerPorToken(req.params.token);
    if (!mesa) return res.status(404).json({ error: 'Token de mesa inválido' });

    const token = jwt.sign(
      { id_mesa: mesa.id_mesa, rol: ROL_COMENSAL },
      process.env.JWT_SECRET,
      { expiresIn: COMENSAL_EXPIRES_IN }
    );

    return res.status(201).json({
      token,
      expira_en: COMENSAL_EXPIRES_IN,
      mesa: {
        id_mesa: mesa.id_mesa,
        numero: mesa.numero,
        capacidad: mesa.capacidad,
        ubicacion: mesa.ubicacion,
        estado: mesa.estado,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  const parsed = mesaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const mesa = await mesasService.crear(parsed.data);
    return res.status(201).json(mesa);
  } catch (err) {
    return next(err);
  }
}

async function actualizarEstado(req, res, next) {
  const parsed = mesaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const mesa = await mesasService.actualizarEstado(req.params.id, parsed.data.estado);
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(mesa);
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const eliminada = await mesasService.eliminar(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listar,
  obtener,
  obtenerPorToken,
  crearSesionPorToken,
  crear,
  actualizarEstado,
  eliminar,
};
