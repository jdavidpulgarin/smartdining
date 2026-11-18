const express = require('express');
const ctrl = require('../controllers/clientes.controller');
const { requireAuth, requireRole, ROL_CLIENTE } = require('../middleware/auth.middleware');

/**
 * D-19 parte B: /api/v1/clientes/yo... (solo v1, ver solo-v1.js).
 * Todas son del cliente del JWT: ningún otro rol entra (403), y ninguna toma
 * el id del cliente de la URL ni del cuerpo.
 */
const soloCliente = [requireAuth, requireRole(ROL_CLIENTE)];

const router = express.Router();

router.get('/yo', ...soloCliente, ctrl.obtenerPerfil);
router.patch('/yo', ...soloCliente, ctrl.actualizarPerfil);
router.get('/yo/direcciones', ...soloCliente, ctrl.listarDirecciones);
router.post('/yo/direcciones', ...soloCliente, ctrl.crearDireccion);
router.patch('/yo/direcciones/:id', ...soloCliente, ctrl.actualizarDireccion);
router.delete('/yo/direcciones/:id', ...soloCliente, ctrl.eliminarDireccion);

module.exports = router;
