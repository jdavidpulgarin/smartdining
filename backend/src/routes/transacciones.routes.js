const express = require('express');
const ctrl = require('../controllers/transacciones.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// Regla de negocio: "Solo usuarios con rol admin o cajero pueden registrar pagos".
router.post('/', requireAuth, requireRole('admin', 'cajero'), ctrl.crear);
router.get('/pedido/:id_pedido', requireAuth, requireRole('admin', 'cajero'), ctrl.obtenerPorPedido);

module.exports = router;
