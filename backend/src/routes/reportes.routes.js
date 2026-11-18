const express = require('express');
const ctrl = require('../controllers/reportes.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

// D-07. Solo admin: son cifras de negocio. A cocina, mesero y cajero no les
// hace falta el ticket promedio ni el reparto por metodo de pago para trabajar,
// y cada rol de mas es una copia mas de la contabilidad en una pantalla.
const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), ctrl.obtener);
// Consumo de inventario por insumo y día (plan v1.1, D-17 P3). Solo admin.
router.get('/consumo', requireAuth, requireRole('admin'), ctrl.consumo);

module.exports = router;
