const { z } = require('zod');
const pagosService = require('../services/pagos.service');
const { METODOS_PAGO, MONEDA } = require('./transacciones.controller');

/**
 * Cuerpo de POST /api/pagos/intentos-fallidos/interno (EVENTS.md §8.5).
 *
 * `monto_esperado_centavos` se valida pero no se guarda: la tabla no tiene esa
 * columna. Se acepta en el contrato porque en el motivo 'monto_distinto' es el
 * dato que explica la alerta, y rechazar el cuerpo por un campo que la base no
 * sabe guardar dejaría al socket-server sin poder reportar nada.
 */
const intentoFallidoSchema = z.object({
  referencia_externa: z.string().min(1).max(100),
  id_transaccion_pasarela: z.string().min(1),
  pasarela: z.string().max(20),
  id_mesa: z.number().int().positive(),
  motivo: z.string().min(1).max(200),
  monto_centavos: z.number().int().positive(),
  monto_esperado_centavos: z.number().int().positive().optional(),
  moneda: z.literal(MONEDA),
  metodo_pago: z.enum(METODOS_PAGO).default('online'),
});

/**
 * POST /api/pagos/intentos-fallidos/interno — bitácora de pagos rechazados.
 *
 * Responde 201 tanto si insertó como si era un reintento del mismo evento: para
 * el socket-server lo importante es que quedó registrado, y un 4xx lo haría
 * contestar 503 a Wompi y reintentar en balde.
 */
async function registrarIntentoFallido(req, res, next) {
  const parsed = intentoFallidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const { monto_esperado_centavos, ...intento } = parsed.data;
    await pagosService.registrarIntentoFallido(intento);
    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { registrarIntentoFallido };
