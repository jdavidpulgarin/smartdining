const express = require('express');
const ctrl = require('../controllers/zonas.controller');
const { requireAuth, requireRole, ROL_CLIENTE } = require('../middleware/auth.middleware');

/** D-19 parte B: /api/v1/zonas (solo v1, ver solo-v1.js). */
const router = express.Router();

// Pública: la app la muestra antes de que el cliente inicie sesión.
router.get('/', ctrl.listar);
// Cotiza UNA dirección del cliente del JWT.
router.get('/cotizar', requireAuth, requireRole(ROL_CLIENTE), ctrl.cotizar);

module.exports = router;
