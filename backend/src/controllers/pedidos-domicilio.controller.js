const { z } = require('zod');
const servicio = require('../services/pedidos-domicilio.service');
const socketNotifier = require('../services/socket.notifier');
const {
  itemSchema, sinOverride, MENSAJE_OVERRIDE, MAX_ITEMS_POR_PEDIDO,
  MOTIVO_REINTENTAR, MENSAJE_REINTENTAR,
} = require('./pedidos.controller');
const { esErrorDeConcurrencia } = require('../middleware/errores.middleware');
const { PATRON_TELEFONO } = require('../utils/cliente-campos');

/**
 * D-20b: pedidos para llevar y a domicilio desde la app (docs/api-spec.md).
 *
 *   Cliente (/api/v1, JWT de cliente; todo error { error, motivo }):
 *     POST /pedidos-domicilio, GET /pedidos-domicilio/mios,
 *     POST /pedidos-domicilio/:id/cancelar
 *   Interno (x-internal-key, fuera de v1), para el socket-server:
 *     GET  /pedidos-domicilio/:id/cobro/interno?id_cliente=N
 *     POST /pedidos-domicilio/:id/pago/interno
 *
 * El cliente sale SIEMPRE del JWT (req.user.id_cliente): nunca de la URL ni
 * del cuerpo. Al log no va nada del cliente ni de su dirección.
 */

const MOTIVO = Object.freeze({
  cuerpo: 'cuerpo_invalido',
  parametro: 'parametro_invalido',
  noEncontrado: 'no_encontrado',
  fueraDeCobertura: 'fuera_de_cobertura',
  pagado: 'pedido_pagado',
  yaCancelado: 'pedido_ya_cancelado',
  noPorPagar: 'pedido_no_por_pagar',
  vencido: 'pedido_vencido',
  referencia: 'referencia_invalida',
  // Ajustes de Juan.
  pendiente: 'pedido_pendiente',
  telefonoInvalido: 'telefono_invalido',
  telefonoRequerido: 'telefono_requerido',
});

const err = (res, status, motivo, error, extra = {}) => res.status(status).json({ error, motivo, ...extra });

/** Un id de la URL: entero > 0 que cabe en un INTEGER. */
const idDeTexto = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'debe ser un entero mayor que 0')
  .transform(Number)
  .refine((n) => n <= 2147483647, 'fuera de rango');

const paramsSchema = z.object({ id: idDeTexto }).strict();

