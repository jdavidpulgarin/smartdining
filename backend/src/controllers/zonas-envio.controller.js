/**
 * D-20a: las zonas de entrega para el ADMIN (/api/zonas-envio y
 * /api/v1/zonas-envio). Distinta de la pública /api/v1/zonas (D-19), que solo
 * muestra las activas a la app.
 *
 * Errores siempre `{ error, motivo }`:
 *   400 cuerpo_invalido | barrio_repetido
 *   404 no_encontrado
 *   409 zona_duplicada | barrio_en_otra_zona (con `barrio` y `zona`)
 */

const { z } = require('zod');
const zonasService = require('../services/zonas.service');
const { errorConMotivo } = require('../utils/error-con-motivo');

const MAX_TEXTO = 80;
const MAX_BARRIOS = 200;
/** NUMERIC(10,2): hasta 99.999.999,99. */
const MAX_COSTO = 99999999.99;

const largo = (s) => [...s].length;
const texto = () =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => largo(s) >= 1 && largo(s) <= MAX_TEXTO, `Debe tener entre 1 y ${MAX_TEXTO} caracteres`);

/** Pesos con hasta dos decimales (lo que guarda NUMERIC(10,2) sin redondear). */
const costo = z
  .number()
  .finite()
  .min(0)
  .max(MAX_COSTO)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'El costo admite hasta dos decimales');

const campos = {
  nombre: texto(),
  barrios: z.array(texto()).min(1, 'La zona necesita al menos un barrio').max(MAX_BARRIOS),
  costo_envio: costo,
  tiempo_estimado_min: z.number().int().min(1).max(600),
  activa: z.boolean(),
};

const esquemaCrear = z
  .object({ ...campos, activa: campos.activa.optional() })
  .strict();

const esquemaEditar = z
  .object(campos)
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Indica al menos un campo');

const responder400 = (res, error) => {
  const issue = error.errors[0];
  const donde = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return res.status(400).json({ error: `${donde}${issue.message}`, motivo: 'cuerpo_invalido' });
};

/** Entero positivo de la URL, o null. */
function idDeLaUrl(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) return null;
  const n = Number(valor);
  return n <= 2147483647 ? n : null;
}

const noEncontrada = () => errorConMotivo(404, 'no_encontrado', 'Zona no encontrada');

/** GET /zonas-envio: todas, también las inactivas. */
async function listar(req, res, next) {
  try {
    return res.json({ zonas: await zonasService.listarTodas() });
  } catch (err) {
    return next(err);
  }
}

/** POST /zonas-envio */
async function crear(req, res, next) {
  const r = esquemaCrear.safeParse(req.body);
  if (!r.success) return responder400(res, r.error);
  try {
    return res.status(201).json({ zona: await zonasService.crearZona(r.data) });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /zonas-envio/:id */
async function editar(req, res, next) {
  const id = idDeLaUrl(req.params.id);
  if (!id) return next(noEncontrada());
  const r = esquemaEditar.safeParse(req.body);
  if (!r.success) return responder400(res, r.error);
  try {
    const zona = await zonasService.actualizarZona(id, r.data);
    if (!zona) return next(noEncontrada());
    return res.json({ zona });
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, crear, editar };
