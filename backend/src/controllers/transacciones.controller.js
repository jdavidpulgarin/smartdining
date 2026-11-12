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

// ---------------------------------------------------------------------------
// POST /transacciones/mesa — cobro de MESA en caja (pedido de Jarrison tras la
// prueba de punta a punta: la Caja cobraba siempre al primer pedido).
// ---------------------------------------------------------------------------

/** Métodos de la caja: los de la tabla menos 'online', que es solo de Wompi. */
const METODOS_CAJA = METODOS_PAGO.filter((m) => m !== 'online');

/** Tope de DECIMAL(10,2) en centavos: 99.999.999,99 pesos. */
const MAX_CENTAVOS = 9999999999;

const MOTIVO_CUERPO_INVALIDO = 'cuerpo_invalido';
const MOTIVO_MESA_INEXISTENTE = 'mesa_inexistente';
const MOTIVO_SIN_CUENTA = 'sin_cuenta';
const MOTIVO_EXCEDE = 'excede';
const MOTIVO_ID_COBRO_EN_USO = 'id_cobro_en_uso';

/**
 * Pesos con como mucho 2 decimales -> centavos ENTEROS, sin coma flotante.
 *
 * `Math.round(monto * 100)` falla en casos reales: 1.15 * 100 es
 * 114.99999999999999 en coma flotante. Aquí se trabaja sobre el TEXTO del
 * número: la parte entera por 100 más los decimales rellenados a dos cifras.
 * Devuelve null si tiene más de 2 decimales, exponente, o no cabe en
 * DECIMAL(10,2).
 */
function montoACentavos(monto) {
  if (typeof monto !== 'number' || !Number.isFinite(monto) || monto <= 0) return null;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(monto));
  if (!m) return null; // más de 2 decimales, o notación con exponente
  const centavos = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(centavos) || centavos < 1 || centavos > MAX_CENTAVOS) return null;
  return centavos;
}

/** Centavos enteros -> pesos como número (12500050 -> 125000.5). */
const aPesos = (centavos) => Number(centavos) / 100;

const cobroMesaSchema = z
  .object({
    id_mesa: z.number().int().positive(),
    monto: z
      .number()
      .positive()
      .refine((v) => montoACentavos(v) !== null, {
        message: 'monto debe tener como mucho 2 decimales y caber en 99.999.999,99',
      }),
    metodo_pago: z.enum(METODOS_CAJA, {
      errorMap: () => ({ message: `metodo_pago debe ser uno de: ${METODOS_CAJA.join(', ')}` }),
    }),
    // Las mismas reglas que el comensal de POST /transacciones.
    comensal: z.string().min(1).max(40).nullish(),
    id_cobro: z.string().uuid({ message: 'id_cobro debe ser un UUID' }),
  })
  .strict();

/**
 * POST /transacciones/mesa — la caja cobra un monto A LA MESA y la base lo
 * reparte entre sus pedidos con saldo, del más viejo al más nuevo (el mismo
 * núcleo que el pago en línea). `id_cobro` hace el reintento seguro: con el
 * mismo id_cobro no se cobra dos veces.
 */
