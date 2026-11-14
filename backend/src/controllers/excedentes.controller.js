const { z } = require('zod');
const excedentesService = require('../services/excedentes.service');
const { traducirAutorInexistente } = require('../services/autor-inexistente');

/**
 * Excedentes de pagos en línea de mesa para la Caja (T4, EVENTS.md §8.7):
 *   GET   /api/excedentes-pago-en-linea?estado=pendiente
 *   PATCH /api/excedentes-pago-en-linea/:id/devuelto
 * Roles: admin y cajero (los mismos que las demás rutas de cobro).
 */

const MOTIVO_CONSULTA_INVALIDA = 'consulta_invalida';
const MOTIVO_PARAMETRO_INVALIDO = 'parametro_invalido';
const MOTIVO_YA_DEVUELTO = 'ya_devuelto';

const consultaSchema = z
  .object({
    estado: z.enum(excedentesService.ESTADOS, {
      errorMap: () => ({ message: `estado debe ser uno de: ${excedentesService.ESTADOS.join(', ')}` }),
    }).default('pendiente'),
  })
  .strict();

const idSchema = z.object({
  id: z.string().regex(/^[1-9]\d{0,9}$/, 'id debe ser un entero mayor que 0').transform(Number)
    .refine((n) => n <= 2147483647, 'id fuera de rango'),
}).strict();

async function listar(req, res, next) {
  const parsed = consultaSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message, motivo: MOTIVO_CONSULTA_INVALIDA });
  }
  try {
    const excedentes = await excedentesService.listar(parsed.data);
    return res.json({ estado: parsed.data.estado, excedentes });
  } catch (err) {
    return next(err);
  }
}

async function marcarDevuelto(req, res, next) {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message, motivo: MOTIVO_PARAMETRO_INVALIDO });
  }
  try {
    const r = await excedentesService.marcarDevuelto(parsed.data.id, req.user.id_usuario);
    if (r.noExiste) return res.status(404).json({ error: 'Excedente no encontrado', motivo: 'no_encontrado' });
    if (r.yaDevuelto) {
      return res.status(409).json({
        error: 'Ese excedente ya estaba marcado como devuelto',
        motivo: MOTIVO_YA_DEVUELTO,
        excedente: r.excedente,
      });
    }
    return res.json({ excedente: r.excedente });
  } catch (err) {
    // El usuario del JWT ya no existe (fk_excedentes_devuelto_por): el 409
    // autor_inexistente de siempre.
    return next(traducirAutorInexistente(err) || err);
  }
}

module.exports = { listar, marcarDevuelto, MOTIVO_YA_DEVUELTO };
