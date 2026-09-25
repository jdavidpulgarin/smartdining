const { z } = require('zod');
const categoriasService = require('../services/categorias.service');

// Columnas segun docs/modelo-er.md: orden_visualizacion (no "orden") y activo.
const categoriaSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  orden_visualizacion: z.number().int().optional(),
  activo: z.boolean().optional(),
});

async function listar(req, res, next) {
  try {
    const categorias = await categoriasService.listar();
    return res.json({ categorias });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const categoria = await categoriasService.obtenerPorId(req.params.id);
    if (!categoria) return res.status(404).json({ error: 'Categoría no encontrada' });
    return res.json(categoria);
  } catch (err) {
    return next(err);
  }
}

async function crear(req, res, next) {
  const parsed = categoriaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const categoria = await categoriasService.crear(parsed.data);
    return res.status(201).json(categoria);
  } catch (err) {
    return next(err);
  }
}

async function actualizar(req, res, next) {
  const parsed = categoriaSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const actual = await categoriasService.obtenerPorId(req.params.id);
    if (!actual) return res.status(404).json({ error: 'Categoría no encontrada' });

    const categoria = await categoriasService.actualizar(req.params.id, { ...actual, ...parsed.data });
    return res.json(categoria);
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const eliminada = await categoriasService.eliminar(req.params.id);
    if (!eliminada) return res.status(404).json({ error: 'Categoría no encontrada' });
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
