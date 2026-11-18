/**
 * D-19 parte B: perfil y direcciones del cliente. Solo en /api/v1, con
 * requireAuth + requireRole('cliente').
 *
 * El cliente sale SIEMPRE del JWT (req.user.id_cliente, que puso requireAuth):
 * nunca de un id del cuerpo ni de la URL. El `:id` de las rutas de direcciones
 * es el de la dirección, y se busca junto con el id del cliente.
 */

const clientesService = require('../services/clientes.service');
const direccionesService = require('../services/direcciones.service');
const { errorConMotivo } = require('../utils/error-con-motivo');
const {
  MOTIVO,
  MENSAJE_CUERPO,
  validarPerfil,
  validarNuevaDireccion,
  validarCambioDireccion,
  idPositivo,
} = require('../utils/cliente-campos');

const responder400 = (res, { motivo, mensaje }) => res.status(400).json({ error: mensaje, motivo });

const noEncontrada = () => errorConMotivo(404, 'no_encontrado', direccionesService.MENSAJE_NO_ENCONTRADA);

/** GET /api/v1/clientes/yo */
async function obtenerPerfil(req, res, next) {
  try {
    const cliente = await clientesService.obtener(req.user.id_cliente);
    if (!cliente) return next(errorConMotivo(404, 'no_encontrado', 'Cliente no encontrado'));
    return res.json({ cliente: clientesService.clientePublico(cliente) });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /api/v1/clientes/yo: `{ nombre?, telefono? }` */
async function actualizarPerfil(req, res, next) {
  const v = validarPerfil(req.body);
  if (v.motivo) return responder400(res, v);
  try {
    const cliente = await clientesService.actualizarPerfil(req.user.id_cliente, v.datos);
    if (!cliente) return next(errorConMotivo(404, 'no_encontrado', 'Cliente no encontrado'));
    return res.json({ cliente: clientesService.clientePublico(cliente) });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/clientes/yo/direcciones: la principal primero. */
async function listarDirecciones(req, res, next) {
  try {
    const direcciones = await direccionesService.listar(req.user.id_cliente);
    return res.json({ direcciones });
  } catch (err) {
    return next(err);
  }
}

/** POST /api/v1/clientes/yo/direcciones */
async function crearDireccion(req, res, next) {
  const v = validarNuevaDireccion(req.body);
  if (v.motivo) return responder400(res, v);
  try {
    const direccion = await direccionesService.crear(req.user.id_cliente, v.datos);
    return res.status(201).json({ direccion });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /api/v1/clientes/yo/direcciones/:id */
async function actualizarDireccion(req, res, next) {
  const id = idPositivo(req.params.id);
  // Un id que no es un entero positivo no puede ser una dirección de nadie:
  // 404, igual que una que no existe.
  if (!id) return next(noEncontrada());
  const v = validarCambioDireccion(req.body);
  if (v.motivo) return responder400(res, v);
  try {
    const direccion = await direccionesService.actualizar(req.user.id_cliente, id, v.datos);
    return res.json({ direccion });
  } catch (err) {
    return next(err);
  }
}

/** DELETE /api/v1/clientes/yo/direcciones/:id */
async function eliminarDireccion(req, res, next) {
  const id = idPositivo(req.params.id);
  if (!id) return next(noEncontrada());
  try {
    await direccionesService.eliminar(req.user.id_cliente, id);
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  obtenerPerfil,
  actualizarPerfil,
  listarDirecciones,
  crearDireccion,
  actualizarDireccion,
  eliminarDireccion,
  // reexportado para las pruebas
  MOTIVO,
  MENSAJE_CUERPO,
};
