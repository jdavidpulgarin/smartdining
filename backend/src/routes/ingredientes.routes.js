const express = require('express');
const ctrl = require('../controllers/constructor.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// D-04. PATCH /:id/disponible (agotar o reponer un ingrediente en vivo) es
// D-05: va con el aviso ingrediente:disponibilidad al socket-server.
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizarIngrediente);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminarIngrediente);

module.exports = router;
