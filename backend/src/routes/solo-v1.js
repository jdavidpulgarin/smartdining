const express = require('express');

const clientesAuthRoutes = require('./clientes-auth.routes');

/**
 * D-19 parte B: las rutas que existen SOLO en /api/v1 (las de los clientes de
 * la app). En /api no se montan: /api/auth/clientes/login o /api/clientes/yo
 * dan el 404 de siempre.
 *
 * Es un agregador aparte del compartido (src/routes/index.js) a propósito: lo
 * que está en index.js responde en los dos prefijos, y lo de aquí solo en v1.
 * Ver src/routes/montaje.js.
 */
const router = express.Router();

router.use('/auth/clientes', clientesAuthRoutes);

// Los prefijos de arriba, vistos desde la app, están en src/config/rutas-clientes.js
// (PREFIJOS_CLIENTES): si se agrega un router aquí, hay que agregarlo allí.
module.exports = router;
