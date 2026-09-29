const kdsService = require('../services/kds.service');
const socketNotifier = require('../services/socket.notifier');

// Desde el KDS, el cocinero solo puede mover una comanda entre estos dos
// estados (marcar "en preparación" o "listo"). Cancelar o cobrar se hace
// desde otros módulos, no desde la pantalla táctil de cocina.
const ESTADOS_PERMITIDOS_KDS = ['en_preparacion', 'listo'];

async function comandasActivas(req, res, next) {
  try {
    const comandas = await kdsService.comandasActivas();
    return res.json({ comandas });
  } catch (err) {
    return next(err);
  }
}

async function cambiarEstado(req, res, next) {
  const { estado } = req.body;
  if (!ESTADOS_PERMITIDOS_KDS.includes(estado)) {
    return res.status(400).json({
      error: `Desde el KDS solo se puede cambiar a: ${ESTADOS_PERMITIDOS_KDS.join(', ')}`,
    });
  }

  try {
    const pedido = await kdsService.cambiarEstado(
      req.params.id,
      estado,
      'Actualizado desde KDS',
      req.user.id_usuario
    );
    if (!pedido) return res.status(404).json({ error: 'Comanda no encontrada' });

    // El comensal ve avanzar su pedido y el panel admin se entera en vivo.
    // (No existe un evento order:item_ready en socket-server/EVENTS.md: el
    // avance de la comanda se comunica con order:status.)
    socketNotifier.notificarCambioEstado(pedido);
    if (pedido.mesaLiberada) socketNotifier.notificarMesaLiberada(pedido.id_mesa);

    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

module.exports = { comandasActivas, cambiarEstado };
