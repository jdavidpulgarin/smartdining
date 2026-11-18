const express = require('express');
const ctrl = require('../controllers/imagenes.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { crearLimitadorImagenes } = require('../middleware/limites.middleware');

const router = express.Router();

/**
 * D-23: subida de imágenes del menú. Solo admin.
 *
 * El orden importa: primero la sesión y el rol (un 401/403 no lee el cuerpo),
 * después el límite por usuario (que necesita req.user) y solo entonces multer
 * lee el archivo, en memoria.
 */
router.post('/', requireAuth, requireRole('admin'), crearLimitadorImagenes(), ctrl.recibirArchivo, ctrl.subir);

module.exports = router;
