const express = require('express');
const ctrl = require('../controllers/domicilios.controller');
const { requireAuth, requireRole, ROL_REPARTIDOR } = require('../middleware/auth.middleware');

/**
 * D-20a: despacho de domicilios y repartidor. En el router compartido: existe
 * en /api y en /api/v1.
 *
 * Despacho: admin y cajero. Repartidor: solo `repartidor`, y solo sobre SUS
 * entregas (403 no_es_tu_entrega si no es suya).
 */
const despacho = [requireAuth, requireRole('admin', 'cajero')];
const repartidor = [requireAuth, requireRole(ROL_REPARTIDOR)];

const router = express.Router();

router.get('/', ...despacho, ctrl.listarDespacho);
// Antes de cualquier /:id_pedido, para que 'mios' no se lea como un id.
router.get('/mios', ...repartidor, ctrl.listarMias);
router.patch('/:id_pedido/repartidor', ...despacho, ctrl.asignarRepartidor);
router.post('/:id_pedido/salir', ...repartidor, ctrl.salir);
router.post('/:id_pedido/entregar', ...repartidor, ctrl.entregar);
router.post('/:id_pedido/fallar', ...repartidor, ctrl.fallar);

module.exports = router;
