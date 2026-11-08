const { z } = require('zod');
const reportesService = require('../services/reportes.service');

/**
 * Reportes del panel (D-07): GET /api/reportes?rango=hoy|semana|mes
 *
 * Solo de `admin`: son cifras de negocio (ventas, ticket promedio, reparto por
 * método de pago). El resto del personal recibe 403.
 *
 * Es la primera validación de QUERY del backend; sigue el mismo criterio que
 * los bodies: zod, y el primer mensaje de error tal cual.
 */

/**
 * `rango` con default, así que `GET /api/reportes` sin query es válido y
 * devuelve el día de hoy, que es lo que pide el panel (obtenerReporte('hoy')).
 *
 * Mensaje propio en vez del de zod: el de serie dice "Invalid enum value.
 * Expected 'hoy' | 'semana' | 'mes', received 'ayer'", que es correcto pero no
 * está escrito para leerse.
 */
const consultaSchema = z.object({
  rango: z
    .enum(reportesService.RANGOS, { message: 'rango debe ser hoy, semana o mes' })
    .default('hoy'),
});

async function obtener(req, res, next) {
  // Solo se mira `rango`: un query con parámetros de más se ignora, igual que
  // el resto de la API hace con las claves extra del cuerpo.
  const parsed = consultaSchema.safeParse({ rango: req.query.rango });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message });
  }

  try {
    const { reporte } = await reportesService.obtenerReporte(parsed.data.rango);
    return res.json(reporte);
  } catch (err) {
    return next(err);
  }
}

module.exports = { obtener, consultaSchema };
