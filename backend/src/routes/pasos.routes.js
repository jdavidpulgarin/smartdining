const express = require('express');
const ctrl = require('../controllers/constructor.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

// D-04. Escribir el constructor es de admin; leerlo lo necesita todo el
// personal de sala (el panel muestra los pasos al armar un pedido).
//
// Un paso NO se agota: pasos_constructor no tiene columna `disponible` y D-05
// es solo de ingredientes (PATCH /ingredientes/:id/disponible). Lo que se apaga
// son las opciones, no la pregunta.
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizarPaso);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminarPaso);

router.post(
  '/:id/ingredientes',
  requireAuth,
  requireRole('admin'),
  ctrl.crearIngrediente
);

module.exports = router;
