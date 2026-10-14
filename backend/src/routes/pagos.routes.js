const express = require('express');
const ctrl = require('../controllers/pagos.controller');
const { requireInternalKey } = require('../middleware/interno.middleware');

const router = express.Router();

// Solo canal interno: la bitácora de intentos fallidos la escribe el
// socket-server tras hablar con Wompi (EVENTS.md §8.5). Ningún frontend la usa.
router.post('/intentos-fallidos/interno', requireInternalKey, ctrl.registrarIntentoFallido);

module.exports = router;
