const { z } = require('zod');
const pedidosService = require('../services/pedidos.service');
const { esComensal } = require('../middleware/auth.middleware');

// El trigger tr_validar_disponibilidad_plato de Jarrison deja comandar un plato
// agotado si notas_especiales contiene 'OVERRIDE_ADMIN' (bypass administrativo).
// Ese campo se arma con texto que escribe el comensal (su apodo y su nota), así
// que el marcador se rechaza en el body: de lo contrario cualquiera se pone de
// apodo "OVERRIDE_ADMIN" y se salta el control de disponibilidad.
const MARCADOR_OVERRIDE = /override_admin/i;
const MENSAJE_OVERRIDE = 'El texto no puede contener OVERRIDE_ADMIN';
const sinOverride = (valor) => !MARCADOR_OVERRIDE.test(valor);

// El apodo es el nombre que el comensal se puso en el carrito colaborativo
// ("Ana", "Pipe"): identifica quién agregó cada ítem y se guarda en
// detalles_pedido.notas_especiales, junto con la nota del ítem si la hay.
const itemSchema = z.object({
  id_plato: z.number().int(),
  cantidad: z.number().int().positive(),
  apodo: z.string().min(1).max(40).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
  notas: z.string().max(200).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
});

// id_mesa es opcional en el body porque para un comensal se toma del token y se
// ignora lo que venga aquí; para el personal (mesero/admin) es obligatorio.
const crearPedidoSchema = z.object({
  id_mesa: z.number().int().optional(),
  notas_generales: z.string().max(500).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
  items: z.array(itemSchema).min(1),
});

/**
 * POST /api/pedidos — lo usan el comensal (desde su sesión de QR), el mesero y
 * el admin. Si quien pide es un comensal, la mesa sale del token y el id_mesa
 * del body se ignora: así una mesa no puede ordenar a nombre de otra.
 */
async function crear(req, res, next) {
  const parsed = crearPedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const comensal = esComensal(req);
  const id_mesa = comensal ? req.user.id_mesa : parsed.data.id_mesa;
  // El pedido pertenece a la mesa; id_usuario solo alimenta la auditoría y va
  // null cuando lo crea un comensal (no existe en la tabla usuarios).
  const id_usuario = comensal ? null : req.user.id_usuario;

  if (!id_mesa) {
    return res.status(400).json({ error: 'id_mesa es obligatorio para el personal' });
  }

  try {
    const pedido = await pedidosService.crearConDetalles({
      id_mesa,
      id_usuario,
      items: parsed.data.items,
      notas_generales: parsed.data.notas_generales,
    });
    // NOTA para Roberto: aquí es donde se debe emitir 'order:created' hacia
    // el socket-server, para que llegue al KDS y al panel admin en vivo.
    return res.status(201).json({
      id_pedido: pedido.id_pedido,
      codigo_pedido: pedido.codigo_pedido,
      id_mesa: pedido.id_mesa,
      estado: pedido.estado,
      total: pedido.total,
    });
  } catch (err) {
    return next(err);
  }
}

async function listarActivos(req, res, next) {
  try {
    const pedidos = await pedidosService.listarActivos();
    return res.json({ pedidos });
  } catch (err) {
    return next(err);
  }
}

async function obtener(req, res, next) {
  try {
    const pedido = await pedidosService.obtenerConDetalles(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Un comensal solo puede ver los pedidos de su propia mesa.
    if (esComensal(req) && pedido.id_mesa !== req.user.id_mesa) {
      return res.status(403).json({ error: 'Ese pedido no pertenece a tu mesa' });
    }

    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

async function actualizarEstado(req, res, next) {
  const { estado, observaciones } = req.body;
  if (!pedidosService.ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      error: `Estado inválido. Usa uno de: ${pedidosService.ESTADOS_VALIDOS.join(', ')}`,
    });
  }

  try {
    const pedido = await pedidosService.actualizarEstado(
      req.params.id,
      estado,
      observaciones,
      esComensal(req) ? null : req.user.id_usuario
    );
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    // NOTA para Roberto: aquí se dispara 'order:status' hacia cliente y KDS.
    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

/**
 * Atajo de PATCH /:id/estado con estado = 'cancelado'. Cancelar solo es legal
 * desde 'recibido' o 'en_preparacion' (transiciones_validas); desde 'listo' o
 * 'entregado' el trigger responde 409, así que hay que propagar next para que
 * ese error llegue al manejador central.
 */
async function cancelar(req, res, next) {
  req.body = { ...req.body, estado: 'cancelado' };
  return actualizarEstado(req, res, next);
}

/**
 * GET /api/pedidos/mesa — pedidos de la mesa de la sesión del comensal.
 * Reemplaza al viejo /pedidos/historial: el modelo ER no relaciona pedidos con
 * usuarios, así que no hay historial "por cliente", solo por mesa.
 */
async function listarPorMesa(req, res, next) {
  try {
    const pedidos = await pedidosService.listarPorMesa(req.user.id_mesa);
    return res.json({ id_mesa: req.user.id_mesa, pedidos });
  } catch (err) {
    return next(err);
  }
}

module.exports = { crear, listarActivos, obtener, actualizarEstado, cancelar, listarPorMesa };
