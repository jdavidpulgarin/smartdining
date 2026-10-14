const express = require('express');
const { register, login } = require('../controllers/auth.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { crearLimitadorLogin } = require('../middleware/limites.middleware');

const router = express.Router();

// Solo un admin puede dar de alta usuarios del personal. El primer admin sale
// del seed.sql de Jarrison, no de este endpoint.
router.post('/register', requireAuth, requireRole('admin'), register);
// H-04: sin límite, el login aguanta una fuerza bruta cómoda (40 intentos en
// 2,75 s medidos en la auditoría). El limitador cuenta solo los fallos.
router.post('/login', crearLimitadorLogin(), login);

module.exports = router;
