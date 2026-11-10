const express = require('express');
const ctrl = require('../controllers/inventario.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * Inventario del panel (D-17 PR 2).
 *
 * TODO es de admin, también las lecturas: el inventario dice cuánto queda y
 * cuánto cuesta cada cosa, que es información del negocio y no de sala. El
 * `mesero` y el `cajero` se enteran de lo que se agota por el aviso en vivo
 * `inventario:alerta` (EVENTS.md §5.5), que es lo que necesitan para no ofrecer
 * lo que no hay.
 *
 * No hay DELETE: un insumo no se borra, se desactiva con
 * `PUT /insumos/:id {"activo": false}`. Las recetas y los movimientos lo
 * referencian con ON DELETE RESTRICT, así que borrarlo sería borrar el libro de
 * inventario.
 */
const soloAdmin = [requireAuth, requireRole('admin')];

// D-17 PR 3: la carta con su disponibilidad y si tiene receta, para la pestaña
// de Recetas del panel (P-22). Es de solo lectura: sale de v_carta_disponible.
router.get('/carta', ...soloAdmin, ctrl.obtenerCarta);

router.get('/insumos', ...soloAdmin, ctrl.listarInsumos);
router.post('/insumos', ...soloAdmin, ctrl.crearInsumo);

// Las rutas con sufijo van ANTES de las de ':id' a secas por claridad; aquí no
// hay ambigüedad posible porque el método o el sufijo las distinguen.
// D-17 PR 3 (P2): donde se usa ese insumo (que recetas lo llevan).
router.get('/insumos/:id/usos', ...soloAdmin, ctrl.usosDeInsumo);

router.get('/insumos/:id/movimientos', ...soloAdmin, ctrl.listarMovimientos);
router.post('/insumos/:id/movimientos', ...soloAdmin, ctrl.registrarMovimiento);

router.get('/insumos/:id', ...soloAdmin, ctrl.obtenerInsumo);
router.put('/insumos/:id', ...soloAdmin, ctrl.actualizarInsumo);

module.exports = router;
