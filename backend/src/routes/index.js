const express = require('express');

const authRoutes = require('./auth.routes');
const categoriasRoutes = require('./categorias.routes');
const platosRoutes = require('./platos.routes');
const mesasRoutes = require('./mesas.routes');
const pedidosRoutes = require('./pedidos.routes');
const kdsRoutes = require('./kds.routes');
const transaccionesRoutes = require('./transacciones.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/categorias', categoriasRoutes);
router.use('/platos', platosRoutes);
router.use('/mesas', mesasRoutes);
router.use('/pedidos', pedidosRoutes);
router.use('/kds', kdsRoutes);
router.use('/transacciones', transaccionesRoutes);

module.exports = router;
