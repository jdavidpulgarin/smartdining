/**
 * D-19 parte B: zonas de entrega. Solo en /api/v1.
 *   GET /zonas          pública: solo las activas.
 *   GET /zonas/cotizar  cliente: la zona de UNA de sus direcciones.
 */

const zonasService = require('../services/zonas.service');
const { errorConMotivo } = require('../utils/error-con-motivo');
const { MOTIVO, idPositivo } = require('../utils/cliente-campos');

const MOTIVO_FUERA_DE_COBERTURA = 'fuera_de_cobertura';

/** GET /api/v1/zonas */
async function listar(req, res, next) {
  try {
    const zonas = await zonasService.listarActivas();
    return res.json({ zonas });
  } catch (err) {
    return next(err);
  }
}

/** GET /api/v1/zonas/cotizar?id_direccion=N */
async function cotizar(req, res, next) {
  // Solo `id_direccion`, y un entero positivo: lo demás es una query inválida.
  const claves = Object.keys(req.query);
  const id = idPositivo(req.query.id_direccion);
  if (!id || claves.length !== 1) {
    return res.status(400).json({ error: 'id_direccion debe ser un entero positivo', motivo: MOTIVO.CUERPO });
  }

  try {
    const cotizacion = await zonasService.cotizar(req.user.id_cliente, id);
    if (!cotizacion) return next(errorConMotivo(404, 'no_encontrado', 'Dirección no encontrada'));
    if (!cotizacion.zona) {
      return next(errorConMotivo(422, MOTIVO_FUERA_DE_COBERTURA, 'Esa dirección está fuera de las zonas de entrega'));
    }
    return res.json(cotizacion);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listar, cotizar, MOTIVO_FUERA_DE_COBERTURA };
