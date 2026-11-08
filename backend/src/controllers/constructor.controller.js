const { z } = require('zod');
const constructorService = require('../services/constructor.service');
const platosService = require('../services/platos.service');
const menuService = require('../services/menu.service');
const socketNotifier = require('../services/socket.notifier');

/**
 * CRUD de pasos e ingredientes del constructor de platos (D-04).
 *
 * `id_plato` e `id_paso` salen SIEMPRE de la URL. El panel los manda además en
 * el cuerpo; se IGNORAN sin avisar, porque z.object() descarta las claves que
 * no están en el esquema. Rechazarlos con .strict() daría 400 a todas las
 * llamadas del panel tal como está hoy, que siempre los incluye.
 *
 * Tras cada escritura se invalida la caché del menú, igual que platos: los
 * pasos e ingredientes viajan dentro de obtener_menu_completo, así que sin esto
 * el comensal seguiría viendo el constructor viejo hasta que expire el TTL.
 * invalidarMenu nunca lanza (cache.borrar devuelve false si Redis está caído).
 *
 * Al socket-server solo se le avisa de la DISPONIBILIDAD (D-05): no existe un
 * evento de "cambió el menú" en EVENTS.md, y platos tampoco avisa. Cambiar el
 * nombre o el precio de un ingrediente no mueve el constructor de nadie en
 * vivo; agotarlo, sí (ingrediente:disponibilidad, §5.3).
 *
 * Ese aviso sale por los DOS caminos que pueden cambiar `disponible`: el PATCH
 * dedicado y el PUT del editor, que también puede tocarlo. En el PUT solo
 * cuando el valor cambió de verdad; en el PATCH siempre. Y en los dos, después
 * del COMMIT y después de invalidar la caché, nunca antes.
 */

// Límites de las columnas en 13_constructor.sql.
const MAX_NOMBRE_PASO = 60;
const MAX_NOMBRE_INGREDIENTE = 80;
const MAX_URL_IMAGEN = 255;

/**
 * `url_imagen` es VARCHAR(255) y acepta NULL, pero el panel la inicializa en
 * cadena vacía. Guardar '' sería basura que el constructor intentaría cargar
 * como imagen, así que '' (y solo espacios) se convierte en null.
 */
const urlImagen = z
  .string()
  .max(MAX_URL_IMAGEN)
  .transform((v) => (v.trim() === '' ? null : v))
  .nullable()
  .optional();

/**
 * Reglas de un paso. Replican los CHECK de la base para poder dar un 400 con un
 * mensaje que se entienda, en vez del 500 genérico en el que el manejador
 * central convierte un 23514.
 */
const pasoBase = {
  nombre: z.string().trim().min(1).max(MAX_NOMBRE_PASO),
  // orden > 0 (ck del esquema).
  orden: z.number().int().positive(),
  min_sel: z.number().int().min(0),
  max_sel: z.number().int().min(1),
  obligatorio: z.boolean(),
};

const pasoCrearSchema = z.object({
  ...pasoBase,
  // Los DEFAULT de la base, repetidos aquí para que el POST pueda omitirlos.
  min_sel: pasoBase.min_sel.default(0),
  max_sel: pasoBase.max_sel.default(1),
  obligatorio: pasoBase.obligatorio.default(false),
});

// PUT parcial: el panel manda solo los campos que tocó.
const pasoActualizarSchema = z.object(pasoBase).partial();

const ingredienteBase = {
  nombre: z.string().trim().min(1).max(MAX_NOMBRE_INGREDIENTE),
  precio_extra: z.number().min(0),
  calorias: z.number().int().min(0),
  alergenos: z.array(z.string()),
  url_imagen: urlImagen,
  disponible: z.boolean(),
};

const ingredienteCrearSchema = z.object({
  ...ingredienteBase,
  precio_extra: ingredienteBase.precio_extra.default(0),
  // nullish y NO default: si llega null (es lo que manda el panel) el service
  // omite la columna y actúa el DEFAULT 0 de la base.
  calorias: ingredienteBase.calorias.nullish(),
  alergenos: ingredienteBase.alergenos.default([]),
  disponible: ingredienteBase.disponible.default(true),
});

const ingredienteActualizarSchema = z
  .object({ ...ingredienteBase, calorias: ingredienteBase.calorias.nullable() })
  .partial();

/**
 * Cuerpo de PATCH /ingredientes/:id/disponible (D-05).
 *
 * `.strict()` aquí sí, al contrario que el resto del módulo: este cuerpo lo
 * manda el panel de agotados y tiene UN solo campo, así que una clave de más es
 * un error de quien llama y no la costumbre del editor de reenviar la fila
 * entera. Y `z.boolean()` sin coerción: un "false" en texto o un 0 valen
 * `true` si se los deja pasar, y eso aquí significaría reponer algo agotado.
 */
