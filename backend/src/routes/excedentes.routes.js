const express = require('express');
const ctrl = require('../controllers/excedentes.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// T4 (EVENTS.md §8.7): los excedentes de pagos en línea de mesa, para la Caja.
// Mismos roles que las demás rutas de cobro: admin y cajero.
router.get('/', requireAuth, requireRole('admin', 'cajero'), ctrl.listar);
router.patch('/:id/devuelto', requireAuth, requireRole('admin', 'cajero'), ctrl.marcarDevuelto);

module.exports = router;
