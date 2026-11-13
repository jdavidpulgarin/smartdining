const express = require('express');
const ctrl = require('../controllers/clientes-auth.controller');
const { crearLimitadoresClientes } = require('../middleware/limites.middleware');

/**
 * D-19 parte B: /api/v1/auth/clientes/... (solo v1, ver solo-v1.js).
 *
 * Públicas: no llevan Authorization. Logout tampoco (el JWT puede haber
 * vencido; quien tiene el refresh token es quien puede revocarlo).
 *
 * Los limitadores se crean UNA vez, al cargar este módulo: cada ruta lleva su
 * par [IP, cuenta], y logout usa el MISMO par que refresh (comparten contador).
 */
const limites = crearLimitadoresClientes();

const router = express.Router();

router.post('/registro', ...limites.registro, ctrl.registro);
router.post('/login', ...limites.login, ctrl.login);
router.post('/refresh', ...limites.refresh, ctrl.refresh);
router.post('/logout', ...limites.logout, ctrl.logout);

module.exports = router;