const disponibilidadSchema = z.object({ disponible: z.boolean() }).strict();

/**
 * Lanza el aviso de disponibilidad al socket-server sin esperarlo.
 *
 * No se hace `await`: el cambio ya está en la base y el tiempo real es un
 * extra. notificarIngredienteDisponibilidad nunca lanza —registra y devuelve
 * { ok: false }—, así que un socket-server caído no altera la respuesta. Se
 * encadena para que las pruebas puedan esperarlo con esperarAvisos().
 */
function avisarDisponibilidad(ingrediente) {
  socketNotifier.encadenarAvisos([
    () => socketNotifier.notificarIngredienteDisponibilidad(
      ingrediente.id_ingrediente,
      ingrediente.disponible
    ),
  ]);
}

/** Primer mensaje de zod, igual que el resto de los controllers. */
const error400 = (res, parsed) =>
  res.status(400).json({ error: parsed.error.errors[0].message });

/** Entero positivo de la URL, o null si no lo es. */
function idDeLaUrl(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Reglas que cruzan dos campos y por eso no caben en el esquema de uno solo.
 * Se aplican sobre la fila YA MEZCLADA: en un PUT parcial, subir min_sel sin
 * tocar max_sel tiene que validarse contra el max_sel que hay guardado.
 *
 * Lanza { status, message }, que el manejador central traduce a ese status.
 */
function exigirRangoCoherente(fila) {
  if (fila.min_sel > fila.max_sel) {
    throw { status: 400, message: 'min_sel no puede ser mayor que max_sel' };
  }
  if (fila.obligatorio && fila.min_sel < 1) {
    throw { status: 400, message: 'Un paso obligatorio necesita min_sel de al menos 1' };
  }
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

/**
 * GET /api/platos/:id/pasos — admin, cajero, mesero.
 *
 * Responde el ARRAY pelado, no { pasos }: es lo que consume el panel
 * (constructorApi.obtenerPasos devuelve el cuerpo tal cual).
 */
async function listarPasos(req, res, next) {
  const idPlato = idDeLaUrl(req.params.id);
  if (!idPlato) return res.status(400).json({ error: 'id de plato inválido' });

  try {
    const plato = await platosService.obtenerPorId(idPlato);
    if (!plato) return res.status(404).json({ error: 'Plato no encontrado' });

    return res.json(await constructorService.pasosDePlato(idPlato));
  } catch (err) {
    return next(err);
  }
}

async function crearPaso(req, res, next) {
  const idPlato = idDeLaUrl(req.params.id);
  if (!idPlato) return res.status(400).json({ error: 'id de plato inválido' });

  const parsed = pasoCrearSchema.safeParse(req.body);
  if (!parsed.success) return error400(res, parsed);

  try {
    exigirRangoCoherente(parsed.data);

    const plato = await platosService.obtenerPorId(idPlato);
    if (!plato) return res.status(404).json({ error: 'Plato no encontrado' });

    // Un plato no personalizable no muestra pasos (obtener_menu_completo
    // devuelve [] para él), así que agregárselos sería trabajo invisible.
    if (!plato.personalizable) {
      return res.status(409).json({
        error: 'Ese plato no es personalizable: actívalo antes de agregarle pasos',
      });
    }

    const paso = await constructorService.crearPaso(idPlato, parsed.data);
    await menuService.invalidarMenu();
    return res.status(201).json(paso);
  } catch (err) {
    return next(err);
  }
}

async function actualizarPaso(req, res, next) {
  const idPaso = idDeLaUrl(req.params.id);
  if (!idPaso) return res.status(400).json({ error: 'id de paso inválido' });

  const parsed = pasoActualizarSchema.safeParse(req.body);
  if (!parsed.success) return error400(res, parsed);

  try {
    // La mezcla y la validación ocurren DENTRO de la transacción, con la fila
    // bloqueada: ver actualizarPaso en el service.
    const paso = await constructorService.actualizarPaso(
      idPaso,
      parsed.data,
      exigirRangoCoherente
    );
    if (!paso) return res.status(404).json({ error: 'Paso no encontrado' });

    await menuService.invalidarMenu();
    return res.json(paso);
  } catch (err) {
    return next(err);
  }
}

async function eliminarPaso(req, res, next) {
  const idPaso = idDeLaUrl(req.params.id);
  if (!idPaso) return res.status(400).json({ error: 'id de paso inválido' });

  try {
    const eliminado = await constructorService.eliminarPaso(idPaso);
    if (!eliminado) return res.status(404).json({ error: 'Paso no encontrado' });

    await menuService.invalidarMenu();
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Ingredientes
// ---------------------------------------------------------------------------

async function crearIngrediente(req, res, next) {
  const idPaso = idDeLaUrl(req.params.id);
  if (!idPaso) return res.status(400).json({ error: 'id de paso inválido' });

  const parsed = ingredienteCrearSchema.safeParse(req.body);
  if (!parsed.success) return error400(res, parsed);

  try {
    const paso = await constructorService.obtenerPaso(idPaso);
    if (!paso) return res.status(404).json({ error: 'Paso no encontrado' });

    // calorias null (lo que manda el panel) se quita del objeto para que el
    // service omita la columna y actúe el DEFAULT 0 de la base.
    const datos = { ...parsed.data };
    if (datos.calorias === null || datos.calorias === undefined) delete datos.calorias;
    if (datos.url_imagen === undefined) datos.url_imagen = null;

    const ingrediente = await constructorService.crearIngrediente(idPaso, datos);
    await menuService.invalidarMenu();
    return res.status(201).json(ingrediente);
  } catch (err) {
    return next(err);
  }
}

async function actualizarIngrediente(req, res, next) {
  const idIngrediente = idDeLaUrl(req.params.id);
  if (!idIngrediente) return res.status(400).json({ error: 'id de ingrediente inválido' });

  const parsed = ingredienteActualizarSchema.safeParse(req.body);
  if (!parsed.success) return error400(res, parsed);

  // En un PUT la columna ya tiene valor, así que no hay DEFAULT que invocar:
  // calorias null se guarda como 0, que es el equivalente de "no sé".
  const cambios = { ...parsed.data };
  if (cambios.calorias === null) cambios.calorias = 0;

  try {
    const resultado = await constructorService.actualizarIngrediente(idIngrediente, cambios);
    if (!resultado) return res.status(404).json({ error: 'Ingrediente no encontrado' });

    const { ingrediente, anterior } = resultado;
    await menuService.invalidarMenu();

    // D-05: el editor del panel también puede agotar o reponer por aquí, y sin
    // este aviso el cambio no llegaría en vivo a los celulares. Solo cuando
    // `disponible` CAMBIÓ de valor: un PUT que toca el nombre o el precio no es
    // una noticia de disponibilidad y no debe mover el constructor de nadie.
    if (anterior.disponible !== ingrediente.disponible) {
      avisarDisponibilidad(ingrediente);
    }

    return res.json(ingrediente);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /ingredientes/:id/disponible — D-05.
 *
 * El interruptor de "se agotó" / "volvió". Es de `admin` y de `cocina`: es la
 * única escritura del constructor que no es de admin, porque no es editar la
 * carta sino reportar lo que pasa en la cocina (es lo que usa el panel de
 * agotados del KDS, D-10).
 *
 * Idempotente: ponerlo al valor que ya tenía responde 200, no es un error.
 */
async function cambiarDisponibilidadIngrediente(req, res, next) {
  const idIngrediente = idDeLaUrl(req.params.id);
  if (!idIngrediente) return res.status(400).json({ error: 'id de ingrediente inválido' });

  const parsed = disponibilidadSchema.safeParse(req.body);
  if (!parsed.success) return error400(res, parsed);

  try {
    const resultado = await constructorService.actualizarIngrediente(idIngrediente, {
      disponible: parsed.data.disponible,
    });
    if (!resultado) return res.status(404).json({ error: 'Ingrediente no encontrado' });

    // El orden importa: primero la caché, después el aviso. Al revés, un
    // cliente que reaccione al evento pidiendo GET /menu podría recibir la
    // copia vieja (TTL 60 s) y seguir mostrando el ingrediente como disponible.
    await menuService.invalidarMenu();

    // Aquí se avisa SIEMPRE, incluso si el valor no cambió: si un cliente se
    // perdió el aviso anterior, el reenvío lo recupera. No se espera el
    // resultado: el cambio ya está guardado y el tiempo real es un extra.
    avisarDisponibilidad(resultado.ingrediente);

    return res.json(resultado.ingrediente);
  } catch (err) {
    return next(err);
  }
}

async function eliminarIngrediente(req, res, next) {
  const idIngrediente = idDeLaUrl(req.params.id);
  if (!idIngrediente) return res.status(400).json({ error: 'id de ingrediente inválido' });

  try {
    const eliminado = await constructorService.eliminarIngrediente(idIngrediente);
    if (!eliminado) return res.status(404).json({ error: 'Ingrediente no encontrado' });

    await menuService.invalidarMenu();
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listarPasos,
  crearPaso,
  actualizarPaso,
  eliminarPaso,
  crearIngrediente,
  actualizarIngrediente,
  cambiarDisponibilidadIngrediente,
  eliminarIngrediente,
};
