const express = require('express');
const ctrl = require('../controllers/mesas.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { requireInternalKey } = require('../middleware/interno.middleware');
const { crearLimitadorQr } = require('../middleware/limites.middleware');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.listar);

// Pública: la usa la PWA del comensal al escanear el QR de la mesa.
// H-27: es la otra ruta sin sesión previa, así que también va limitada (más
// holgada que el login: una mesa entera escanea desde la misma IP del local).
router.post('/qr/:token/sesion', crearLimitadorQr(), ctrl.crearSesionPorToken);

// Ciclo de vida de la sesión de mesa: el mesero abre (obtiene el QR) y cierra.
router.post('/:id/abrir', requireAuth, requireRole('mesero', 'admin'), ctrl.abrir);
router.post('/:id/liberar', requireAuth, requireRole('mesero', 'admin'), ctrl.liberar);
// Rotación manual del QR de una mesa abierta. Ningún frontend llama a
// /internal/* del socket-server: lo hace el backend tras guardar el token.
router.post('/:id/rotar-qr', requireAuth, requireRole('mesero', 'admin'), ctrl.rotarQr);

// Canal interno servidor-a-servidor: la llama el socket-server con
// x-internal-key y sin JWT (EVENTS.md §8.2). Va ANTES de GET /:id para que no
// la capture la ruta pública de la mesa.
router.get('/:id/cuenta/interno', requireInternalKey, ctrl.cuentaInterna);
// Rotación AUTOMÁTICA del QR (socket-server/docs/rotacion-qr.md): la pide el
// socket-server cada 3 minutos con la mesa abierta y vacía. Interna como la de
// arriba, y también antes de las rutas /:id.
router.post('/:id/token-qr/interno', requireInternalKey, ctrl.rotarQrInterno);

// D-18: comensales SIN CELULAR de la mesa. Los da de alta el personal de sala,
// no el comensal: la persona no tiene teléfono con el que escanear el QR. Van
// antes de GET /:id y de PATCH /:id para que 'comensales' no se lea como un id.
router.post('/:id/comensales', requireAuth, requireRole('mesero', 'admin'), ctrl.agregarComensal);
router.delete('/:id/comensales/:alias', requireAuth, requireRole('mesero', 'admin'), ctrl.quitarComensal);

// La cuenta del personal. Va antes de GET /:id (si no, 'cuenta' se leería como
// parte del id) y después de /cuenta/interno, que es ruta distinta por el
// segmento extra y no se solapa con esta.
router.get('/:id/cuenta', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.cuenta);

router.get('/:id', ctrl.obtener);
router.post('/', requireAuth, requireRole('admin'), ctrl.crear);
router.patch('/:id/estado', requireAuth, requireRole('admin', 'cajero', 'mesero'), ctrl.actualizarEstado);
// D-16: editar los datos del mobiliario (numero, capacidad, ubicacion). Solo
// admin, y va DESPUES de /:id/estado para no capturar esa ruta.
router.patch('/:id', requireAuth, requireRole('admin'), ctrl.actualizarDatos);
router.delete('/:id', requireAuth, requireRole('admin'), ctrl.eliminar);

module.exports = router;
