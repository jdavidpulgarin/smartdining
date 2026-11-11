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

// Cierre de caja (P1, propuesta de Roberto): las completadas desde ?desde=hoy o
// AAAA-MM-DD hasta el final de hoy, en días de Bogotá.
// Mismos roles que registrar un pago: es la misma caja mirando su propio día.
router.get('/', requireAuth, requireRole('admin', 'cajero'), ctrl.listarDelDia);

module.exports = router;
