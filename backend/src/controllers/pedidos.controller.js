const { z } = require('zod');
const pedidosService = require('../services/pedidos.service');
const mesasService = require('../services/mesas.service');
const { esComensal } = require('../middleware/auth.middleware');
const socketNotifier = require('../services/socket.notifier');
const aliasComensal = require('../services/alias-comensal');

// El trigger tr_validar_disponibilidad_plato de Jarrison deja comandar un plato
// agotado si notas_especiales contiene 'OVERRIDE_ADMIN' (bypass administrativo).
// Ese campo se arma con texto que escribe el comensal, así que el marcador se
// rechaza en el body. El alias (comensal/apodo) ya no se guarda ahí, pero se
// sigue revisando igual: es texto del cliente y mañana puede volver a mezclarse
// con notas en algún listado o reporte.
const MARCADOR_OVERRIDE = /override_admin/i;
const MENSAJE_OVERRIDE = 'El texto no puede contener OVERRIDE_ADMIN';
const sinOverride = (valor) => !MARCADOR_OVERRIDE.test(valor);

// Porciones que acepta detalles_ingredientes.porcion (CHECK del script 13).
const PORCIONES = ['ligera', 'normal', 'extra'];

// Tope defensivo del body, no una regla de negocio: cuántas opciones se pueden
// elegir de verdad lo dicen min_sel/max_sel de cada paso, y eso lo valida
// validar_selecciones_detalle en la base.
const MAX_INGREDIENTES_POR_ITEM = 20;

/**
 * Topes del pedido (H-06).
 *
 * Antes `cantidad` solo pedía ser positiva: un `100000000` llegaba a la base,
 * desbordaba el DECIMAL del subtotal y salía como 500. Y `items` no tenía tope,
 * así que un cuerpo con miles de ítems hacía miles de INSERT dentro de una
 * transacción.
 *
 * Los números son de sala, no técnicos: 20 unidades del mismo plato ya es una
 * mesa grande pidiendo lo mismo, y 50 ítems distintos es más de lo que cabe en
 * una comanda. Lo que pase de ahí es un error de quien llama o un abuso, y en
 * los dos casos un 400 explica mejor que un 500.
 */
const MAX_ITEMS_POR_PEDIDO = 50;
const MAX_CANTIDAD_POR_ITEM = 20;

// Campos de precio que un cliente podría intentar imponer. El precio lo fija
// SIEMPRE la base (platos.precio e ingredientes.precio_extra vía trigger), así
// que se rechazan en voz alta en vez de ignorarlos en silencio: quien los manda
// está dando por hecho que cuentan, y es mejor que se entere con un 400.
const CAMPOS_DE_PRECIO = [
  'precio',
  'precio_unitario',
  'precio_extra',
  'precio_aplicado',
  'precio_extras',
  'subtotal',
  'total',
];
const MENSAJE_PRECIO = 'El precio lo fija la base de datos: no envíes campos de precio';

/** Agrega un issue por cada campo de precio presente en el objeto recibido. */
function rechazarPrecios(valor, ctx) {
  for (const campo of CAMPOS_DE_PRECIO) {
    if (valor[campo] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_PRECIO, path: [campo] });
    }
  }
}

const ingredienteSchema = z
  .object({
    id_ingrediente: z.number().int().positive(),
    // 'normal' es la porción sin recargo: el valor por defecto más conservador.
    porcion: z.enum(PORCIONES).default('normal'),
  })
  // passthrough porque zod descarta las claves desconocidas ANTES de los
  // refinamientos, y sin ellas no se puede ver que llegó un precio. Lo que pasa
  // al service no son estos objetos sino los que arma `crear` campo por campo,
  // así que nada desconocido sigue viaje.
  .passthrough()
  .superRefine(rechazarPrecios);

