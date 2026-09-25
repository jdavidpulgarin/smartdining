const { z } = require('zod');
const platosService = require('../services/platos.service');

// Columnas segun docs/modelo-er.md: url_imagen (no "imagen_url"), id_categoria
// y tiempo_preparacion_estimado. El modelo no tiene personalizaciones.
const platoSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  precio: z.number().positive(),
  url_imagen: z.string().url().optional(),
  id_categoria: z.number().int(),
  disponible: z.boolean().optional(),
  tiempo_preparacion_estimado: z.number().int().positive().optional(),
});

async function listar(req, res, next) {
  try {
    const platos = await platosService.listar(req.query.id_categoria);
    return res.json({ platos });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const plato = await platosService.obtenerPorId(req.params.id);
    if (!plato) return res.status(404).json({ error: 'Plato no encontrado' });
    return res.json(plato);
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  const parsed = platoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const plato = await platosService.crear(parsed.data);
    return res.status(201).json(plato);
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  const parsed = platoSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const actual = await platosService.obtenerPorId(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Plato no encontrado' });

    const plato = await platosService.actualizar(req.params.id, { ...actual, ...parsed.data });
    return res.json(plato);
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const eliminado = await platosService.eliminar(req.params.id);
    if (!eliminado) return res.status(404).json({ error: 'Plato no encontrado' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
