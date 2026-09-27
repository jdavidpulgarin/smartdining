const express = require('express');
const ctrl = require('../controllers/pedidos.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/', requireAuth, requireRole('comensal', 'mesero', 'admin'), ctrl.crear);
router.get('/activos', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.listarActivos);

// Debe declararse antes de /:id para que 'mesa' no se lea como un id.
router.get('/mesa', requireAuth, requireRole('comensal'), ctrl.listarPorMesa);

router.get('/:id', requireAuth, ctrl.obtener);
router.patch('/:id/estado', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.actualizarEstado);
router.post('/:id/cancelar', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.cancelar);

module.exports = router;
