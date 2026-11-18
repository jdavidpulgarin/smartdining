const { z } = require('zod');
const configuracionService = require('../services/configuracion.service');

/**
 * Configuración del restaurante (D-16 parte B).
 *
 * Dos lecturas a propósito:
 *   - `GET /api/configuracion` es PÚBLICA y devuelve solo una LISTA BLANCA. La
 *     PWA del comensal necesita el nombre, el horario, la moneda y la propina
 *     sugerida antes de tener sesión, así que la ruta no puede pedir login.
 *   - `GET /api/configuracion/completa` es de `admin` y añade `actualizado_en` y
 *     `actualizado_por`, que son datos de auditoría: dicen quién tocó la
 *     configuración del local y cuándo, y eso no se publica.
 *
 * La lista blanca es una lista, no un `delete` de los campos sensibles: así una
 * columna nueva en la tabla NO se publica sola el día que alguien la agregue.
 */

/** Lo único que sale por la ruta pública. */
const CAMPOS_PUBLICOS = [
  'nombre',
  'telefono',
  'direccion',
  'url_logo',
  'horario',
  'propina_sugerida_pct',
  'moneda',
  // Script 29 (P-21): el sitio público los muestra en "Nuestro restaurante".
  'correo',
  'redes',
];

// ---------------------------------------------------------------------------
// Contacto del local (script 29): las MISMAS reglas que la base
// (database/scripts/29_configuracion_contacto.sql), copiadas tal cual:
//   - ck_configuracion_correo: correo IS NULL OR correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
//   - fn_redes_contacto_validas: objeto con solo instagram, facebook, tiktok y
//     whatsapp; cada valor texto de 1 a 200 sin espacios; las tres URL con ~*
//     (sin distinguir mayúsculas) y whatsapp E.164 con ~.
// Son los mismos patrones que REDES del panel (#162). La prueba de integración
// compara cada uno contra fn_redes_contacto_validas caso por caso.
// ---------------------------------------------------------------------------

/** VARCHAR(254) y el CHECK de forma de la base. */
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;
const MAX_CORREO = 254;
/** Cada valor de red: de 1 a 200 caracteres, como char_length(...) BETWEEN 1 AND 200. */
const MAX_RED = 200;

const PATRONES_REDES = {
  instagram: {
    patron: /^https:\/\/([a-z0-9-]+\.)?instagram\.com\/\S+$/i,
    mensaje: 'instagram debe ser el enlace https del perfil (https://instagram.com/…)',
  },
  facebook: {
    patron: /^https:\/\/([a-z0-9-]+\.)?(facebook|fb)\.com\/\S+$/i,
    mensaje: 'facebook debe ser el enlace https de la página (https://facebook.com/… o fb.com/…)',
  },
  tiktok: {
    patron: /^https:\/\/([a-z0-9-]+\.)?tiktok\.com\/\S+$/i,
    mensaje: 'tiktok debe ser el enlace https del perfil (https://tiktok.com/@…)',
  },
  whatsapp: {
    patron: /^\+[1-9][0-9]{6,14}$/,
    mensaje: 'whatsapp debe ser el número en formato internacional, con + y sin espacios (+573001234567)',
  },
};

/** Una red: texto de 1 a 200, sin espacios, con su patrón. Nunca null ni "". */
const red = (clave) => z
  .string({ invalid_type_error: `${clave} debe ser un texto; una red sin usar se omite` })
  .min(1, `${clave} no puede ir vacío; una red sin usar se omite`)
  .max(MAX_RED, `${clave} admite hasta ${MAX_RED} caracteres`)
  .regex(/^\S+$/, `${clave} no puede llevar espacios`)
  .regex(PATRONES_REDES[clave].patron, PATRONES_REDES[clave].mensaje);

/**
 * `redes`: si viene, REEMPLAZA el objeto completo ({} = sin redes). No admite
 * null: la columna es NOT NULL DEFAULT '{}'.
 */
const redesSchema = z
  .object({
    instagram: red('instagram'),
    facebook: red('facebook'),
    tiktok: red('tiktok'),
    whatsapp: red('whatsapp'),
  }, { invalid_type_error: 'redes debe ser un objeto ({} = sin redes)' })
  .partial()
  .strict();

/**
 * Cuerpo de PUT /api/configuracion.
 *
 * `.strict()`: una clave de más es 400. Sin esto, un panel que reenviara la fila
 * entera colaría `actualizado_en`, `actualizado_por` o `id`, y el UPDATE los
 * ignoraría en silencio: quien llama creería haber cambiado algo que no cambió.
 * `.refine`: un cuerpo vacío no es una edición.
 *
 * Los límites son los de las columnas (ver database/scripts/26_configuracion.sql),
 * no inventados: `nombre` VARCHAR(120), `telefono` VARCHAR(30), `direccion`
 * VARCHAR(200), `url_logo` VARCHAR(255), `propina_sugerida_pct` NUMERIC(4,2) con
 * CHECK 0–30, `moneda` CHAR(3) con CHECK `^[A-Z]{3}$`.
 */
const configuracionSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    telefono: z.string().trim().max(30).nullable(),
    direccion: z.string().trim().max(200).nullable(),
    // `url_logo` admite null: quitar el logo es una operación normal.
    url_logo: z.string().trim().max(255).nullable(),
    // El horario es un objeto por día ({"lunes": {"abre": "11:00", ...}}), y la
    // tabla lo exige con `ck_configuracion_horario_objeto`
    // (`jsonb_typeof(horario) = 'object'`). Un arreglo o un número son 400 aquí,
    // no un 422 de la base. Las claves no se validan: qué días y qué formato
    // interno es cosa del panel, y fijarlo aquí obligaría a tocar el backend
    // cada vez que cambie.
    horario: z.record(z.any()),
    propina_sugerida_pct: z
      .number()
      .min(0, 'propina_sugerida_pct no puede ser negativa')
      .max(30, 'propina_sugerida_pct no puede pasar de 30')
      // NUMERIC(4,2): más de dos decimales se redondearía en silencio y el
      // valor guardado no sería el que se mandó.
      .refine((n) => Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-9, {
        message: 'propina_sugerida_pct admite como máximo 2 decimales',
      }),
    moneda: z.string().regex(/^[A-Z]{3}$/, 'moneda debe ser 3 letras mayúsculas (ISO 4217)'),
    // null = quitar el correo; ausente = se conserva. Sin trim: un espacio es
    // un correo inválido, como en el CHECK de la base, no un dato que arreglar.
    correo: z
      .string()
      .max(MAX_CORREO, `correo admite hasta ${MAX_CORREO} caracteres`)
      .regex(CORREO, 'correo debe tener la forma nombre@dominio.com')
      .nullable(),
    redes: redesSchema,
  })
  .partial()
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indica al menos un campo de la configuración',
  });

/** El motivo de un 400 de validación de correo o redes: el mismo de su CHECK. */
const MOTIVO_POR_CAMPO = {
  correo: configuracionService.CHECKS_DE_CONTACTO.ck_configuracion_correo.motivo,
  redes: configuracionService.CHECKS_DE_CONTACTO.ck_configuracion_redes.motivo,
};

/** Solo los campos de la lista blanca, en su orden. */
function vistaPublica(configuracion) {
  const publica = {};
  for (const campo of CAMPOS_PUBLICOS) publica[campo] = configuracion[campo];
  return publica;
}

/** GET /api/configuracion — pública, solo la lista blanca. */
async function obtenerPublica(req, res, next) {
  try {
    const configuracion = await configuracionService.obtener();
    if (!configuracion) return res.status(404).json({ error: 'Configuración no encontrada' });
    return res.json(vistaPublica(configuracion));
  } catch (err) {
    return next(err);
  }
}

/** GET /api/configuracion/completa — solo admin, con la auditoría. */
async function obtenerCompleta(req, res, next) {
  try {
    const configuracion = await configuracionService.obtener();
    if (!configuracion) return res.status(404).json({ error: 'Configuración no encontrada' });
    return res.json(configuracion);
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/configuracion — solo admin, parcial.
 *
 * Devuelve la configuración COMPLETA ya actualizada, con `actualizado_en` y
 * `actualizado_por` que acaba de poner el trigger: así el panel ve de una vez
 * quién quedó registrado como autor, sin una segunda llamada.
 */
async function actualizar(req, res, next) {
  const parsed = configuracionSchema.safeParse(req.body);
  if (!parsed.success) {
    // Los errores de correo y redes llevan motivo, como sus CHECK traducidos; el
    // resto de los 400 de validación conserva la forma de siempre ({ error }).
    const issue = parsed.error.errors[0];
    const motivo = MOTIVO_POR_CAMPO[issue.path[0]];
    return res.status(400).json(motivo ? { error: issue.message, motivo } : { error: issue.message });
  }

  try {
    const configuracion = await configuracionService.actualizar(parsed.data, {
      // requireAuth deja el payload del JWT en req.user. El autor del cambio
      // sale de ahí, nunca del cuerpo.
      idUsuario: req.user.id_usuario,
    });
    if (!configuracion) return res.status(404).json({ error: 'Configuración no encontrada' });
    return res.json(configuracion);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  obtenerPublica,
  obtenerCompleta,
  actualizar,
  configuracionSchema,
  redesSchema,
  CAMPOS_PUBLICOS,
  CORREO,
  PATRONES_REDES,
  MOTIVO_POR_CAMPO,
};
