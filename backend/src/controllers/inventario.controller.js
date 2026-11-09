const { z } = require('zod');
const inventarioService = require('../services/inventario.service');

/**
 * Inventario del panel (D-17 PR 2): insumos, movimientos y recetas.
 *
 * Contrato en docs/api-spec.md → "Inventario: insumos, movimientos y recetas".
 * Todo es de admin: el inventario dice cuánto queda y cuánto cuesta cada cosa,
 * que es información del negocio y no de sala.
 *
 * Qué se valida aquí y qué deja a la base:
 *   - Lo que la base rechazaría con un `check_violation` (23514) se valida ANTES
 *     con zod, porque ese 23514 sale como un **422 opaco** ("un dato está fuera
 *     del rango permitido") que no dice qué campo falla. Son `tipo`, `unidad`,
 *     `cantidad` y los números negativos.
 *   - Lo que solo la base puede saber se deja a la base y se traduce: el nombre
 *     repetido (23505 → 409 `nombre_en_uso`), el insumo inexistente de una
 *     receta (23503 → 409 `insumo_inexistente`) y el stock en negativo (SD002 →
 *     400 `movimiento_invalido`, que ya traduce el manejador central del PR 1).
 */

/** Hasta dos decimales: las columnas son NUMERIC(12,2) y NUMERIC(10,2). */
const DOS_DECIMALES = 100;
const hastaDosDecimales = (valor) =>
  Number.isInteger(Math.round(valor * DOS_DECIMALES)) &&
  Math.abs(valor * DOS_DECIMALES - Math.round(valor * DOS_DECIMALES)) < Number.EPSILON;

const MENSAJE_DECIMALES = 'admite como máximo 2 decimales';

/**
 * Un NUMERIC(_,2) de la base como campo de zod.
 *
 * El refinamiento de los decimales va SIEMPRE al final: `.refine()` devuelve un
 * ZodEffects, que ya no tiene `.min()` ni `.gt()`, así que los límites se
 * aplican antes sobre el ZodNumber.
 *
 * @param {{min?: number, gt?: number}} limites
 */
function numeroConDosDecimales(nombre, limites = {}) {
  let schema = z
    .number({ invalid_type_error: `${nombre} debe ser un número` })
    .finite(`${nombre} debe ser un número`);

  if (limites.min !== undefined) {
    schema = schema.min(limites.min, `${nombre} no puede ser menor que ${limites.min}`);
  }
  if (limites.gt !== undefined) {
    schema = schema.gt(limites.gt, `${nombre} debe ser mayor que ${limites.gt}`);
  }

  return schema.refine(hastaDosDecimales, { message: `${nombre} ${MENSAJE_DECIMALES}` });
}

const nombreInsumo = z
  .string()
  .trim()
  .min(1, 'nombre es obligatorio')
  .max(80, 'nombre admite como máximo 80 caracteres');

const unidadInsumo = z.enum(inventarioService.UNIDADES, {
  errorMap: () => ({ message: `unidad debe ser una de: ${inventarioService.UNIDADES.join(', ')}` }),
});

const stockMinimo = numeroConDosDecimales('stock_minimo', { min: 0 });

const crearInsumoSchema = z
  .object({
    nombre: nombreInsumo,
    unidad: unidadInsumo.optional(),
    stock_minimo: stockMinimo.optional(),
    // El stock inicial entra como un movimiento 'entrada', y una entrada de 0 no
    // es un movimiento: para dar de alta algo que todavía no llegó, se omite.
    stock_inicial: numeroConDosDecimales('stock_inicial', { gt: 0 }).optional(),
  })
  .strict();

const actualizarInsumoSchema = z
  .object({
    nombre: nombreInsumo.optional(),
    unidad: unidadInsumo.optional(),
    stock_minimo: stockMinimo.optional(),
    activo: z.boolean({ invalid_type_error: 'activo debe ser true o false' }).optional(),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indica al menos un campo: nombre, unidad, stock_minimo o activo',
  });

