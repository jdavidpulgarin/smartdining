/**
 * D-20a: despacho de domicilios (admin y cajero) y repartidor.
 * Reglas y orden de bloqueos: src/services/domicilios.service.js.
 *
 * Todas las respuestas de error son `{ error, motivo }`:
 *   400 cuerpo_invalido | parametro_invalido
 *   403 no_es_tu_entrega (y prohibido/no_autenticado de requireAuth/requireRole)
 *   404 no_encontrado
 *   409 pedido_cancelado | entrega_ya_salio | repartidor_no_valido
 *       | transicion_invalida | pedido_no_listo
 *
 * Por socket NO se avisa nada en la D-20a: los avisos de domicilio llegan con
 * la R-23 de Roberto (el socket-server de hoy exige id_mesa).
 */

const { z } = require('zod');
const domicilios = require('../services/domicilios.service');

const MAX_MOTIVO = 200;

/** Entero positivo (un id), o null. */
function idPositivo(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) return null;
  const n = Number(valor);
  return n <= 2147483647 ? n : null;
}

const esquemaAsignar = z.object({ id_repartidor: z.number().int().positive().max(2147483647) }).strict();

const esquemaFallar = z
  .object({
    motivo: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => [...s].length >= 1 && [...s].length <= MAX_MOTIVO, `El motivo debe tener entre 1 y ${MAX_MOTIVO} caracteres`),
  })
  .strict();

/** Sin cuerpo (o `{}`): salir y entregar no reciben nada. */
const esquemaVacio = z.object({}).strict();

const parametroInvalido = (res) =>
  res.status(400).json({ error: 'id_pedido debe ser un entero positivo', motivo: 'parametro_invalido' });

const cuerpoInvalido = (res, mensaje = 'El cuerpo de la petición no es válido') =>
  res.status(400).json({ error: mensaje, motivo: 'cuerpo_invalido' });

/**
 * GET /domicilios?estado_entrega=a,b: uno o varios estados separados por coma.
 * Sin el parámetro, los no terminados. Un estado que no existe es 400.
 */
async function listarDespacho(req, res, next) {
  const claves = Object.keys(req.query);
  if (claves.some((k) => k !== 'estado_entrega')) return cuerpoInvalido(res, 'Solo se admite estado_entrega');
  let estados = domicilios.ESTADOS_NO_TERMINADOS;
  if (req.query.estado_entrega !== undefined) {
    if (typeof req.query.estado_entrega !== 'string') return cuerpoInvalido(res, 'estado_entrega va una sola vez, separado por comas');
    const pedidos = req.query.estado_entrega.split(',').map((s) => s.trim());
    if (pedidos.length === 0 || pedidos.some((e) => !domicilios.ESTADOS_ENTREGA.includes(e))) {
      return cuerpoInvalido(res, `estado_entrega admite: ${domicilios.ESTADOS_ENTREGA.join(', ')}`);
    }
    estados = [...new Set(pedidos)];
  }
  try {
    return res.json({ domicilios: await domicilios.listarDespacho(estados) });
  } catch (err) {
    return next(err);
  }
}

/** PATCH /domicilios/:id_pedido/repartidor { id_repartidor } */
async function asignarRepartidor(req, res, next) {
  const id = idPositivo(req.params.id_pedido);
  if (!id) return parametroInvalido(res);
  const r = esquemaAsignar.safeParse(req.body);
  if (!r.success) return cuerpoInvalido(res, 'id_repartidor debe ser un entero positivo, y nada más');
  try {
    return res.json({ domicilio: await domicilios.asignar(id, r.data.id_repartidor) });
  } catch (err) {
    return next(err);
  }
}

/** GET /domicilios/mios (repartidor) */
async function listarMias(req, res, next) {
  try {
    return res.json({ domicilios: await domicilios.listarMias(req.user.id_usuario) });
  } catch (err) {
    return next(err);
  }
}

/** POST /domicilios/:id_pedido/salir y /entregar: sin cuerpo. */
function sinCuerpo(accion) {
  return async (req, res, next) => {
    const id = idPositivo(req.params.id_pedido);
    if (!id) return parametroInvalido(res);
    if (!esquemaVacio.safeParse(req.body ?? {}).success) return cuerpoInvalido(res, 'Esta ruta no lleva cuerpo');
    try {
      return res.json({ domicilio: await accion(id, req.user.id_usuario) });
    } catch (err) {
      return next(err);
    }
  };
}

/** POST /domicilios/:id_pedido/fallar { motivo } */
async function fallar(req, res, next) {
  const id = idPositivo(req.params.id_pedido);
  if (!id) return parametroInvalido(res);
  const r = esquemaFallar.safeParse(req.body ?? {});
  if (!r.success) return cuerpoInvalido(res, `motivo es obligatorio (1 a ${MAX_MOTIVO} caracteres), y nada más`);
  try {
    return res.json({ domicilio: await domicilios.fallar(id, req.user.id_usuario, r.data.motivo) });
  } catch (err) {
    return next(err);
  }
}

/** GET /usuarios/repartidores (admin y cajero): activos, solo id y nombre. */
async function listarRepartidores(req, res, next) {
  try {
    return res.json({ repartidores: await domicilios.listarRepartidores() });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listarDespacho,
  asignarRepartidor,
  listarMias,
  salir: sinCuerpo(domicilios.salir),
  entregar: sinCuerpo(domicilios.entregar),
  fallar,
  listarRepartidores,
};
