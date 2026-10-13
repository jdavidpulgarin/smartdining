const express = require('express');
const ctrl = require('../controllers/transacciones.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireInternalKey } = require('../middleware/interno.middleware');

const router = express.Router();

// Regla de negocio: "Solo usuarios con rol admin o cajero pueden registrar pagos".
router.post('/', requireAuth, requireRole('admin', 'cajero'), ctrl.crear);
// Canal interno: lo llama el socket-server tras verificar el pago con Wompi
// (EVENTS.md §8.4). Sin JWT y sin rol: autentica la clave compartida.
router.post('/internal', requireInternalKey, ctrl.crearInterno);

router.get('/pedido/:id_pedido', requireAuth, requireRole('admin', 'cajero'), ctrl.obtenerPorPedido);

module.exports = router;