const movimientoSchema = z
  .object({
    tipo: z.enum(inventarioService.TIPOS_MOVIMIENTO, {
      errorMap: () => ({
        message: `tipo debe ser uno de: ${inventarioService.TIPOS_MOVIMIENTO.join(', ')}`,
      }),
    }),
    cantidad: numeroConDosDecimales('cantidad').refine((valor) => valor !== 0, {
      message: 'cantidad no puede ser 0',
    }),
    motivo: z.string().trim().max(500, 'motivo admite como máximo 500 caracteres').optional(),
  })
  .strict()
  // `entrada` y `merma` llevan el signo en el TIPO, así que la cantidad es
  // positiva. `ajuste` es el único con signo: es lo que permite corregir un
  // conteo en los dos sentidos, y es lo que acepta la función de la base.
  .refine((datos) => datos.tipo === 'ajuste' || datos.cantidad > 0, {
    message: 'cantidad debe ser mayor que 0 para entrada y merma (el signo lo pone el tipo)',
    path: ['cantidad'],
  });

const recetaSchema = z
  .object({
    insumos: z
      .array(
        z
          .object({
            id_insumo: z
              .number({ invalid_type_error: 'id_insumo debe ser un entero positivo' })
              .int('id_insumo debe ser un entero positivo')
              .positive('id_insumo debe ser un entero positivo'),
            cantidad: numeroConDosDecimales('cantidad', { gt: 0 }),
          })
          .strict()
      )
      .max(
        inventarioService.MAX_ENTRADAS_RECETA,
        `insumos admite como máximo ${inventarioService.MAX_ENTRADAS_RECETA} entradas`
      ),
  })
  .strict();

/** Un id de la URL: entero positivo, o null. */
function idDeLaUrl(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

const MENSAJE_ID = 'El id debe ser un entero positivo';
const MENSAJE_INSUMO_NO_ENCONTRADO = 'Insumo no encontrado';

/** El primer mensaje de zod, que es el que nombra el campo que falla. */
const primerError = (parsed) => parsed.error.errors[0].message;

/**
 * GET /api/inventario/insumos — admin.
 *
 * `?estado=bajo` lee la vista `v_stock_bajo`, que es la definición de "bajo" de
 * la base: así el panel y el aviso `inventario:alerta` hablan de lo mismo.
 *
 * Un `estado` o un `activo` que no están en la lista son 400 y NO se ignoran:
 * un `?estado=bajos` que devolviera todo haría creer que no hay faltantes.
 */
const filtrosSchema = z
  .object({
    estado: z.enum(['todos', 'bajo']).optional(),
    activo: z.enum(['true', 'false']).optional(),
    q: z.string().trim().max(80).optional(),
    limite: z
      .string()
      .regex(/^\d+$/, 'limite debe ser un entero positivo')
      .optional(),
  })
  .strict();

async function listarInsumos(req, res, next) {
  const parsed = filtrosSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: `Filtro inválido: ${primerError(parsed)}` });
  }

  const { estado, activo, q, limite } = parsed.data;
  if (limite !== undefined && Number(limite) === 0) {
    return res.status(400).json({ error: 'limite debe ser un entero positivo' });
  }

  try {
    const insumos = await inventarioService.listarInsumos({
      estado,
      activo: activo === undefined ? undefined : activo === 'true',
      q,
      limite: limite === undefined ? undefined : Number(limite),
    });
    return res.json({ insumos });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/inventario/carta — admin (D-17 PR 3).
 *
 * La carta con su disponibilidad y si tiene receta, para la pestaña de Recetas
 * del panel. Sale de `v_carta_disponible`: aquí no se decide nada sobre la
 * disponibilidad, solo se agrupa en `{ platos, ingredientes }`.
 *
 * Un filtro con un valor que no está en la lista es 400 y NO se ignora: un
 * `?tipo=platos` que devolviera todo haría creer al panel que no queda nada
 * pendiente de configurar.
 */
const cartaSchema = z
  .object({
    tipo: z.enum(['plato', 'ingrediente']).optional(),
    sin_receta: z.enum(['true', 'false']).optional(),
    q: z.string().trim().max(80, 'q admite como máximo 80 caracteres').optional(),
  })
  .strict();

async function obtenerCarta(req, res, next) {
  const parsed = cartaSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: `Filtro inválido: ${primerError(parsed)}` });
  }

  const { tipo, sin_receta: sinReceta, q } = parsed.data;

  try {
    const carta = await inventarioService.obtenerCarta({
      tipo,
      sinReceta: sinReceta === undefined ? undefined : sinReceta === 'true',
      q,
    });
    return res.json(carta);
  } catch (err) {
    return next(err);
  }
}

