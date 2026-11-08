const { z } = require('zod');
const transaccionesService = require('../services/transacciones.service');
const { ESTADO_COBRADO } = transaccionesService;
const socketNotifier = require('../services/socket.notifier');
const { MOTIVO_PAGADA } = socketNotifier;
const { esComensal } = require('../middleware/auth.middleware');
const aliasComensal = require('../services/alias-comensal');

// Valores exactos de los CHECK de la tabla transacciones en el schema.sql de
// Jarrison. referencia_externa es la referencia de la pasarela de Roberto.
const METODOS_PAGO = ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'online'];
const ESTADOS_TRANSACCION = ['pendiente', 'completada', 'fallida', 'reembolsada'];

/**
 * H-07: el estado de la transacción lo fija el SERVIDOR, no la caja.
 *
 * Antes el body podía mandar `estado_transaccion`, así que un cajero (o
 * cualquiera con su token) podía registrar un pago como `reembolsada` o
 * `fallida` y dejar la cuenta sin cobrar pero con una transacción encima, sin
 * ningún rastro de quién decidió eso. Un reembolso es una operación distinta,
 * con su propia autorización, y no se hace por esta ruta.
 *
 * Se sigue aceptando `"completada"` por compatibilidad con lo que ya manda el
 * panel; cualquier otro valor responde 400. Si no viene el campo, el service
 * usa 'completada' como siempre.
 */
const ESTADO_UNICO_EN_CAJA = ESTADO_COBRADO;
const MENSAJE_ESTADO_FIJO =
  'El estado del pago lo fija el servidor: no envíes estado_transaccion '
  + '(un reembolso no se registra por esta ruta)';

const pagoSchema = z.object({
  id_pedido: z.number().int(),
  monto: z.number().positive(),
  metodo_pago: z.enum(METODOS_PAGO),
  referencia_externa: z.string().optional(),
  // refine y no z.literal: así el mensaje que ve la caja explica la regla, en
  // vez del 'Invalid literal value, expected "completada"' de zod.
  estado_transaccion: z
    .string()
    .refine((valor) => valor === ESTADO_UNICO_EN_CAJA, { message: MENSAJE_ESTADO_FIJO })
    .optional(),
  // Quién pagó, cuando la mesa divide la cuenta: va a transacciones.comensal y
  // es lo que permite que obtener_cuenta_mesa descuente el pago del saldo de esa
  // persona y no del montón. Opcional: un cobro de la mesa completa no lleva alias.
  comensal: z.string().min(1).max(40).nullish(),
});

/**
 * Alias que queda en la transacción.
 *
 * Misma regla que al crear un pedido (H-05): si el JWT trae alias firmado, ese
 * manda; y si quien paga es un comensal **sin** alias en el token, queda `null`
 * en vez de creerle al body. Un alias escrito en el cuerpo decidiría de quién
 * se descuenta el pago en obtener_cuenta_mesa.
 *
 * Hoy esta ruta es de admin/cajero —su JWT no lleva alias, así que el alias
 * viene del body, que es lo correcto para un cobro en caja— pero la regla queda
 * puesta para cuando el comensal pague desde su propia sesión.
 */
function aliasDelComensal(req, cuerpo) {
  const firmado = req.user?.comensal;
  if (typeof firmado === 'string' && firmado.trim()) return firmado.trim();
  if (esComensal(req)) return null;
  return cuerpo.comensal ?? null;
}

async function crear(req, res, next) {
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  try {
    const {
      transaccion, pedidoCerrado, mesaLiberada, id_mesa, saldoMesaCentavos, estadoTransaccion,
    } = await transaccionesService.registrarPago({
      ...parsed.data,
      comensal: aliasDelComensal(req, parsed.data),
      id_usuario: req.user.id_usuario,
    });

    // AVISOS AL TIEMPO REAL. Todos van DESPUÉS del COMMIT y en una cadena
    // secuencial que esta respuesta NO espera: el 201 sale de inmediato porque
    // el cobro ya está guardado y el tiempo real es un extra. Se encadenan en
    // vez de lanzarse sueltos porque su ORDEN importa (ver el aviso 1).
    const avisos = [];

    // (1) El cobro en sí. Va PRIMERO, antes de mesa-liberada: mesa-liberada
    // desconecta a los comensales de la mesa y, si saliera antes, la mesa
    // nunca llegaría a ver el pago que acaba de hacer (EVENTS.md §8.6).
    //
    // Solo si el dinero entró de verdad: un pago 'pendiente', 'fallido' o
    // 'reembolsado' no es un cobro y no se anuncia como tal. El pago EN LÍNEA
    // tampoco pasa por aquí —va por crearInterno— y allí el aviso lo emite el
    // propio socket-server desde su webhook: avisar también desde el backend
    // anunciaría el mismo pago dos veces.
    if (estadoTransaccion === ESTADO_COBRADO) {
      avisos.push(() =>
        socketNotifier.notificarPagoConfirmado({
          id_mesa,
          // Centavos enteros: el contrato no acepta decimales y sumar abonos
          // en coma flotante desajustaría el saldo.
          monto_centavos: Math.round(Number(transaccion.monto) * 100),
          // Saldo de la MESA (no el del pedido), calculado dentro de la
          // transacción con la fila de la mesa todavía bloqueada.
          saldo_restante_centavos: saldoMesaCentavos,
          comensal: transaccion.comensal ?? null,
          referencia_externa: transaccion.referencia_externa ?? null,
          id_transaccion: transaccion.id_transaccion ?? null,
        })
      );
    }

    // (2) Solo si el pedido pasó a 'pagado'. Con la cuenta cubierta pero la
    // comida sin entregar el pedido sigue en cocina: el cambio se anunciará
    // cuando el mesero lo marque entregado.
    if (pedidoCerrado) {
      avisos.push(() =>
        socketNotifier.notificarCambioEstado({
          id_pedido: transaccion.id_pedido,
          id_mesa,
          estado_anterior: 'entregado',
          estado: 'pagado',
        })
      );
    }

    // (3) La mesa se liberó en la transacción del cobro solo si no le quedaban
    // pedidos abiertos. Se avisa para que el socket-server cierre esa sesión:
    // aislado, porque la liberación ya está hecha y no se revierte.
    // H-22: el motivo es 'pagada', no el 'liberada' por omisión. La mesa se
    // liberó porque el grupo pagó en caja, igual que si hubiera pagado en
    // línea; las pantallas distinguen las dos cosas.
    if (mesaLiberada) {
      avisos.push(() => socketNotifier.notificarMesaLiberada(id_mesa, MOTIVO_PAGADA));
    }

    socketNotifier.encadenarAvisos(avisos);

    // Esto no es un aviso al socket-server sino estado en memoria de este
    // proceso, así que no entra en la cadena: se olvida ya mismo.
    if (mesaLiberada) aliasComensal.olvidarMesa(id_mesa);

    return res.status(201).json(transaccion);
  } catch (err) {
    return next(err);
  }
}

