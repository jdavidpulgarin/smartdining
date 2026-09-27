const kdsService = require('../services/kds.service');

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
    // NOTA para Roberto: aquí se dispara 'order:status' (o 'order:item_ready')
    // hacia el cliente y el panel admin.
    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

module.exports = { comandasActivas, cambiarEstado };
