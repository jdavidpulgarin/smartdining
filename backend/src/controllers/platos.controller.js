const { z } = require('zod');
const platosService = require('../services/platos.service');
const menuService = require('../services/menu.service');
const socketNotifier = require('../services/socket.notifier');

// Columnas segun docs/modelo-er.md: url_imagen (no "imagen_url"), id_categoria
// y tiempo_preparacion_estimado. El modelo no tiene personalizaciones.
const platoSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  precio: z.number().positive(),
  url_imagen: z.string().url().optional(),
  id_categoria: z.number().int(),
  disponible: z.boolean().optional(),
  tiempo_preparacion_estimado: z.number().int().positive().optional(),
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

    const plato = await platosService.actualizar(req.params.id, { ...actual, ...parsed.data });
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
    socketNotifier.encadenarAvisos([
      () => socketNotifier.notificarPlatoDisponibilidad(
        resultado.plato.id_plato,
        resultado.plato.disponible
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

module.exports = { listar, obtener, crear, actualizar, cambiarDisponibilidad, eliminar };