// Moneda del contrato con Wompi: cualquier otra se rechaza antes de tocar la
// base, porque mezclarlas haria que los centavos no signifiquen lo mismo.
const MONEDA = 'COP';

/**
 * Cuerpo que manda el socket-server tras verificar el pago con Wompi
 * (EVENTS.md §8.4). Los montos llegan en centavos enteros: es lo que da la
 * pasarela y evita decimales en el camino.
 *
 * `modo` e `id_transaccion_pasarela` se validan porque son parte del contrato
 * y sirven para rastrear el pago, aunque hoy no haya columna donde guardarlos.
 */
const pagoInternoSchema = z.object({
  referencia_externa: z.string().min(1).max(100),
  id_transaccion_pasarela: z.string().min(1),
  pasarela: z.string().max(20),
  id_mesa: z.number().int().positive(),
  comensal: z.string().min(1).max(40).nullish(),
  modo: z.string().max(20),
  monto_centavos: z.number().int().positive(),
  moneda: z.literal(MONEDA),
  metodo_pago: z.enum(METODOS_PAGO).default('online'),
});

/**
 * POST /api/transacciones/internal — registro del pago que ya cobro la pasarela.
 *
 * No lleva JWT: la llama el socket-server con x-internal-key. El pago es de la
 * mesa, asi que el reparto entre pedidos y la liberacion de la mesa ocurren en
 * una sola transaccion en el service; aqui solo se traduce el resultado a HTTP
 * y se avisa al tiempo real DESPUES del commit.
 */
async function crearInterno(req, res, next) {
  const parsed = pagoInternoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const { referencia_externa, id_mesa, comensal, monto_centavos, metodo_pago } = parsed.data;

  try {
    const r = await transaccionesService.registrarPagoInterno({
      referencia_externa,
      id_mesa,
      comensal: comensal ?? null,
      monto_centavos,
      metodo_pago,
    });

    if (r.noExiste) return res.status(404).json({ error: 'Mesa no encontrada' });
    if (r.sinCuenta) {
      return res.status(409).json({ error: 'La mesa no tiene una cuenta abierta por pagar' });
    }
    if (r.excede) {
      return res.status(409).json({
        error: 'El pago excede el saldo de la mesa',
        saldo_centavos: r.saldo_centavos,
      });
    }

    // Un reintento de Wompi no vuelve a cobrar ni a avisar: el aviso de
    // payment:confirmed ya salio con el primer registro.
    if (r.duplicado) {
      return res.status(200).json({
        ok: true,
        duplicado: true,
        saldo_restante_centavos: r.saldo_restante_centavos,
        mesa_liberada: false,
      });
    }

    // Despues del commit y aislado: el pago ya esta guardado y no se revierte
    // porque el tiempo real falle (el notifier nunca lanza).
    for (const pedido of r.pagados) {
      socketNotifier.notificarCambioEstado({
        id_pedido: pedido.id_pedido,
        id_mesa,
        estado_anterior: pedido.estado_anterior,
        estado: 'pagado',
      });
    }
    if (r.mesa_liberada) socketNotifier.notificarMesaLiberada(id_mesa, MOTIVO_PAGADA);

    return res.status(201).json({
      ok: true,
      duplicado: false,
      saldo_restante_centavos: r.saldo_restante_centavos,
      mesa_liberada: r.mesa_liberada,
    });
  } catch (err) {
    return next(err);
  }
}

async function obtenerPorPedido(req, res, next) {
  try {
    const transacciones = await transaccionesService.obtenerPorPedido(req.params.id_pedido);
    return res.json({ transacciones });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  crear,
  crearInterno,
  aliasDelComensal,
  obtenerPorPedido,
  METODOS_PAGO,
  ESTADOS_TRANSACCION,
  MONEDA,
};
