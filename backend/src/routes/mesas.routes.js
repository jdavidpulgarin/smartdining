const express = require('express');
const ctrl = require('../controllers/mesas.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.listar);

// Pública: la usa la PWA del comensal al escanear el QR de la mesa.
router.post('/qr/:token/sesion', ctrl.crearSesionPorToken);

// Ciclo de vida de la sesión de mesa: el mesero abre (obtiene el QR) y cierra.
router.post('/:id/abrir', requireAuth, requireRole('mesero', 'admin'), ctrl.abrir);
router.post('/:id/liberar', requireAuth, requireRole('mesero', 'admin'), ctrl.liberar);

router.get('/:id', ctrl.obtener);
router.post('/', requireAuth, requireRole('admin'), ctrl.crear);
router.patch('/:id/estado', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.actualizarEstado);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminar);

module.exports = router;
