const express = require('express');
const ctrl = require('../controllers/platos.controller');
const constructorCtrl = require('../controllers/constructor.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', ctrl.listar); // soporta ?id_categoria=

// D-04: los pasos del constructor cuelgan del plato, porque un paso no existe
// fuera de su plato. Van ANTES de /:id para que 'pasos' no se lea como un id.
// Editar y borrar un paso ya suelto vive en /api/pasos/:id.
router.get(
  '/:id/pasos',
  requireAuth,
  requireRole('admin', 'cajero', 'mesero'),
  constructorCtrl.listarPasos
);
router.post(
  '/:id/pasos',
  requireAuth,
  requireRole('admin'),
  constructorCtrl.crearPaso
);

router.get('/:id', ctrl.obtener);

router.post('/', requireAuth, requireRole('admin'), ctrl.crear);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizar);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminar);

module.exports = router;
