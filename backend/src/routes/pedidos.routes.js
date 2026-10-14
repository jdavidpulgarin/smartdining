const express = require('express');
const ctrl = require('../controllers/pedidos.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/', requireAuth, requireRole('comensal', 'mesero', 'admin'), ctrl.crear);
router.get('/activos', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.listarActivos);

// Debe declararse antes de /:id para que 'mesa' no se lea como un id.
router.get('/mesa', requireAuth, requireRole('comensal'), ctrl.listarPorMesa);
// Sin parámetro a propósito: la mesa sale del JWT, nunca de la URL.
router.get('/mesa/cuenta', requireAuth, requireRole('comensal'), ctrl.cuentaDeMiMesa);

// S-26: antes bastaba con estar autenticado, así que el rol `cocina` podía leer
// el pedido COMPLETO de cualquier mesa: totales, alias de cada comensal y la
// cuenta. La cocina no necesita nada de eso —trabaja con sus comandas en
// /api/kds/comandas, que no pasan por aquí— así que se le cierra.
//
// `comensal` sí entra: es el dueño del pedido. Lo que puede ver lo acotan las
// dos guardas del controller (su mesa y solo su visita), no este middleware.
router.get(
  '/:id',
  requireAuth,
  requireRole('admin', 'cajero', 'mesero', 'comensal'),
  ctrl.obtener
);
router.patch('/:id/estado', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.actualizarEstado);
router.post('/:id/cancelar', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.cancelar);

module.exports = router;