/**
 * `comensal` es el alias con el que la persona se identificó en el carrito
 * colaborativo ("Ana", "Pipe"). Desde D-03 va en su propia columna
 * detalles_pedido.comensal y no antepuesto a notas_especiales, para poder
 * dividir la cuenta por persona sin parsear texto libre.
 *
 * `apodo` sigue aceptándose como alias de compatibilidad (así lo llamaba la API
 * anterior); si llegan los dos, manda `comensal`.
 */
const aliasSchema = z.string().trim().min(1).max(40).refine(sinOverride, MENSAJE_OVERRIDE);

const itemSchema = z
  .object({
    id_plato: z.number().int(),
    cantidad: z.number().int().min(1).max(MAX_CANTIDAD_POR_ITEM),
    comensal: aliasSchema.optional(),
    apodo: aliasSchema.optional(),
    notas: z.string().max(200).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
    ingredientes: z.array(ingredienteSchema).max(MAX_INGREDIENTES_POR_ITEM).optional(),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    rechazarPrecios(item, ctx);

    // El mismo ingrediente dos veces en un ítem no tiene significado (la porción
    // sería ambigua) y además chocaría con la PK de detalles_ingredientes, que
    // saldría como 500 en vez de 400. Se corta aquí.
    const ids = (item.ingredientes || []).map((i) => i.id_ingrediente);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'No repitas el mismo ingrediente en un ítem',
        path: ['ingredientes'],
      });
    }
  });

// id_mesa es opcional en el body porque para un comensal se toma del token y se
// ignora lo que venga aquí; para el personal (mesero/admin) es obligatorio.
const crearPedidoSchema = z.object({
  id_mesa: z.number().int().optional(),
  notas_generales: z.string().max(500).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS_POR_PEDIDO),
});

/**
 * Alias del comensal que queda guardado en el ítem.
 *
 * H-05: para un COMENSAL el alias sale **solo del JWT**. Lo que venga en el
 * body (`comensal` o `apodo`) se ignora por completo, incluso si el token no
 * trae alias: en ese caso queda `null`.
 *
 * El alias no es decoración, es a quién se le cobra: con el body como respaldo,
 * cualquiera en la mesa podía escribir el nombre de otro y cargarle sus platos,
 * y la cuenta por persona dejaba de ser fiable. Un alias firmado por el
 * servidor no se puede suplantar; uno escrito en el cuerpo sí.
 *
 * Para mesero y admin el body sigue valiendo: ellos piden de parte de alguien y
 * su JWT no lleva alias, sino `id_usuario`.
 */
function aliasDelComensal(req, item) {
  const firmado = req.user?.comensal;
  if (typeof firmado === 'string' && firmado.trim()) return firmado.trim();

  // Un comensal sin alias firmado se queda sin alias: el body no es autoridad.
  if (esComensal(req)) return null;

  return item.comensal ?? item.apodo ?? null;
}

/**
 * POST /api/pedidos — lo usan el comensal (desde su sesión de QR), el mesero y
 * el admin. Si quien pide es un comensal, la mesa sale del token y el id_mesa
 * del body se ignora: así una mesa no puede ordenar a nombre de otra.
 *
 * Los platos personalizables llegan con `ingredientes`; el backend no decide
 * nada sobre ellos (ni precio ni validez): los inserta y deja que el trigger
 * tr_validar_detalle_ingrediente y validar_selecciones_detalle manden.
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
    // El alias se resuelve aquí (es una decisión sobre quién pide, propia del
    // controller) y el service recibe los ítems ya normalizados.
    const items = parsed.data.items.map((item) => ({
      id_plato: item.id_plato,
      cantidad: item.cantidad,
      comensal: aliasDelComensal(req, item),
      notas: item.notas ?? null,
      ingredientes: (item.ingredientes ?? []).map((i) => ({
        id_ingrediente: i.id_ingrediente,
        porcion: i.porcion,
      })),
    }));

    const pedido = await pedidosService.crearConDetalles({
      id_mesa,
      id_usuario,
      items,
      notas_generales: parsed.data.notas_generales,
    });
    // Avisa al socket-server para que la comanda aparezca en vivo en el KDS, el
    // panel admin y la mesa. Sin await a propósito: el tiempo real no debe
    // retrasar ni hacer fallar la respuesta del pedido (el notifier nunca lanza).
    socketNotifier.notificarPedidoCreado(pedido, pedido.detalles);

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

/**
 * GET /api/pedidos/activos — panel del restaurante (admin, cajero, mesero).
 *
 * Devuelve `{ pedidos }` con cada pedido en el mismo formato que
 * GET /pedidos/:id: sus `detalles`, cada uno con el nombre del plato y los
 * ingredientes elegidos, más `mesa_numero`. El servicio decide qué estados
 * cuentan como activos y agrupa los detalles.
 */