/** GET /api/inventario/insumos/:id — admin. */
async function obtenerInsumo(req, res, next) {
  const idInsumo = idDeLaUrl(req.params.id);
  if (idInsumo === null) return res.status(400).json({ error: MENSAJE_ID });

  try {
    const insumo = await inventarioService.obtenerInsumo(idInsumo);
    if (!insumo) return res.status(404).json({ error: MENSAJE_INSUMO_NO_ENCONTRADO });
    return res.json({ insumo });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/inventario/insumos — admin.
 *
 * El `stock_inicial` entra como un movimiento `entrada` en la misma
 * transacción, nunca escrito en la columna: así `SUM(movimientos.cantidad) =
 * stock_actual` se cumple desde la primera fila.
 */
async function crearInsumo(req, res, next) {
  const parsed = crearInsumoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: primerError(parsed) });

  try {
    const { insumo, movimiento } = await inventarioService.crearInsumo(parsed.data, {
      idUsuario: req.user?.id_usuario ?? null,
    });
    return res.status(201).json({ insumo, movimiento });
  } catch (err) {
    return next(err);
  }
}

/**
 * PUT /api/inventario/insumos/:id — admin, parcial.
 *
 * `stock_actual` no está en el esquema y el cuerpo es `.strict()`, así que
 * mandarlo es un 400: es mejor que ignorarlo en silencio y dejar a quien llama
 * creyendo que corrigió el stock. Para eso están los movimientos.
 */
async function actualizarInsumo(req, res, next) {
  const idInsumo = idDeLaUrl(req.params.id);
  if (idInsumo === null) return res.status(400).json({ error: MENSAJE_ID });

  const parsed = actualizarInsumoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: primerError(parsed) });

  try {
    const insumo = await inventarioService.actualizarInsumo(idInsumo, parsed.data, {
      idUsuario: req.user?.id_usuario ?? null,
    });
    if (!insumo) return res.status(404).json({ error: MENSAJE_INSUMO_NO_ENCONTRADO });
    return res.json({ insumo });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/inventario/insumos/:id/movimientos — admin.
 *
 * El único camino para mover el stock. Lo escribe
 * `registrar_movimiento_inventario`, y el autor sale del JWT.
 */
async function registrarMovimiento(req, res, next) {
  const idInsumo = idDeLaUrl(req.params.id);
  if (idInsumo === null) return res.status(400).json({ error: MENSAJE_ID });

  const parsed = movimientoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: primerError(parsed) });

  try {
    const hecho = await inventarioService.registrarMovimiento(idInsumo, parsed.data, {
      idUsuario: req.user?.id_usuario ?? null,
    });
    if (!hecho) return res.status(404).json({ error: MENSAJE_INSUMO_NO_ENCONTRADO });
    return res.status(201).json(hecho);
  } catch (err) {
    return next(err);
  }
}

const historialSchema = z
  .object({
    limite: z.string().regex(/^\d+$/, 'limite debe ser un entero positivo').optional(),
    desde: z.string().optional(),
  })
  .strict();

/** GET /api/inventario/insumos/:id/movimientos — admin. */
async function listarMovimientos(req, res, next) {
  const idInsumo = idDeLaUrl(req.params.id);
  if (idInsumo === null) return res.status(400).json({ error: MENSAJE_ID });

  const parsed = historialSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: `Filtro inválido: ${primerError(parsed)}` });
  }

  const { limite, desde } = parsed.data;
  if (limite !== undefined && Number(limite) === 0) {
    return res.status(400).json({ error: 'limite debe ser un entero positivo' });
  }
  // Una fecha que no se entiende se rechaza aquí: pasarla a la base daría un
  // 22007 que sale como un 422 opaco.
  if (desde !== undefined && Number.isNaN(Date.parse(desde))) {
    return res.status(400).json({ error: 'desde debe ser una fecha ISO 8601' });
  }

  try {
    // Se comprueba que el insumo exista para no confundir "sin movimientos" con
    // "ese insumo no existe".
    const insumo = await inventarioService.obtenerInsumo(idInsumo);
    if (!insumo) return res.status(404).json({ error: MENSAJE_INSUMO_NO_ENCONTRADO });

    const movimientos = await inventarioService.listarMovimientos(idInsumo, {
      limite: limite === undefined ? undefined : Number(limite),
      desde,
    });
    return res.json({ movimientos });
  } catch (err) {
    return next(err);
  }
}

