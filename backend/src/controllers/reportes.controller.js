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

/* -------------------------------------------------------------------------- *
 * GET /api/reportes/consumo — consumo de inventario (plan v1.1, D-17 P3)
 * -------------------------------------------------------------------------- */

// La misma validación de fechas que GET /transacciones?desde= (#158).
const { fechaExiste, MOTIVO_CONSULTA_INVALIDA } = require('./transacciones.controller');

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 24 * 60 * 60 * 1000;

const fechaDeConsulta = (nombre) => z
  .string({ required_error: `${nombre} es obligatorio: una fecha AAAA-MM-DD` })
  .superRefine((valor, ctx) => {
    if (!FORMATO_FECHA.test(valor)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${nombre} debe ser una fecha AAAA-MM-DD` });
    } else if (!fechaExiste(valor)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La fecha ${valor} no existe` });
    }
  });

/** Días entre dos fechas AAAA-MM-DD ya válidas, contando las dos. */
const diasDelRango = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS) + 1;

/**
 * Query de GET /reportes/consumo. `.strict()`: cualquier otro parámetro es 400.
 * Si `hasta` es futura lo decide la base, con el "hoy de Bogotá" de la consulta.
 */
const consumoSchema = z
  .object({
    desde: fechaDeConsulta('desde'),
    hasta: fechaDeConsulta('hasta'),
    id_insumo: z
      .string()
      .regex(/^[1-9]\d{0,9}$/, 'id_insumo debe ser un entero mayor que 0')
      .transform(Number)
      .refine((n) => n <= 2147483647, 'id_insumo fuera de rango')
      .optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.hasta < q.desde) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'hasta no puede ser anterior a desde' });
    } else if (diasDelRango(q.desde, q.hasta) > reportesService.DIAS_MAXIMOS_CONSUMO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El rango admite como mucho ${reportesService.DIAS_MAXIMOS_CONSUMO} días`,
      });
    }
  });

/**
 * GET /api/reportes/consumo?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&id_insumo=N]
 * Solo admin. Consumo, merma, entradas y ajustes por insumo y por día de
 * Bogotá; ver reportesService.consumoInventario.
 */
async function consumo(req, res, next) {
  const parsed = consumoSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message, motivo: MOTIVO_CONSULTA_INVALIDA });
  }

  try {
    const r = await reportesService.consumoInventario({
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
      idInsumo: parsed.data.id_insumo ?? null,
    });
    if (r.invalido) {
      return res.status(400).json({
        error: `hasta no puede ser posterior a hoy (${r.hoy}, hora de Bogotá)`,
        motivo: MOTIVO_CONSULTA_INVALIDA,
      });
    }
    if (r.insumoNoExiste) return res.status(404).json({ error: 'Insumo no encontrado', motivo: 'no_encontrado' });
    return res.json(r);
  } catch (err) {
    return next(err);
  }
}

module.exports = { obtener, consultaSchema, consumo, consumoSchema };