/** Los ítems de la app: las reglas de POST /pedidos, sin `comensal` ni `apodo`. */
const itemAppSchema = itemSchema.superRefine((item, ctx) => {
  for (const campo of ['comensal', 'apodo']) {
    if (item[campo] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${campo} no va en un pedido de la app`, path: [campo] });
    }
  }
});

const crearSchema = z
  .object({
    canal: z.enum(servicio.CANALES, { errorMap: () => ({ message: 'canal debe ser para_llevar o domicilio' }) }),
    id_direccion: z.number().int().positive().max(2147483647).optional(),
    // Las mismas reglas que el teléfono del cliente (cliente-campos.js).
    telefono_contacto: z.string().regex(PATRON_TELEFONO, 'El teléfono debe tener entre 7 y 15 dígitos, con + opcional').optional(),
    notas_generales: z.string().max(500).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
    items: z.array(itemAppSchema).min(1).max(MAX_ITEMS_POR_PEDIDO),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.canal === 'domicilio' && c.id_direccion === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'id_direccion es obligatorio a domicilio', path: ['id_direccion'] });
    }
    if (c.canal === 'para_llevar' && c.id_direccion !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'id_direccion no va en un pedido para llevar', path: ['id_direccion'] });
    }
  });

const cuerpoVacioSchema = z.object({}).strict();

const primerError = (r) => r.error.errors[0].message;

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

async function crear(req, res, next) {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) {
    const enTelefono = parsed.error.errors.some((i) => i.path[0] === 'telefono_contacto');
    return err(res, 400, enTelefono ? MOTIVO.telefonoInvalido : MOTIVO.cuerpo, primerError(parsed));
  }
  const { canal, id_direccion, telefono_contacto, notas_generales, items } = parsed.data;

  try {
    const r = await servicio.crear({
      idCliente: req.user.id_cliente,
      canal,
      idDireccion: id_direccion ?? null,
      // Para llevar: se valida si llega, pero no se guarda (no hay ficha de entrega).
      telefonoContacto: canal === 'domicilio' ? telefono_contacto ?? null : null,
      notasGenerales: notas_generales ?? null,
      items: items.map((item) => ({
        id_plato: item.id_plato,
        cantidad: item.cantidad,
        comensal: null,
        notas: item.notas ?? null,
        ingredientes: (item.ingredientes ?? []).map((i) => ({ id_ingrediente: i.id_ingrediente, porcion: i.porcion })),
      })),
    });
    if (r.noEncontrada) return err(res, 404, MOTIVO.noEncontrado, 'Dirección no encontrada');
    if (r.fueraDeCobertura) {
      return err(res, 422, MOTIVO.fueraDeCobertura, 'Esa dirección está fuera de la zona de entrega');
    }
    if (r.telefonoRequerido) {
      return err(res, 422, MOTIVO.telefonoRequerido, 'Falta un teléfono de contacto para la entrega');
    }
    if (r.pendiente) {
      return err(res, 409, MOTIVO.pendiente, 'Ya tienes un pedido por pagar: págalo o cancélalo antes de hacer otro', {
        pedido: r.pendiente,
      });
    }
    return res.status(201).json({ pedido: r.pedido });
  } catch (e) {
    // Un deadlock no se reintenta aquí (como POST /pedidos): no hay clave de
    // idempotencia y el reintento podría duplicar el pedido.
    if (esErrorDeConcurrencia(e && e.code)) return err(res, 503, MOTIVO_REINTENTAR, MENSAJE_REINTENTAR);
    // sin_stock (SD001) y las reglas del constructor las traduce el manejador
    // central, como en POST /pedidos.
    return next(e);
  }
}

async function listarMios(req, res, next) {
  if (Object.keys(req.query || {}).length > 0) return err(res, 400, MOTIVO.cuerpo, 'Esta ruta no lleva parámetros');
  try {
    return res.json({ pedidos: await servicio.listarMios(req.user.id_cliente) });
  } catch (e) {
    return next(e);
  }
}

async function obtener(req, res, next) {
  const params = paramsSchema.safeParse(req.params);
  // Un :id que no es entero positivo no puede ser un pedido de nadie: 404.
  if (!params.success) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');
  try {
    const pedido = await servicio.obtener(params.data.id, req.user.id_cliente);
    if (!pedido) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');
    return res.json({ pedido });
  } catch (e) {
    return next(e);
  }
}

async function cancelar(req, res, next) {
  const params = paramsSchema.safeParse(req.params);
  // Un :id que no es entero positivo no puede ser un pedido de nadie: 404.
  if (!params.success) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');
  if (!cuerpoVacioSchema.safeParse(req.body ?? {}).success) {
    return err(res, 400, MOTIVO.cuerpo, 'Esta ruta no lleva cuerpo');
  }
  try {
    const r = await servicio.cancelar(params.data.id, req.user.id_cliente);
    if (r.noExiste) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');
    if (r.yaCancelado) return err(res, 409, MOTIVO.yaCancelado, 'Ese pedido ya estaba cancelado');
    if (r.pagado) return err(res, 409, MOTIVO.pagado, 'Ese pedido ya se pagó: no se puede cancelar desde la app');
    return res.json({ pedido: r.pedido });
  } catch (e) {
    return next(e);
  }
}

// ---------------------------------------------------------------------------
// Interno (socket-server)
// ---------------------------------------------------------------------------

const cobroQuerySchema = z.object({ id_cliente: idDeTexto }).strict();

async function cobroInterno(req, res, next) {
  const params = paramsSchema.safeParse(req.params);
  const query = cobroQuerySchema.safeParse(req.query);
  if (!params.success || !query.success) {
    return err(res, 400, MOTIVO.parametro, 'id e id_cliente deben ser enteros positivos (y nada más)');
  }
  try {
    const r = await servicio.cobroInterno(params.data.id, query.data.id_cliente);
    if (r.noExiste) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');
    if (r.noPorPagar) return err(res, 409, MOTIVO.noPorPagar, 'El pedido ya no está por pagar', { estado: r.estado });
    if (r.vencido) return err(res, 409, MOTIVO.vencido, 'Se venció el plazo para pagar ese pedido');
    return res.json(r.cobro);
  } catch (e) {
    return next(e);
  }
}

const pagoSchema = z
  .object({
    referencia_externa: z.string().min(1).max(100),
    id_transaccion_pasarela: z.string().min(1).max(100),
    pasarela: z.string().min(1).max(20),
    monto_centavos: z.number().int().positive().max(9999999999),
    moneda: z.literal(servicio.MONEDA),
    metodo_pago: z.enum(['online']).default('online'),
  })
  .strict();

async function pagoInterno(req, res, next) {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) return err(res, 400, MOTIVO.parametro, 'id debe ser un entero positivo');
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return err(res, 400, MOTIVO.cuerpo, primerError(parsed));
  const idPedido = params.data.id;
  if (!servicio.esReferenciaDelPedido(parsed.data.referencia_externa, idPedido)) {
    return err(res, 400, MOTIVO.referencia, `La referencia no es de ese pedido (SD-P-${idPedido}-…)`);
  }

  try {
    const r = await servicio.confirmarPagoInterno(idPedido, parsed.data);
    if (r.noExiste) return err(res, 404, MOTIVO.noEncontrado, 'Pedido no encontrado');

    // Pedido pagado (y solo la primera vez): después del COMMIT, por la cadena
    // de avisos; no espera ni cambia la respuesta.
    if (!r.duplicado && r.resultado === 'confirmado') {
      socketNotifier.encadenarAvisos([
        async () => {
          const datos = await servicio.pedidoParaAviso(idPedido);
          if (datos) await socketNotifier.notificarPedidoAnticipadoPagado(datos.pedido, datos.detalles);
        },
      ]);
    }

    return res.status(r.duplicado ? 200 : 201).json({
      ok: true,
      duplicado: r.duplicado,
      resultado: r.resultado,
      id_transaccion: r.id_transaccion,
      id_por_devolver: r.id_por_devolver,
      motivo_devolucion: r.motivo_devolucion,
    });
  } catch (e) {
    return next(e);
  }
}

module.exports = { crear, obtener, listarMios, cancelar, cobroInterno, pagoInterno, MOTIVO };
