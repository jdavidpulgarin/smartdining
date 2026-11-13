const { z } = require('zod');
const platosService = require('../services/platos.service');
const menuService = require('../services/menu.service');
const { disponibilidadEfectiva } = require('../services/disponibilidad-efectiva');
const socketNotifier = require('../services/socket.notifier');
const { urlImagenSchema } = require('../utils/url-imagen');

// Columnas segun docs/modelo-er.md: url_imagen (no "imagen_url"), id_categoria
// y tiempo_preparacion_estimado. El modelo no tiene personalizaciones.
const platoSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  precio: z.number().positive(),
  // D-23: URL http(s) o ruta /imagenes/<uuid>.webp de POST /api/imagenes
  // (src/utils/url-imagen.js).
  url_imagen: urlImagenSchema.optional(),
  id_categoria: z.number().int(),
  disponible: z.boolean().optional(),
  tiempo_preparacion_estimado: z.number().int().positive().optional(),
  // D-16 parte B: las dos columnas existen desde 13_constructor.sql, pero este
  // esquema no las aceptaba, así que un POST o un PUT que las mandara las
  // perdía en silencio. OPCIONALES: si no vienen, nada cambia.
  //
  // `personalizable` decide si el plato se arma por pasos en el constructor;
  // `calorias` admite null ("no se sabe"), que es distinto de 0.
  personalizable: z.boolean().optional(),
  calorias: z.number().int().min(0).nullable().optional(),
});

/**
 * Cuerpo de PATCH /platos/:id/disponible (D-05).
 *
 * `.strict()` al contrario que platoSchema: este cuerpo lo manda el panel de
 * agotados y tiene UN solo campo, así que una clave de más es un error de quien
 * llama, no la costumbre del editor de reenviar la fila entera. Y `z.boolean()`
 * sin coerción: un "false" en texto o un 0 valen `true` si se los deja pasar, y
 * eso aquí significaría reponer algo agotado. Mismo esquema que el de
 * ingredientes en constructor.controller.js.
 */
const disponibilidadSchema = z.object({ disponible: z.boolean() }).strict();

/** Entero positivo de la URL, o null si no lo es. */
function idDeLaUrl(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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
    await menuService.invalidarMenu();
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

    // El autor del cambio de precio sale del JWT (req.user), nunca del cuerpo:
    // es lo que el trigger del historial guarda en historial_precios.id_usuario.
    const plato = await platosService.actualizar(
      req.params.id,
      { ...actual, ...parsed.data },
      { idUsuario: req.user?.id_usuario ?? null }
    );
    await menuService.invalidarMenu();
    return res.json(plato);
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/platos/:id/disponible — D-05.
 *
 * El interruptor de "se agotó" / "volvió" del plato, gemelo del de ingredientes
 * (PATCH /api/ingredientes/:id/disponible). Es de `admin` y de `cocina`: no es
 * editar la carta —eso sigue siendo solo de admin en el PUT— sino reportar lo
 * que pasa en la cocina, y es lo que usa el panel de agotados.
 *
 * Idempotente: ponerlo al valor que ya tenía responde 200, no es un error.
 *
 * La bitácora del cambio no se escribe aquí: el trigger `tr_auditar_cambios`
 * de la base ya audita todo UPDATE de `platos` (docs/modelo-er.md §11).
 */
async function cambiarDisponibilidad(req, res, next) {
  const idPlato = idDeLaUrl(req.params.id);
  if (!idPlato) return res.status(400).json({ error: 'id de plato inválido' });

  const parsed = disponibilidadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const resultado = await platosService.cambiarDisponibilidad(idPlato, parsed.data.disponible);
    if (!resultado) return res.status(404).json({ error: 'Plato no encontrado' });

    // El orden importa: primero la caché, después el aviso. Al revés, un
    // cliente que reaccione al evento pidiendo GET /menu podría recibir la
    // copia vieja (TTL 60 s) y seguir mostrando el plato como disponible.
    await menuService.invalidarMenu();

    // Aquí se avisa SIEMPRE, incluso si el valor no cambió: si un cliente se
    // perdió el aviso anterior, el reenvío lo recupera. No se espera el
    // resultado: el cambio ya está guardado y el tiempo real es un extra, y
    // notificarPlatoDisponibilidad nunca lanza, así que un socket-server caído
    // no altera esta respuesta. Se encadena para que las pruebas puedan
    // esperarlo con esperarAvisos().
    // ISSUE #136: lo que viaja es la disponibilidad EFECTIVA
    // (disponible AND stock_suficiente), no el interruptor manual.
    //
    // Antes se mandaba `resultado.plato.disponible`: si la cocina encendia a
    // mano un plato sin stock, todos los sockets recibian disponible: true, la
    // PWA y el KDS lo mostraban disponible y pedirlo daba 409 sin_stock. El
    // oyente del canal 'inventario' ya mandaba el efectivo, asi que los dos
    // caminos se contradecian y decidia el ultimo aviso en llegar.
    socketNotifier.encadenarAvisos([
      () => socketNotifier.notificarPlatoDisponibilidad(
        resultado.plato.id_plato,
        disponibilidadEfectiva(resultado.plato)
      ),
    ]);

    // La fila del plato, igual que el PUT y que el PATCH de ingredientes. El
    // panel (agotadosApi.togglePlato) solo exige un 2xx y descarta el cuerpo,
    // así que devolver la fila le sirve y además deja ver el valor guardado.
    return res.json(resultado.plato);
  } catch (err) {
    return next(err);
  }
}

async function eliminar(req, res, next) {
  try {
    const eliminado = await platosService.eliminar(req.params.id);
    if (!eliminado) return res.status(404).json({ error: 'Plato no encontrado' });
    await menuService.invalidarMenu();
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/platos/:id/historial-precios — solo admin (D-16 parte B, P2).
 *
 * Quién cambió el precio y cuándo. Es de admin porque dice qué decisiones de
 * precio tomó el negocio y quién las tomó: no es información de sala.
 *
 * Se comprueba que el plato exista para distinguir «no hay cambios» (lista
 * vacía) de «ese plato no existe» (404): con una lista vacía en los dos casos,
 * un id mal escrito parecería un plato sin historia.
 */
async function historialPrecios(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'El id debe ser un entero positivo' });
  }

  const limite = req.query.limite === undefined ? undefined : Number(req.query.limite);
  if (limite !== undefined && (!Number.isInteger(limite) || limite <= 0)) {
    return res.status(400).json({ error: 'limite debe ser un entero positivo' });
  }

  try {
    const plato = await platosService.obtenerPorId(id);
    if (!plato) return res.status(404).json({ error: 'Plato no encontrado' });

    const historial = await platosService.historialPrecios(id, limite === undefined ? {} : { limite });
    return res.json({ historial });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  historialPrecios, listar, obtener, crear, actualizar, cambiarDisponibilidad, eliminar };
