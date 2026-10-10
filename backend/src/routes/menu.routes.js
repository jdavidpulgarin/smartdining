const express = require('express');
const ctrl = require('../controllers/menu.controller');

const router = express.Router();

// Público y de solo lectura: el comensal carga la carta antes de tener sesión
// de mesa, así que no lleva JWT (igual que GET /categorias y GET /platos).
router.get('/', ctrl.obtener);

module.exports = router;
