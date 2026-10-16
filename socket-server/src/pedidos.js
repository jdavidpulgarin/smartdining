const { exito, fallo, manejar } = require('./ack');
const { log } = require('./log');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa, SALA_KDS, SALA_ADMIN, esIdValido } = require('./salas');
const { notificarCambioEstado } = require('./suscripciones');
const { enviarAck, leerCuerpoCrudo, parsearJson, exigirClaveInterna } = require('./http');

// Mismos valores que el CHECK del backend. Solo se usan para rechazar basura;
// la validez de la TRANSICIÓN la decide el trigger de la base de datos.
const ESTADOS_PEDIDO = ['recibido', 'en_preparacion', 'listo', 'entregado', 'pagado', 'cancelado'];

const ROLES_EMITEN_CREADO = ['mesero', 'admin'];

/** Valida el payload de order:created. Devuelve mensaje de error o null. */
function validarPedidoCreado(p) {
  if (!p.pedido || typeof p.pedido !== 'object') return 'pedido es obligatorio';
  if (!esIdValido(p.pedido.id_pedido)) return 'pedido.id_pedido debe ser un entero positivo';
  if (!esIdValido(p.pedido.id_mesa)) return 'pedido.id_mesa debe ser un entero positivo';
  if (!ESTADOS_PEDIDO.includes(p.pedido.estado)) return `pedido.estado debe ser uno de: ${ESTADOS_PEDIDO.join(', ')}`;
  return null;
}

/**
 * Lógica única de order:created, compartida por el socket (personal) y por el
 * HTTP interno (backend). Así ambas vías validan, deduplican y difunden igual.
 */
