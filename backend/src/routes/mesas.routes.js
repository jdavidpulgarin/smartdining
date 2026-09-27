const express = require('express');
const ctrl = require('../controllers/mesas.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.listar);

// Públicas: las usa la PWA del comensal al escanear el QR de la mesa.
router.get('/qr/:token', ctrl.obtenerPorToken);
router.post('/qr/:token/sesion', ctrl.crearSesionPorToken);

router.get('/:id', ctrl.obtener);
router.post('/', requireAuth, requireRole('admin'), ctrl.crear);
router.patch('/:id/estado', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.actualizarEstado);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminar);

module.exports = router;
