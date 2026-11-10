const express = require('express');

const authRoutes = require('./auth.routes');
const usuariosRoutes = require('./usuarios.routes');
const categoriasRoutes = require('./categorias.routes');
const platosRoutes = require('./platos.routes');
const menuRoutes = require('./menu.routes');
const pasosRoutes = require('./pasos.routes');
const ingredientesRoutes = require('./ingredientes.routes');
const mesasRoutes = require('./mesas.routes');
const pedidosRoutes = require('./pedidos.routes');
const kdsRoutes = require('./kds.routes');
const transaccionesRoutes = require('./transacciones.routes');
const pagosRoutes = require('./pagos.routes');
const reportesRoutes = require('./reportes.routes');
const configuracionRoutes = require('./configuracion.routes');
const inventarioRoutes = require('./inventario.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
// D-16: administracion de usuarios del personal, solo admin.
router.use('/usuarios', usuariosRoutes);
router.use('/categorias', categoriasRoutes);
router.use('/platos', platosRoutes);
router.use('/menu', menuRoutes);
// D-04: pasos e ingredientes del constructor. Crear y listar los pasos de un
// plato vive en /api/platos/:id/pasos; estos son los recursos ya sueltos.
router.use('/pasos', pasosRoutes);
router.use('/ingredientes', ingredientesRoutes);
router.use('/mesas', mesasRoutes);
router.use('/pedidos', pedidosRoutes);
router.use('/kds', kdsRoutes);
router.use('/transacciones', transaccionesRoutes);
router.use('/pagos', pagosRoutes);
// D-07: metricas del panel de administracion.
router.use('/reportes', reportesRoutes);
// D-16 parte B: configuracion del restaurante. GET / es publica; el resto, admin.
router.use('/configuracion', configuracionRoutes);
// D-17 PR 2: insumos y movimientos de bodega, solo admin. Las recetas cuelgan
// del plato y de la opcion (/api/platos/:id/receta, /api/ingredientes/:id/receta).
router.use('/inventario', inventarioRoutes);

module.exports = router;
