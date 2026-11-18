const express = require('express');
const ctrl = require('../controllers/zonas-envio.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

/**
 * D-20a: zonas de entrega para el admin, en el router COMPARTIDO (existen en
 * /api y en /api/v1). Ruta distinta de la pública /api/v1/zonas (D-19). No hay
 * DELETE: una zona se desactiva con PATCH { activa: false }.
 */
const soloAdmin = [requireAuth, requireRole('admin')];

const router = express.Router();

router.get('/', ...soloAdmin, ctrl.listar);
router.post('/', ...soloAdmin, ctrl.crear);
router.patch('/:id', ...soloAdmin, ctrl.editar);

module.exports = router;