async function difundirPedidoCreado(ctx, p) {
  const { io, carritos, registro } = ctx;
  if (!esEventIdValido(p.eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
  const errorPayload = validarPedidoCreado(p);
  if (errorPayload) return fallo('PAYLOAD_INVALIDO', errorPayload, { eventId: p.eventId });

  const { pedido } = p;
  // Doble guardia: por eventId (reintento exacto) y por id_pedido (por si el
  // emisor reintenta con un eventId nuevo). Sin esto, la cocina vería la
  // misma comanda dos veces.
  const claveEvento = `order:created:${p.eventId}`;
  const clavePedido = `order:created:pedido:${pedido.id_pedido}`;
  // reservar es atómico (SET NX en Redis): dos envíos simultáneos del mismo
  // pedido no pueden pasar ambos el chequeo. Se reservan las dos claves; si
  // cualquiera ya existía, es un duplicado.
  const nuevoEvento = await registro.reservar(claveEvento);
  const nuevoPedido = await registro.reservar(clavePedido);
  if (!nuevoEvento || !nuevoPedido) {
    return exito({ eventId: p.eventId, duplicado: true });
  }

  // Encadenar .to() envía UNA sola vez a un socket que esté en varias de estas
  // salas (p. ej. un admin, que está en KDS y en Admin).
  io.to(SALA_KDS).to(SALA_ADMIN).to(salaMesa(pedido.id_mesa)).emit('order:created', {
    eventId: p.eventId,
    pedido,
    emitidoEn: new Date().toISOString(),
  });

  // Quiénes pidieron: el backend pone en cada ítem el alias del JWT de quien
  // envió el pedido. Sin alias (pedido del personal) no se toca el carrito:
  // no hay forma de saber qué líneas se convirtieron en este pedido.
  const alias = aliasDelPedido(pedido);
  if (alias.size === 0) return exito({ eventId: p.eventId, duplicado: false });

  // Dueños para el push "¡Tu plato está listo!": solo quienes pidieron, no
  // todos los que tienen algo en el carrito de la mesa.
  if (ctx.duenosPedidos) await ctx.duenosPedidos.guardar(pedido.id_pedido, alias);

  // Cada comensal envía solo SUS platos: se quitan sus líneas y las de los
  // demás siguen en el carrito. Es una sola operación atómica del almacén, así
  // que un cart:update simultáneo no puede colarse ni perderse.
  const r = await carritos.aplicarUnaVez(
    pedido.id_mesa,
    { accion: 'remove_de', comensales: [...alias] },
    `sistema:cart:${pedido.id_mesa}:${p.eventId}`,
  );
  if (!r.error && !r.duplicado && !r.sinCambios) {
    io.to(salaMesa(pedido.id_mesa)).emit('cart:updated', {
      eventId: p.eventId,
      origen: 'sistema',
      carrito: r.snapshot,
    });
  }
  return exito({ eventId: p.eventId, duplicado: false });
}

const MAX_ALIAS = 40; // igual que MAX_APODO del carrito

/** Alias únicos y no vacíos de pedido.items[].comensal. */
function aliasDelPedido(pedido) {
  const alias = new Set();
  for (const item of Array.isArray(pedido.items) ? pedido.items : []) {
    if (item && typeof item.comensal === 'string') {
      const a = item.comensal.trim();
      if (a && a.length <= MAX_ALIAS) alias.add(a);
    }
  }
  return alias;
}

const ROLES_EMITEN_ESTADO = ['cocina', 'mesero', 'cajero', 'admin'];
// Igual que en el backend (PATCH /kds/comandas/:id/estado): la cocina solo
// puede mover un pedido a estos dos estados. Se replica aquí para que un KDS
// comprometido no pueda anunciar "entregado" o "pagado" por el socket.
const ESTADOS_PERMITIDOS_COCINA = ['en_preparacion', 'listo'];

/** Valida el payload de order:status. Devuelve mensaje de error o null. */
function validarCambioEstado(p) {
  if (!esIdValido(p.id_pedido)) return 'id_pedido debe ser un entero positivo';
  if (!esIdValido(p.id_mesa)) return 'id_mesa debe ser un entero positivo';
  if (!ESTADOS_PEDIDO.includes(p.estado)) return `estado debe ser uno de: ${ESTADOS_PEDIDO.join(', ')}`;
  if (p.estado_anterior !== undefined && p.estado_anterior !== null && !ESTADOS_PEDIDO.includes(p.estado_anterior)) {
    return 'estado_anterior no es un estado válido';
  }
  if (p.codigo_pedido !== undefined && p.codigo_pedido !== null
    && (typeof p.codigo_pedido !== 'string' || p.codigo_pedido.length > 40)) {
    return 'codigo_pedido debe ser un texto de hasta 40 caracteres';
  }
  return null;
}

/**
 * Lógica única de order:status (socket y HTTP interno). Reenvía solo los
 * campos conocidos, no el objeto entero: así un emisor no puede colar datos
 * arbitrarios hacia las pantallas de cocina y de los comensales.
 */
async function difundirCambioEstado(ctx, p) {
  const { io, registro } = ctx;
  if (!esEventIdValido(p.eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
  const errorPayload = validarCambioEstado(p);
  if (errorPayload) return fallo('PAYLOAD_INVALIDO', errorPayload, { eventId: p.eventId });

  // Un mismo pedido pasa por varios estados, así que aquí la clave es SOLO el
  // eventId (no el id_pedido): cada cambio legítimo trae su propio eventId.
  const claveEvento = `order:status:${p.eventId}`;
  if (!(await registro.reservar(claveEvento))) return exito({ eventId: p.eventId, duplicado: true });

  const cambio = {
    eventId: p.eventId,
    id_pedido: p.id_pedido,
    id_mesa: p.id_mesa,
    codigo_pedido: p.codigo_pedido ?? null,
    estado_anterior: p.estado_anterior ?? null,
    estado: p.estado,
    emitidoEn: new Date().toISOString(),
  };
  io.to(SALA_KDS).to(SALA_ADMIN).to(salaMesa(p.id_mesa)).emit('order:status', cambio);

  // Push para el comensal que ya cerró la PWA. Sin await a propósito: un
  // servicio push lento no debe retrasar el ack; y notificarCambioEstado
  // no lanza, pero el catch protege el proceso de un rechazo no capturado.
  notificarCambioEstado(ctx, cambio).catch((err) => log.error('push: fallo al notificar', { id_pedido: cambio.id_pedido, error: err }));
  return exito({ eventId: p.eventId, duplicado: false });
}

function registrarPedidos(socket, ctx) {
  const identidad = socket.data.identidad;

  socket.on('order:status', manejar('order:status', (p) => {
    if (!ROLES_EMITEN_ESTADO.includes(identidad.rol)) {
      return fallo('NO_AUTORIZADO', 'Tu rol no puede emitir order:status', { eventId: p.eventId });
    }
    if (identidad.rol === 'cocina' && !ESTADOS_PERMITIDOS_COCINA.includes(p.estado)) {
      return fallo('NO_AUTORIZADO', 'La cocina solo puede pasar a en_preparacion o listo', { eventId: p.eventId });
    }
    return difundirCambioEstado(ctx, p);
  }));

  socket.on('order:created', manejar('order:created', (p) => {
    // Un comensal NO puede emitirlo: podría inventar comandas falsas en la
    // cocina. La fuente de verdad es el backend (HTTP interno) o el personal.
    if (!ROLES_EMITEN_CREADO.includes(identidad.rol)) {
      return fallo('NO_AUTORIZADO', 'Tu rol no puede emitir order:created', { eventId: p.eventId });
    }
    return difundirPedidoCreado(ctx, p);
  }));
}

/** Rutas HTTP internas que consume el backend. */
const rutasPedidos = {
  'POST /internal/order-created': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    enviarAck(res, await difundirPedidoCreado(ctx, cuerpo));
  },
  'POST /internal/order-status': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    enviarAck(res, await difundirCambioEstado(ctx, cuerpo));
  },
};

module.exports = {
  registrarPedidos, rutasPedidos, difundirPedidoCreado, difundirCambioEstado, ESTADOS_PEDIDO,
};
