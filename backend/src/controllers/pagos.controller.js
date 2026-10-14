const { z } = require('zod');
const pagosService = require('../services/pagos.service');
const { METODOS_PAGO } = require('./transacciones.controller');

/**
 * Cuerpo de POST /api/pagos/intentos-fallidos/interno (EVENTS.md §8.5).
 *
 * El esquema es DELIBERADAMENTE tolerante. Esto es una bitácora de alertas, no
 * un cobro: lo peor que puede pasar es perder el registro de un pago
 * sospechoso. Y perderlo es exactamente lo que ocurre con un 400, porque el
 * socket-server solo reintenta ante 5xx o error de red; un 4xx lo da por
 * resuelto y la alerta no vuelve nunca.
 *
 * Por eso casi todo es opcional y lo único imprescindible es lo que identifica
 * el intento (`referencia_externa`, `id_transaccion_pasarela`) y por qué se
 * rechazó (`motivo`, que va a `razon_rechazo`, la única columna NOT NULL además
 * de las que pone la base). Lo que no se pueda guardar se guarda como NULL.
 */
const intentoFallidoSchema = z.object({
  referencia_externa: z.string().min(1).max(100),
  id_transaccion_pasarela: z.string().min(1).max(100),

  // Opcional: la tabla la admite NULL y una referencia desconocida puede no
  // traer pasarela identificada.
  pasarela: z.string().max(20).nullish(),

  // Nullable Y opcional: el socket-server manda null cuando la referencia no
  // corresponde a ninguna mesa conocida (motivo 'referencia_desconocida').
  id_mesa: z.number().int().positive().nullish(),

  motivo: z.string().min(1).max(200),

  // Nullish: puede faltar cuando la pasarela no informó monto. Si llega 0 o
  // negativo tampoco sirve: la CHECK de la tabla exige monto > 0, así que el
  // service lo convierte en NULL (ver normalizarMonto).
  monto_centavos: z.number().int().nullish(),

  // Se valida pero NO se guarda: la tabla no tiene columna para él. Se acepta
  // porque en el motivo 'monto_distinto' es el dato que explica la alerta.
  monto_esperado_centavos: z.number().int().nullish(),

  // La moneda NO se restringe a COP: si Wompi reporta otra, el intento es
  // justamente lo que hay que registrar (motivo 'moneda_distinta'). La columna
  // es VARCHAR(3), de ahí el tope, y se normaliza a mayúsculas para que 'usd' y
  // 'USD' no queden como dos monedas distintas en la bitácora.
  moneda: z
    .string()
    .trim()
    .min(1)
    .max(3)
    .transform((valor) => valor.toUpperCase())
    .nullish(),

  metodo_pago: z.enum(METODOS_PAGO).default('online'),
});

/**
 * El monto que se puede guardar, o null.
 *
 * `intentos_pago_fallidos.monto` tiene CHECK (monto > 0): un 0 reventaría el
 * INSERT y se perdería la alerta. Un monto ausente, cero o negativo se guarda
 * como NULL, que es la forma honesta de decir "la pasarela no informó un monto
 * utilizable"; el motivo sigue explicando qué pasó.
 */
function normalizarMonto(centavos) {
  if (typeof centavos !== 'number' || !Number.isFinite(centavos) || centavos <= 0) return null;
  return centavos;
}

/**
 * POST /api/pagos/intentos-fallidos/interno — bitácora de pagos rechazados.
 *
 * Responde 201 tanto si insertó como si era un reintento del mismo evento: para
 * el socket-server lo importante es que quedó registrado.
 */
async function registrarIntentoFallido(req, res, next) {
  const parsed = intentoFallidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const { monto_esperado_centavos, ...intento } = parsed.data;

    await pagosService.registrarIntentoFallido({
      ...intento,
      pasarela: intento.pasarela ?? null,
      id_mesa: intento.id_mesa ?? null,
      moneda: intento.moneda ?? null,
      monto_centavos: normalizarMonto(intento.monto_centavos),
    });

    return res.status(201).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

module.exports = { registrarIntentoFallido, normalizarMonto };
