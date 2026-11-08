const express = require('express');
const ctrl = require('../controllers/constructor.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// D-04. Escribir el constructor es de admin.
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizarIngrediente);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminarIngrediente);

// D-05. La ÚNICA escritura del constructor que no es solo de admin: agotar o
// reponer no es editar la carta, es reportar lo que pasa en la cocina, y es lo
// que usa el panel de agotados del KDS (D-10). Va con el aviso
// ingrediente:disponibilidad al socket-server (EVENTS.md §5.3).
router.patch(
  '/:id/disponible',
  requireAuth,
  requireRole('admin', 'cocina'),
  ctrl.cambiarDisponibilidadIngrediente
);

module.exports = router;