/* -------------------------------------------------------------------------- *
 * Recetas: platos y opciones del constructor
 *
 * Las dos tablas son gemelas, así que los handlers se arman una vez y se
 * especializan con la receta y el nombre de la clave que sale en la respuesta.
 * -------------------------------------------------------------------------- */

const MENSAJE_PLATO_NO_ENCONTRADO = 'Plato no encontrado';
const MENSAJE_INGREDIENTE_NO_ENCONTRADO = 'Ingrediente no encontrado';
const MOTIVO_INSUMO_REPETIDO = 'insumo_repetido';

/** El primer id_insumo repetido de la lista, o null. */
function primerRepetido(insumos) {
  const vistos = new Set();
  for (const entrada of insumos) {
    if (vistos.has(entrada.id_insumo)) return entrada.id_insumo;
    vistos.add(entrada.id_insumo);
  }
  return null;
}

function handlersDeReceta(receta, clave, mensajeNoEncontrado) {
  return {
    async obtener(req, res, next) {
      const id = idDeLaUrl(req.params.id);
      if (id === null) return res.status(400).json({ error: MENSAJE_ID });

      try {
        if (!(await inventarioService.existeDueno(receta, id))) {
          return res.status(404).json({ error: mensajeNoEncontrado });
        }
        const filas = await inventarioService.obtenerReceta(receta, id);
        return res.json({ [clave]: id, receta: filas });
      } catch (err) {
        return next(err);
      }
    },

    async reemplazar(req, res, next) {
      const id = idDeLaUrl(req.params.id);
      if (id === null) return res.status(400).json({ error: MENSAJE_ID });

      const parsed = recetaSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: primerError(parsed) });

      // La tabla tiene PK (id_plato, id_insumo): un id repetido no es "la suma
      // de los dos", es ambiguo, y el segundo INSERT chocaría con un 23505 que
      // nombraría el constraint. Mejor decir cuál está repetido.
      const repetido = primerRepetido(parsed.data.insumos);
      if (repetido !== null) {
        return res.status(400).json({
          error: `El insumo ${repetido} está repetido en la receta`,
          motivo: MOTIVO_INSUMO_REPETIDO,
        });
      }

      try {
        const guardada = await inventarioService.reemplazarReceta(receta, id, parsed.data.insumos, {
          idUsuario: req.user?.id_usuario ?? null,
        });
        if (!guardada) return res.status(404).json({ error: mensajeNoEncontrado });
        return res.json({ [clave]: id, receta: guardada });
      } catch (err) {
        return next(err);
      }
    },
  };
}

const recetaDePlato = handlersDeReceta(
  inventarioService.RECETA_PLATO,
  'id_plato',
  MENSAJE_PLATO_NO_ENCONTRADO
);
const recetaDeIngrediente = handlersDeReceta(
  inventarioService.RECETA_INGREDIENTE,
  'id_ingrediente',
  MENSAJE_INGREDIENTE_NO_ENCONTRADO
);

module.exports = {
  obtenerCarta,
  listarInsumos,
  obtenerInsumo,
  crearInsumo,
  actualizarInsumo,
  registrarMovimiento,
  listarMovimientos,
  obtenerRecetaPlato: recetaDePlato.obtener,
  reemplazarRecetaPlato: recetaDePlato.reemplazar,
  obtenerRecetaIngrediente: recetaDeIngrediente.obtener,
  reemplazarRecetaIngrediente: recetaDeIngrediente.reemplazar,
  MOTIVO_INSUMO_REPETIDO,
  MENSAJE_INSUMO_NO_ENCONTRADO,
  MENSAJE_PLATO_NO_ENCONTRADO,
  MENSAJE_INGREDIENTE_NO_ENCONTRADO,
};
