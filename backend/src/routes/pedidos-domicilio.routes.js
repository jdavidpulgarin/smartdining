const express = require('express');
const ctrl = require('../controllers/pedidos-domicilio.controller');
const { requireAuth, requireRole, ROL_CLIENTE } = require('../middleware/auth.middleware');
const { requireInternalKey } = require('../middleware/interno.middleware');

/**
 * D-20b: pedidos para llevar y a domicilio de la app.
 *
 * `cliente`: solo en /api/v1 (lo monta src/routes/solo-v1.js). Del cliente del
 * JWT: ningún otro rol entra (403).
 * `interno`: el canal del socket-server, con x-internal-key (lo monta el router
 * compartido; su segmento `interno` lo deja fuera de v1, src/routes/montaje.js).
 */
const soloCliente = [requireAuth, requireRole(ROL_CLIENTE)];

const cliente = express.Router();
cliente.post('/', ...soloCliente, ctrl.crear);
cliente.get('/mios', ...soloCliente, ctrl.listarMios);
// Después de /mios: si no, "mios" se tomaría como un :id.
cliente.get('/:id', ...soloCliente, ctrl.obtener);
cliente.post('/:id/cancelar', ...soloCliente, ctrl.cancelar);

const interno = express.Router();
interno.get('/:id/cobro/interno', requireInternalKey, ctrl.cobroInterno);
interno.post('/:id/pago/interno', requireInternalKey, ctrl.pagoInterno);

module.exports = { cliente, interno };
