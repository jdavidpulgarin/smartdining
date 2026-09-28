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
    const { transaccion, pedidoLiquidado, mesaLiberada, id_mesa } =
      await transaccionesService.registrarPago({
        ...parsed.data,
        id_usuario: req.user.id_usuario,
      });

    if (pedidoLiquidado) {
      socketNotifier.notificarCambioEstado({
        id_pedido: transaccion.id_pedido,
        id_mesa,
        estado_anterior: 'entregado',
        estado: 'pagado',
      });
    }

    // La mesa se liberó en la transacción del cobro solo si no le quedaban
    // pedidos abiertos. Se avisa para que el socket-server cierre esa sesión:
    // aislado, porque la liberación ya está hecha y no se revierte.
    if (mesaLiberada) socketNotifier.notificarMesaLiberada(id_mesa);

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
