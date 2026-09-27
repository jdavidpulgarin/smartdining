const { z } = require('zod');
const transaccionesService = require('../services/transacciones.service');
const socketNotifier = require('../services/socket.notifier');

// Valores exactos de los CHECK de la tabla transacciones en el schema.sql de
// Jarrison. referencia_externa es la referencia de la pasarela de Roberto.
const METODOS_PAGO = ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'online'];
const ESTADOS_TRANSACCION = ['pendiente', 'completada', 'fallida', 'reembolsada'];

const pagoSchema = z.object({
  id_pedido: z.number().int(),
  monto: z.number().positive(),
  metodo_pago: z.enum(METODOS_PAGO),
  referencia_externa: z.string().optional(),
  estado_transaccion: z.enum(ESTADOS_TRANSACCION).optional(),
});

async function crear(req, res, next) {
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const { transaccion, pedidoLiquidado, id_mesa } = await transaccionesService.registrarPago({
      ...parsed.data,
      id_usuario: req.user.id_usuario,
    });

    // Solo un cobro efectivo cierra la sesión de mesa. Se avisa al socket-server
    // para que invalide los QR emitidos y borre el carrito y las suscripciones
    // push de esa mesa, de modo que el grupo siguiente empiece limpio.
    if (pedidoLiquidado) {
      socketNotifier.notificarCambioEstado({
        id_pedido: transaccion.id_pedido,
        id_mesa,
        estado_anterior: 'entregado',
        estado: 'pagado',
      });
      socketNotifier.notificarMesaLiberada(id_mesa);
    }

    return res.status(201).json(transaccion);
  } catch (err) {
    return next(err);
  }
}

async function obtenerPorPedido(req, res, next) {
  try {
    const transacciones = await transaccionesService.obtenerPorPedido(req.params.id_pedido);
    return res.json({ transacciones });
  } catch (err) {
    return next(err);
  }
}

module.exports = { crear, obtenerPorPedido, METODOS_PAGO, ESTADOS_TRANSACCION };