async function listarActivos(req, res, next) {
  try {
    const pedidos = await pedidosService.listarActivos();
    return res.json({ pedidos });
  } catch (err) {
    return next(err);
  }
}

/**
 * ¿El pedido es de la visita que está sentada ahora en la mesa?
 *
 * Misma regla que el SQL (`creado_en >= sesion_iniciada_en`), aquí en
 * JavaScript porque es una comprobación de permiso sobre una fila que ya se
 * leyó, no una consulta. Sin sesión delimitada (NULL) se acepta, igual que en
 * la base.
 */
function esDeLaVisitaActual(pedido, mesa) {
  if (!mesa || !mesa.sesion_iniciada_en) return true;
  return new Date(pedido.creado_en) >= new Date(mesa.sesion_iniciada_en);
}

async function obtener(req, res, next) {
  try {
    const pedido = await pedidosService.obtenerConDetalles(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Un comensal solo puede ver los pedidos de su propia mesa...
    if (esComensal(req) && pedido.id_mesa !== req.user.id_mesa) {
      return res.status(403).json({ error: 'Ese pedido no pertenece a tu mesa' });
    }

    // ...y solo los de SU visita. Sin esto, un comensal podría leer por id un
    // pedido del grupo anterior sentado en la misma mesa (sus platos, su alias
    // y su total), que es la misma fuga que cierra el filtro de
    // GET /api/pedidos/mesa. El personal sí ve el histórico completo.
    if (esComensal(req) && !esDeLaVisitaActual(pedido, await mesasService.obtenerPorId(pedido.id_mesa))) {
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

    // actualizarEstado devuelve el pedido ya con estado_anterior, que es lo que
    // espera el payload de order:status.
    socketNotifier.notificarCambioEstado(pedido);

    // El cierre del pedido pudo liberar la mesa (ya ocurrió en la transacción):
    // se avisa para que el socket-server cierre la sesión de esa mesa.
    if (pedido.mesaLiberada) {
      socketNotifier.notificarMesaLiberada(pedido.id_mesa);
      aliasComensal.olvidarMesa(pedido.id_mesa);
    }

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

/**
 * GET /api/pedidos/mesa/cuenta — la cuenta de SU mesa, para el comensal.
 *
 * La mesa sale del JWT y de ningún otro sitio, igual que en listarPorMesa: si
 * se aceptara un id por la URL o por el body, un comensal podría leer la cuenta
 * (y los alias) de otra mesa. Por eso la ruta no tiene parámetro.
 *
 * Devuelve lo mismo que la cuenta del personal, con los montos en pesos.
 */
async function cuentaDeMiMesa(req, res, next) {
  try {
    const cuenta = await mesasService.cuentaPorComensal(req.user.id_mesa);
    // La sesión vive mientras la mesa tenga su token_qr, así que no existir
    // aquí es raro; igual se contesta 404 en vez de dejar pasar un null.
    if (!cuenta) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(cuenta);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  crear,
  listarActivos,
  obtener,
  actualizarEstado,
  cancelar,
  listarPorMesa,
  cuentaDeMiMesa,
};
