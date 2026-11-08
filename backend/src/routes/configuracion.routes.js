const express = require('express');
const ctrl = require('../controllers/configuracion.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * Configuración del restaurante (D-16 parte B).
 *
 * La lectura pública va PRIMERO y sin guarda: la PWA del comensal necesita el
 * nombre, el horario, la moneda y la propina sugerida antes de escanear nada, y
 * son los mismos datos que cualquiera ve en la puerta del local.
 *
 * `/completa` va ANTES de nada que pueda capturarla y es de `admin`: añade
 * `actualizado_en` y `actualizado_por`, que son auditoría.
 */
router.get('/', ctrl.obtenerPublica);
router.get('/completa', requireAuth, requireRole('admin'), ctrl.obtenerCompleta);
router.put('/', requireAuth, requireRole('admin'), ctrl.actualizar);

module.exports = router;
