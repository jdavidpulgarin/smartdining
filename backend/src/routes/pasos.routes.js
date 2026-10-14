const express = require('express');
const ctrl = require('../controllers/constructor.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// D-04. Escribir el constructor es de admin; leerlo lo necesita todo el
// personal de sala (el panel muestra los pasos al armar un pedido).
// PATCH /:id/disponible es D-05 y aqui todavia no existe.
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizarPaso);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminarPaso);

router.post(
  '/:id/ingredientes',
  requireAuth,
  requireRole('admin'),
  ctrl.crearIngrediente
);

module.exports = router;
