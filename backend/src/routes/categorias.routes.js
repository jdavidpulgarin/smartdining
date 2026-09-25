const express = require('express');
const ctrl = require('../controllers/categorias.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obtener);

router.post('/', requireAuth, requireRole('admin'), ctrl.crear);
router.put('/:id', requireAuth, requireRole('admin'), ctrl.actualizar);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminar);

module.exports = router;
