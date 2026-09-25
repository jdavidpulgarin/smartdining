const express = require('express');
const ctrl = require('../controllers/kds.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

// La pantalla de cocina usa el rol 'cocina' (ya existe en usuarios.rol según
// docs/modelo-er.md). Se deja también 'admin' para soporte y demos.
const router = express.Router();

router.get('/comandas', requireAuth, requireRole('cocina', 'admin'), ctrl.comandasActivas);
router.patch('/comandas/:id/estado', requireAuth, requireRole('cocina', 'admin'), ctrl.cambiarEstado);

module.exports = router;