async function cobrarMesa(req, res, next) {
  const parsed = cobroMesaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0].message, motivo: MOTIVO_CUERPO_INVALIDO });
  }
  const { id_mesa, monto, metodo_pago, id_cobro } = parsed.data;
  const monto_centavos = montoACentavos(monto);
  const comensal = aliasDelComensal(req, parsed.data);

  try {
    const r = await transaccionesService.cobrarMesaEnCaja({
      id_mesa,
      monto_centavos,
      metodo_pago,
      comensal,
      id_cobro,
      id_usuario: req.user.id_usuario,
    });

    if (r.noExiste) {
      return res.status(404).json({ error: 'Mesa no encontrada', motivo: MOTIVO_MESA_INEXISTENTE });
    }
    if (r.sinCuenta) {
      return res.status(409).json({
        error: 'La mesa no tiene una cuenta abierta por pagar',
        motivo: MOTIVO_SIN_CUENTA,
      });
    }
    if (r.excede) {
      return res.status(409).json({
        error: 'El pago excede el saldo de la mesa',
        motivo: MOTIVO_EXCEDE,
        saldo: aPesos(r.saldo_centavos),
      });
    }
    // Un id_cobro que ya se usó en OTRA mesa: no es un reintento de este cobro,
    // y contestar "duplicado" haría creer a la caja que cobró. No se escribe nada.
    if (r.idCobroEnUso) {
      return res.status(409).json({
        error: 'Ese id_cobro ya se usó en otra mesa; genera uno nuevo',
        motivo: MOTIVO_ID_COBRO_EN_USO,
      });
    }
    // El reintento con el mismo id_cobro no cobra ni avisa otra vez: los avisos
    // ya salieron con el primero.
    if (r.duplicado) {
      return res.status(200).json({ duplicado: true, saldo_restante: aPesos(r.saldo_restante_centavos) });
    }

    // Los mismos avisos que el cobro en caja de POST /transacciones, en orden y
    // después del COMMIT (el notifier nunca lanza): primero el pago, luego cada
    // pedido que quedó pagado y al final la mesa liberada.
    const avisos = [
      () => socketNotifier.notificarPagoConfirmado({
        id_mesa,
        monto_centavos,
        saldo_restante_centavos: r.saldo_restante_centavos,
        comensal,
        referencia_externa: transaccionesService.PREFIJO_REFERENCIA_CAJA + id_cobro,
        // La primera fila del reparto: es la guardia de idempotencia del
        // socket-server para este cobro.
        id_transaccion: r.transacciones[0] ? r.transacciones[0].id_transaccion : null,
      }),
      ...r.pagados.map((p) => () => socketNotifier.notificarCambioEstado({
        id_pedido: p.id_pedido,
        id_mesa,
        estado_anterior: p.estado_anterior,
        estado: 'pagado',
      })),
    ];
    if (r.mesa_liberada) avisos.push(() => socketNotifier.notificarMesaLiberada(id_mesa, MOTIVO_PAGADA));
    socketNotifier.encadenarAvisos(avisos);

    if (r.mesa_liberada) aliasComensal.olvidarMesa(id_mesa);

    return res.status(201).json({
      duplicado: false,
      saldo_restante: aPesos(r.saldo_restante_centavos),
      mesa_liberada: r.mesa_liberada,
      pagados: r.pagados.map((p) => p.id_pedido),
      transacciones: r.transacciones.map((t) => ({
        id_transaccion: t.id_transaccion,
        id_pedido: t.id_pedido,
        monto: aPesos(t.monto_centavos),
        comensal: t.comensal,
      })),
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

/** Motivo del 400 cuando la query de GET /transacciones no es la esperada. */
const MOTIVO_CONSULTA_INVALIDA = 'consulta_invalida';

/** Forma de una fecha de calendario en la query: AAAA-MM-DD, nada más. */
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ¿Existe esa fecha en el calendario? (2026-02-30 y 2026-13-01 no.)
 *
 * Se construye con `Date.UTC` y se comprueba que año, mes y día no se
 * "desbordaron" (JavaScript convierte el 30 de febrero en el 2 de marzo sin
 * avisar). Todo en UTC, así que el resultado no depende de la zona del
 * servidor: aquí no se pregunta qué día es hoy, solo si la fecha existe.
 */
function fechaExiste(texto) {
  const [anio, mes, dia] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

/**
 * Query de GET /transacciones (cierre de caja, propuesta de Roberto).
 *
 * `desde` es `hoy` o una fecha `AAAA-MM-DD` que exista; `.strict()` rechaza
 * cualquier otro parámetro. Si la fecha es futura o demasiado antigua NO se
 * decide aquí sino en la base, con el mismo "hoy de Bogotá" que usa la
 * consulta (ver transaccionesService.listarDelDia).
 */
const transaccionesDelDiaSchema = z
  .object({
    desde: z
      .string({ required_error: 'desde es obligatorio: "hoy" o una fecha AAAA-MM-DD' })
      .superRefine((valor, ctx) => {
        if (valor === transaccionesService.DESDE_HOY) return;
        if (!FORMATO_FECHA.test(valor)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'desde debe ser "hoy" o una fecha AAAA-MM-DD',
          });
        } else if (!fechaExiste(valor)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `La fecha ${valor} no existe` });
        }
      }),
  })
  .strict();

/** Mensajes de los límites que decide la base. */
const MENSAJES_RANGO = {
  futura: (r) => `desde no puede ser posterior a hoy (${r.hoy}, hora de Bogotá)`,
  antigua: (r) =>
    `desde admite como mucho ${transaccionesService.DIAS_ATRAS_MAXIMOS} días atrás: `
    + `la fecha más antigua permitida hoy es ${r.minimo}`,
};

/**
 * GET /transacciones?desde=hoy|AAAA-MM-DD — las transacciones completadas
 * desde ese día hasta el final de hoy, para el cierre de caja. Los días son de
 * Bogotá; los calcula la base, ver transaccionesService.listarDelDia.
 */
async function listarDelDia(req, res, next) {
  const parsed = transaccionesDelDiaSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.errors[0].message,
      motivo: MOTIVO_CONSULTA_INVALIDA,
    });
  }

  try {
    const resumen = await transaccionesService.listarDelDia({ desde: parsed.data.desde });
    if (resumen.invalido) {
      return res.status(400).json({
        error: MENSAJES_RANGO[resumen.invalido](resumen),
        motivo: MOTIVO_CONSULTA_INVALIDA,
      });
    }
    return res.json(resumen);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  crear,
  crearInterno,
  aliasDelComensal,
  obtenerPorPedido,
  listarDelDia,
  cobrarMesa,
  montoACentavos,
  METODOS_CAJA,
  MOTIVO_CUERPO_INVALIDO,
  MOTIVO_SIN_CUENTA,
  MOTIVO_EXCEDE,
  MOTIVO_ID_COBRO_EN_USO,
  METODOS_PAGO,
  ESTADOS_TRANSACCION,
  MONEDA,
  MOTIVO_CONSULTA_INVALIDA,
  fechaExiste,
};
