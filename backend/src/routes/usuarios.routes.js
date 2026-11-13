const express = require('express');
const ctrl = require('../controllers/usuarios.controller');
const domiciliosCtrl = require('../controllers/domicilios.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * Administración de usuarios del personal (D-16, parte A).
 *
 * TODO es solo de `admin`, sin excepciones: aquí se reparte quién puede entrar
 * y con qué permisos, así que no hay ninguna lectura "inofensiva" que abrir a
 * otro rol. El alta sigue viviendo en POST /api/auth/register, que ya es de
 * admin: no se duplica aquí.
 *
 * Dar de baja no existe a propósito: `usuarios` está referenciada por pedidos y
 * pagos, así que borrar una fila sería perder quién cobró qué. Lo que se hace es
 * desactivar (`activo: false`), que es lo que el middleware comprueba en cada
 * petición (H-09).
 */
router.get('/', requireAuth, requireRole('admin'), ctrl.listar);
// D-20a: la ÚNICA lectura que no es solo de admin. El despacho (admin y cajero)
// necesita a quién asignar una entrega: solo id y nombre de los repartidores
// activos, nada más de la tabla.
router.get('/repartidores', requireAuth, requireRole('admin', 'cajero'), domiciliosCtrl.listarRepartidores);
router.patch('/:id', requireAuth, requireRole('admin'), ctrl.actualizar);

// POST y no PATCH: no es editar un campo, es ejecutar un cambio de credencial.
// La clave viaja en el cuerpo y no se guarda ni se devuelve en ninguna parte.
router.post('/:id/clave', requireAuth, requireRole('admin'), ctrl.cambiarClave);

module.exports = router;
