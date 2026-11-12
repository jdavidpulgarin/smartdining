const { z } = require('zod');
const pedidosService = require('../services/pedidos.service');
const mesasService = require('../services/mesas.service');
const { esComensal } = require('../middleware/auth.middleware');
const socketNotifier = require('../services/socket.notifier');
const aliasComensal = require('../services/alias-comensal');
const aliasEnCuenta = require('../services/alias-en-cuenta');
const { esErrorDeConcurrencia } = require('../middleware/errores.middleware');

// El trigger tr_validar_disponibilidad_plato de Jarrison deja comandar un plato
// agotado si notas_especiales contiene 'OVERRIDE_ADMIN' (bypass administrativo).
// Ese campo se arma con texto que escribe el comensal, así que el marcador se
// rechaza en el body. El alias (comensal/apodo) ya no se guarda ahí, pero se
// sigue revisando igual: es texto del cliente y mañana puede volver a mezclarse
// con notas en algún listado o reporte.
const MARCADOR_OVERRIDE = /override_admin/i;
const MENSAJE_OVERRIDE = 'El texto no puede contener OVERRIDE_ADMIN';
const sinOverride = (valor) => !MARCADOR_OVERRIDE.test(valor);

// Porciones que acepta detalles_ingredientes.porcion (CHECK del script 13).
const PORCIONES = ['ligera', 'normal', 'extra'];

// Tope defensivo del body, no una regla de negocio: cuántas opciones se pueden
// elegir de verdad lo dicen min_sel/max_sel de cada paso, y eso lo valida
// validar_selecciones_detalle en la base.
const MAX_INGREDIENTES_POR_ITEM = 20;

/**
 * Topes del pedido (H-06).
 *
 * Antes `cantidad` solo pedía ser positiva: un `100000000` llegaba a la base,
 * desbordaba el DECIMAL del subtotal y salía como 500. Y `items` no tenía tope,
 * así que un cuerpo con miles de ítems hacía miles de INSERT dentro de una
 * transacción.
 *
 * Los números son de sala, no técnicos: 20 unidades del mismo plato ya es una
 * mesa grande pidiendo lo mismo, y 50 ítems distintos es más de lo que cabe en
 * una comanda. Lo que pase de ahí es un error de quien llama o un abuso, y en
 * los dos casos un 400 explica mejor que un 500.
 */
const MAX_ITEMS_POR_PEDIDO = 50;
const MAX_CANTIDAD_POR_ITEM = 20;

// Campos de precio que un cliente podría intentar imponer. El precio lo fija
// SIEMPRE la base (platos.precio e ingredientes.precio_extra vía trigger), así
// que se rechazan en voz alta en vez de ignorarlos en silencio: quien los manda
// está dando por hecho que cuentan, y es mejor que se entere con un 400.
const CAMPOS_DE_PRECIO = [
  'precio',
  'precio_unitario',
  'precio_extra',
  'precio_aplicado',
  'precio_extras',
  'subtotal',
  'total',
];
const MENSAJE_PRECIO = 'El precio lo fija la base de datos: no envíes campos de precio';

/** Agrega un issue por cada campo de precio presente en el objeto recibido. */
function rechazarPrecios(valor, ctx) {
  for (const campo of CAMPOS_DE_PRECIO) {
    if (valor[campo] !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAJE_PRECIO, path: [campo] });
    }
  }
}

const ingredienteSchema = z
  .object({
    id_ingrediente: z.number().int().positive(),
    // 'normal' es la porción sin recargo: el valor por defecto más conservador.
    porcion: z.enum(PORCIONES).default('normal'),
  })
  // passthrough porque zod descarta las claves desconocidas ANTES de los
  // refinamientos, y sin ellas no se puede ver que llegó un precio. Lo que pasa
  // al service no son estos objetos sino los que arma `crear` campo por campo,
  // así que nada desconocido sigue viaje.
  .passthrough()
  .superRefine(rechazarPrecios);

/**
 * `comensal` es el alias con el que la persona se identificó en el carrito
 * colaborativo ("Ana", "Pipe"). Desde D-03 va en su propia columna
 * detalles_pedido.comensal y no antepuesto a notas_especiales, para poder
 * dividir la cuenta por persona sin parsear texto libre.
 *
 * `apodo` sigue aceptándose como alias de compatibilidad (así lo llamaba la API
 * anterior); si llegan los dos, manda `comensal`.
 */
const aliasSchema = z.string().trim().min(1).max(40).refine(sinOverride, MENSAJE_OVERRIDE);

const itemSchema = z
  .object({
    id_plato: z.number().int(),
    cantidad: z.number().int().min(1).max(MAX_CANTIDAD_POR_ITEM),
    comensal: aliasSchema.optional(),
    apodo: aliasSchema.optional(),
    notas: z.string().max(200).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
    ingredientes: z.array(ingredienteSchema).max(MAX_INGREDIENTES_POR_ITEM).optional(),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    rechazarPrecios(item, ctx);

    // El mismo ingrediente dos veces en un ítem no tiene significado (la porción
    // sería ambigua) y además chocaría con la PK de detalles_ingredientes, que
    // saldría como 500 en vez de 400. Se corta aquí.
    const ids = (item.ingredientes || []).map((i) => i.id_ingrediente);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'No repitas el mismo ingrediente en un ítem',
        path: ['ingredientes'],
      });
    }
  });

// id_mesa es opcional en el body porque para un comensal se toma del token y se
// ignora lo que venga aquí; para el personal (mesero/admin) es obligatorio.
const crearPedidoSchema = z.object({
  id_mesa: z.number().int().optional(),
  notas_generales: z.string().max(500).refine(sinOverride, MENSAJE_OVERRIDE).optional(),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS_POR_PEDIDO),
});

/**
 * Alias del comensal que queda guardado en el ítem.
 *
 * H-05: para un COMENSAL el alias sale **solo del JWT**. Lo que venga en el
 * body (`comensal` o `apodo`) se ignora por completo, incluso si el token no
 * trae alias: en ese caso queda `null`.
 *
 * El alias no es decoración, es a quién se le cobra: con el body como respaldo,
 * cualquiera en la mesa podía escribir el nombre de otro y cargarle sus platos,
 * y la cuenta por persona dejaba de ser fiable. Un alias firmado por el
 * servidor no se puede suplantar; uno escrito en el cuerpo sí.
 *
 * Para mesero y admin el body sigue valiendo: ellos piden de parte de alguien y
 * su JWT no lleva alias, sino `id_usuario`.
 *
 * D-18b: para el personal ya no se guarda el texto del body tal cual, sino el
 * alias CANÓNICO que resolvió `resolverAliasCanonicos` para esa clave, para que
 * la cuenta no acabe con «Abuela» y «abuela» en dos filas. `porClave` llega
 * vacío cuando el pedido no trae ningún alias.
 */
function aliasDelComensal(req, item, porClave = new Map()) {
  const firmado = req.user?.comensal;
  if (typeof firmado === 'string' && firmado.trim()) return firmado.trim();

  // Un comensal sin alias firmado se queda sin alias: el body no es autoridad.
  if (esComensal(req)) return null;

  const bruto = item.comensal ?? item.apodo;
  if (typeof bruto !== 'string' || !bruto.trim()) return null;

  const normalizado = aliasComensal.normalizarAlias(bruto);
  // El cajón de los platos sin dueño no es dueño de nada: si llegara hasta aquí
  // (no llega: `resolverAliasCanonicos` ya devolvió su 409), el ítem se queda
  // SIN alias, que es justo donde la cuenta lo pondría.
  if (normalizado.reservada) return null;
  // Si no se pudo normalizar, `resolverAliasCanonicos` ya respondió 400; este
  // respaldo solo existe para no devolver undefined si alguien llama suelto.
  if (normalizado.error) return bruto.trim();

  return porClave.get(normalizado.clave) ?? normalizado.alias;
}

/* -------------------------------------------------------------------------- *
 * Alias canónico del comensal cuando pide el PERSONAL (D-18b)
 *
 * El problema: la cuenta por persona agrupa por el TEXTO EXACTO del alias
 * (`btrim(dp.comensal)` en obtener_cuenta_mesa), mientras que la unicidad de los
 * alias se mide por CLAVE (sin tildes, minúsculas, sin separadores). Así que si
 * la abuela se registra como «Abuela» y el mesero escribe «abuela» al tomarle el
 * pedido, la cuenta muestra DOS filas, el desglose no cuadra y el cajero no sabe
 * a quién cobrarle qué.
 *
 * La regla: cuando pide el personal, el alias que se guarda no es el texto que
 * llegó, sino el CANÓNICO de esa persona en la mesa. Se busca en dos sitios, en
 * este orden:
 *   1. las reservas de alias de la mesa (`sd:mesa:{id}:alias`), que es la fuente
 *      de verdad de quién está sentado, venga de un QR o del alta del personal;
 *   2. la cuenta de la mesa, para cubrir a quien ya tiene platos pero cuya
 *      reserva venció (24 h para un sin celular, 3 h para una sesión de QR).
 * Si no está en ninguno, es un nombre que nadie registró: 409.
 *
 * Esto NO toca al comensal: su alias sale firmado del JWT (H-05) y nunca del
 * cuerpo. Y un ítem sin alias sigue cayendo en «General», como siempre.
 * -------------------------------------------------------------------------- */

/** Motivo del 409 cuando el nombre no corresponde a nadie de la mesa. */
const MOTIVO_NO_REGISTRADO = 'comensal_no_registrado';

const MENSAJE_NO_REGISTRADO =
  'Esa persona no está registrada en la mesa: agrégala primero '
  + '(POST /api/mesas/:id/comensales) o usa el nombre con el que ya aparece en la cuenta';

/**
 * El 503 de un deadlock al crear el pedido (D-17).
 *
 * `reintentar` es el motivo estable: el pedido NO se guardó y hay que volver a
 * mandarlo. Lo repite el cliente y no el backend, porque `POST /api/pedidos` no
 * acepta clave de idempotencia y un reintento nuestro podría duplicar la
 * comanda (ver el catch de `crear`).
 */
const MOTIVO_REINTENTAR = 'reintentar';
const MENSAJE_REINTENTAR = 'intenta de nuevo';

/**
 * Los alias en bruto que trae el pedido, sin repetir.
 *
 * `comensal` manda sobre `apodo`, igual que en `aliasDelComensal`. Un ítem sin
 * alias no aporta nada aquí: su `null` se resuelve solo.
 */
function aliasEnBruto(items) {
  const vistos = new Set();
  for (const item of items) {
    const bruto = item.comensal ?? item.apodo;
    if (typeof bruto === 'string' && bruto.trim()) vistos.add(bruto);
  }
  return [...vistos];
}


/**
 * Resuelve el alias canónico de cada clave distinta del pedido.
 *
 * UNA resolución por alias distinto, no una por ítem: un pedido con ocho platos
 * de la abuela hace una sola lectura de la reserva, y la cuenta se consulta como
 * mucho UNA vez para todo el pedido (y solo si alguna reserva no apareció).
 * Todo esto pasa ANTES de abrir la transacción del pedido.
 *
 * DEGRADACIÓN SIN REDIS: si no se puede leer la reserva, el pedido NO se
 * bloquea. Se intenta igual con la cuenta (que vive en PostgreSQL) y, si
 * tampoco, se guarda el texto recortado, que es exactamente lo que hacía el
 * backend antes de D-18b. Un servicio de caché caído no puede impedir que una
 * mesa coma; lo único que se pierde es la canonicalización.
 *
 * @returns {Promise<{porClave: Map<string, string>}|{error: {status: number, body: object}}>}
 */
async function resolverAliasCanonicos(idMesa, items) {
  const brutos = aliasEnBruto(items);
  if (brutos.length === 0) return { porClave: new Map() };

  // D-18c: que la mesa EXISTA se comprueba antes de resolver alias. Si no
  // existe, no hay nadie sentado a quien resolver, y sin esto la respuesta era
  // un 409 comensal_no_registrado —`cuentaPorComensal` devuelve null— que
  // culpaba al nombre del comensal de un id de mesa equivocado.
  //
  // Va aquí y no en `crear` a propósito: solo cuesta una consulta cuando el
  // pedido trae alias. Un pedido SIN alias no toca esta función y sigue
  // fallando como antes (la FK de la mesa), sin una consulta de más.
  //
  // `mesasService.existe` es el mismo `SELECT 1 FROM mesas` que ya hacían las
  // dos cuentas, ahora en un solo sitio: no es una consulta nueva de este
  // controlador.
  if (!(await mesasService.existe(idMesa))) {
    return { error: { status: 404, body: { error: 'Mesa no encontrada' } } };
  }

  // 1. Validación: la MISMA regla que las rutas de alias (R-18). Un nombre que
  //    no pasa aquí no se puede registrar ni comparar, así que es un 400.
  const claves = new Map();
  for (const bruto of brutos) {
    const normalizado = aliasComensal.normalizarAlias(bruto);
    // «General» (D-18c) es la excepción: no es un nombre mal escrito, es el
    // cajón de los platos sin dueño, así que no corresponde a NADIE registrado.
    // Sale el mismo 409 comensal_no_registrado que daba antes de que
    // `normalizarAlias` lo rechazara, y sin mirar Redis: un ítem a nombre del
    // cajón no se guarda ni cuando no se puede verificar quién está sentado.
    if (normalizado.reservada) {
      return {
        error: {
          status: 409,
          body: {
            error: MENSAJE_NO_REGISTRADO,
            motivo: MOTIVO_NO_REGISTRADO,
            alias: normalizado.alias,
          },
        },
      };
    }
    if (normalizado.error) {
      return { error: { status: 400, body: { error: normalizado.error, campo: 'comensal' } } };
    }
    if (!claves.has(normalizado.clave)) claves.set(normalizado.clave, normalizado.alias);
  }

  const porClave = new Map();
  const sinReserva = [];
  let redisCaido = false;

  // 2. Las reservas de la mesa: la fuente de verdad de quién está sentado.
  for (const [clave, normalizado] of claves) {
    const reservado = await aliasComensal.aliasReservado(idMesa, clave);
    if (reservado.alias) {
      porClave.set(clave, reservado.alias);
    } else {
      if (reservado.noDisponible) redisCaido = true;
      sinReserva.push([clave, normalizado]);
    }
  }

  if (sinReserva.length === 0) return { porClave };

  // 3. La cuenta, una sola vez: cubre a quien ya tiene platos y cuya reserva
  //    venció. Si la base falla, el error sube como cualquier otro del pedido.
  const cuentaMesa = await mesasService.cuentaPorComensal(idMesa);

  for (const [clave, normalizado] of sinReserva) {
    // La búsqueda vive en services/alias-en-cuenta.js: la misma pregunta se
    // hace al dar de alta a alguien y al quitarlo, y tres copias acabarían
    // contestando cosas distintas. Devuelve el texto TAL COMO está en la
    // cuenta, que es el valor por el que la base agrupa.
    const enLaCuenta = aliasEnCuenta.aliasConPlatos(cuentaMesa, clave);
    if (enLaCuenta) {
      porClave.set(clave, enLaCuenta);
      continue;
    }

    if (redisCaido) {
      // Sin Redis no se puede afirmar que no esté registrada: se sigue con el
      // texto normalizado, como antes de D-18b. El log no lleva el alias: es un
      // dato de la mesa y estos avisos acaban en archivos y en consolas ajenas.
      console.error(
        `[pedidos] no se pudo verificar el comensal de la mesa ${idMesa}: se guarda el alias tal como llegó`
      );
      porClave.set(clave, normalizado);
      continue;
    }

    // El 409 dice CUÁL de los alias no se pudo resolver: con un pedido de
    // varias personas, "no está registrada" sin decir quién obliga a adivinar.
    // Va el PRIMERO que falla en el orden de los ítems, y solo ese: el texto lo
    // mandó quien llama, así que no se le devuelve nada de nadie más.
    return {
      error: {
        status: 409,
        body: {
          error: MENSAJE_NO_REGISTRADO,
          motivo: MOTIVO_NO_REGISTRADO,
          alias: normalizado,
        },
      },
    };
  }

  return { porClave };
}

/**
 * POST /api/pedidos — lo usan el comensal (desde su sesión de QR), el mesero y
 * el admin. Si quien pide es un comensal, la mesa sale del token y el id_mesa
 * del body se ignora: así una mesa no puede ordenar a nombre de otra.
 *
 * Los platos personalizables llegan con `ingredientes`; el backend no decide
 * nada sobre ellos (ni precio ni validez): los inserta y deja que el trigger
 * tr_validar_detalle_ingrediente y validar_selecciones_detalle manden.
 */
async function crear(req, res, next) {
  const parsed = crearPedidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

  const comensal = esComensal(req);
  const id_mesa = comensal ? req.user.id_mesa : parsed.data.id_mesa;
  // El pedido pertenece a la mesa; id_usuario solo alimenta la auditoría y va
  // null cuando lo crea un comensal (no existe en la tabla usuarios).
  const id_usuario = comensal ? null : req.user.id_usuario;

  if (!id_mesa) {
    return res.status(400).json({ error: 'id_mesa es obligatorio para el personal' });
  }

  try {
    // D-18b: el alias canónico de cada persona del pedido se resuelve ANTES de
    // abrir la transacción y una sola vez por alias distinto. Solo para el
    // personal: el alias de un comensal sale de su JWT y no hay nada que
    // resolver.
    let porClave = new Map();
    if (!comensal) {
      const resuelto = await resolverAliasCanonicos(id_mesa, parsed.data.items);
      if (resuelto.error) return res.status(resuelto.error.status).json(resuelto.error.body);
      porClave = resuelto.porClave;
    }

    // El alias se resuelve aquí (es una decisión sobre quién pide, propia del
    // controller) y el service recibe los ítems ya normalizados.
    const items = parsed.data.items.map((item) => ({
      id_plato: item.id_plato,
      cantidad: item.cantidad,
      comensal: aliasDelComensal(req, item, porClave),
      notas: item.notas ?? null,
      ingredientes: (item.ingredientes ?? []).map((i) => ({
        id_ingrediente: i.id_ingrediente,
        porcion: i.porcion,
      })),
    }));

    const pedido = await pedidosService.crearConDetalles({
      id_mesa,
      id_usuario,
      items,
      notas_generales: parsed.data.notas_generales,
    });
    // Avisa al socket-server para que la comanda aparezca en vivo en el KDS, el
    // panel admin y la mesa. Sin await a propósito: el tiempo real no debe
    // retrasar ni hacer fallar la respuesta del pedido (el notifier nunca lanza).
    socketNotifier.notificarPedidoCreado(pedido, pedido.detalles);

    return res.status(201).json({
      id_pedido: pedido.id_pedido,
      codigo_pedido: pedido.codigo_pedido,
      id_mesa: pedido.id_mesa,
      estado: pedido.estado,
      total: pedido.total,
    });
  } catch (err) {
    // D-17: un deadlock al crear el pedido NO se reintenta aquí.
    //
    // La reserva de inventario (`tr_reservar_inventario`) bloquea los insumos
    // del pedido en orden de id_insumo justo para no cruzarse con otra, pero
    // sigue compartiendo filas con las demás transacciones del salón, así que un
    // 40P01 es posible. Reintentar por nuestra cuenta exigiría poder repetir la
    // petición sin crear dos pedidos, y `POST /api/pedidos` **no acepta ninguna
    // clave de idempotencia**: el reintento podría dejar la comanda duplicada.
    //
    // Así que se responde 503 `reintentar`, que es lo que de verdad hace falta:
    // decirle al cliente que esta no se guardó y que la vuelva a mandar él. El
    // 409 genérico de concurrencia del manejador central no distingue esto de
    // una guarda de negocio que el cliente tiene que atender.
    if (esErrorDeConcurrencia(err && err.code)) {
      console.error(
        `[pedidos] deadlock al crear el pedido de la mesa ${id_mesa} (${err.code}): ${err.message}`
      );
      return res.status(503).json({ error: MENSAJE_REINTENTAR, motivo: MOTIVO_REINTENTAR });
    }
    return next(err);
  }
}

/**
 * GET /api/pedidos/activos — panel del restaurante (admin, cajero, mesero).
 *
 * Devuelve `{ pedidos }` con cada pedido en el mismo formato que
 * GET /pedidos/:id: sus `detalles`, cada uno con el nombre del plato y los
 * ingredientes elegidos, más `mesa_numero`. El servicio decide qué estados
 * cuentan como activos y agrupa los detalles.
 */
async function listarActivos(req, res, next) {
  try {
    const pedidos = await pedidosService.listarActivos();
    return res.json({ pedidos });
  } catch (err) {
    return next(err);
  }
}

/**
 * ¿El pedido es de la visita que está sentada ahora en la mesa?
 *
 * Misma regla que el SQL (`creado_en >= sesion_iniciada_en`), aquí en
 * JavaScript porque es una comprobación de permiso sobre una fila que ya se
 * leyó, no una consulta. Sin sesión delimitada (NULL) se acepta, igual que en
 * la base.
 */
function esDeLaVisitaActual(pedido, mesa) {
  if (!mesa || !mesa.sesion_iniciada_en) return true;
  return new Date(pedido.creado_en) >= new Date(mesa.sesion_iniciada_en);
}

async function obtener(req, res, next) {
  try {
    const pedido = await pedidosService.obtenerConDetalles(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Un comensal solo puede ver los pedidos de su propia mesa...
    if (esComensal(req) && pedido.id_mesa !== req.user.id_mesa) {
      return res.status(403).json({ error: 'Ese pedido no pertenece a tu mesa' });
    }

    // ...y solo los de SU visita. Sin esto, un comensal podría leer por id un
    // pedido del grupo anterior sentado en la misma mesa (sus platos, su alias
    // y su total), que es la misma fuga que cierra el filtro de
    // GET /api/pedidos/mesa. El personal sí ve el histórico completo.
    if (esComensal(req) && !esDeLaVisitaActual(pedido, await mesasService.obtenerPorId(pedido.id_mesa))) {
      return res.status(403).json({ error: 'Ese pedido no pertenece a tu mesa' });
    }

    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

async function actualizarEstado(req, res, next) {
  const { estado, observaciones } = req.body;
  if (!pedidosService.ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({
      error: `Estado inválido. Usa uno de: ${pedidosService.ESTADOS_VALIDOS.join(', ')}`,
    });
  }

  try {
    const pedido = await pedidosService.actualizarEstado(
      req.params.id,
      estado,
      observaciones,
      esComensal(req) ? null : req.user.id_usuario
    );
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    // actualizarEstado devuelve el pedido ya con estado_anterior, que es lo que
    // espera el payload de order:status.
    socketNotifier.notificarCambioEstado(pedido);

    // El cierre del pedido pudo liberar la mesa (ya ocurrió en la transacción):
    // se avisa para que el socket-server cierre la sesión de esa mesa.
    //
    // H-22: el motivo sale del estado en el que quedó el pedido. Marcarlo
    // 'entregado' cuando ya estaba pagado, o 'pagado' a mano, libera la mesa
    // por un PAGO ('pagada'); cancelarlo la libera sin cobrar ('liberada').
    // Aquí NO se avisa payment-confirmed: no entró dinero nuevo, el pago ya se
    // había registrado antes y anunciarlo otra vez sería un pago fantasma.
    if (pedido.mesaLiberada) {
      socketNotifier.notificarMesaLiberada(
        pedido.id_mesa,
        socketNotifier.motivoPorEstadoFinal(pedido.estado)
      );
      aliasComensal.olvidarMesa(pedido.id_mesa);
    }

    return res.json(pedido);
  } catch (err) {
    return next(err);
  }
}

/**
 * Atajo de PATCH /:id/estado con estado = 'cancelado'. Cancelar solo es legal
 * desde 'recibido' o 'en_preparacion' (transiciones_validas); desde 'listo' o
 * 'entregado' el trigger responde 409, así que hay que propagar next para que
 * ese error llegue al manejador central.
 */
async function cancelar(req, res, next) {
  req.body = { ...req.body, estado: 'cancelado' };
  return actualizarEstado(req, res, next);
}

/** Un id de la URL: entero > 0 que cabe en un INTEGER de PostgreSQL. */
const idDeUrl = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, 'debe ser un entero mayor que 0')
  .transform(Number)
  .refine((n) => n <= 2147483647, 'fuera de rango');

const paramsQuitarItemSchema = z.object({ id: idDeUrl, id_detalle: idDeUrl }).strict();

/** Sin cuerpo: `{}` o nada. Un campo cualquiera es un 400. */
const cuerpoVacioSchema = z.object({}).strict();

/**
 * POST /api/pedidos/:id/items/:id_detalle/cancelar — D-13 por el comensal
 * (J-14): el comensal quita UNA línea de su pedido, entera. Solo con sesión de
 * comensal; la mesa y el alias salen del JWT, nunca del cuerpo. Las reglas viven
 * en pedidosService.cancelarItemComensal.
 *
 * Los avisos salen DESPUÉS del commit y sin esperarlos: primero
 * /internal/item-cancelado (pendiente de Roberto) y, si el pedido quedó
 * cancelado, el order:status de siempre.
 */
async function cancelarItem(req, res, next) {
  const params = paramsQuitarItemSchema.safeParse(req.params);
  if (!params.success) {
    const issue = params.error.errors[0];
    return res.status(400).json({ error: `${issue.path.join('.')}: ${issue.message}`, motivo: 'parametro_invalido' });
  }
  if (!cuerpoVacioSchema.safeParse(req.body ?? {}).success) {
    return res.status(400).json({ error: 'Esta ruta no lleva cuerpo', motivo: 'cuerpo_invalido' });
  }

  try {
    const r = await pedidosService.cancelarItemComensal(params.data.id, params.data.id_detalle, {
      idMesa: req.user.id_mesa,
      comensal: req.user.comensal,
    });

    if (r.noExiste) {
      return res.status(404).json({ error: 'Ese plato no está en ese pedido', motivo: 'no_encontrado' });
    }
    if (r.noEsTuyo) {
      return res.status(403).json({
        error: 'Solo puedes quitar tus propios platos de un pedido de tu mesa',
        motivo: pedidosService.MOTIVOS_QUITAR_ITEM.noEsTuyo,
      });
    }
    if (r.conflicto) {
      return res.status(409).json({ error: MENSAJES_QUITAR_ITEM[r.conflicto], motivo: r.conflicto });
    }

    const { pedido, linea, pedidoCancelado, estadoAnterior } = r;
    const pasos = [() => socketNotifier.notificarItemCancelado({
      id_pedido: pedido.id_pedido,
      id_mesa: pedido.id_mesa,
      codigo_pedido: pedido.codigo_pedido,
      id_detalle: linea.id_detalle,
      id_plato: linea.id_plato,
      nombre: linea.nombre,
      comensal: linea.comensal,
      total: pedido.total,
      estado_pedido: pedido.estado,
    })];
    if (pedidoCancelado) {
      pasos.push(() => socketNotifier.notificarCambioEstado({ ...pedido, estado_anterior: estadoAnterior }));
    }
    socketNotifier.encadenarAvisos(pasos);

    return res.json({
      pedido: {
        id_pedido: pedido.id_pedido,
        codigo_pedido: pedido.codigo_pedido,
        estado: pedido.estado,
        total: Number(pedido.total),
        items: pedido.items,
      },
    });
  } catch (err) {
    return next(err);
  }
}

const MENSAJES_QUITAR_ITEM = {
  item_ya_cancelado: 'Ese plato ya estaba quitado del pedido',
  item_en_preparacion: 'Ese plato ya se está preparando: pídeselo al mesero',
  pago_registrado: 'El pedido ya tiene un pago que quedaría por encima del total: pídeselo al mesero',
};

/**
 * GET /api/pedidos/mesa — pedidos de la mesa de la sesión del comensal.
 * Reemplaza al viejo /pedidos/historial: el modelo ER no relaciona pedidos con
 * usuarios, así que no hay historial "por cliente", solo por mesa.
 */
async function listarPorMesa(req, res, next) {
  try {
    const pedidos = await pedidosService.listarPorMesa(req.user.id_mesa);
    return res.json({ id_mesa: req.user.id_mesa, pedidos });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/pedidos/mesa/cuenta — la cuenta de SU mesa, para el comensal.
 *
 * La mesa sale del JWT y de ningún otro sitio, igual que en listarPorMesa: si
 * se aceptara un id por la URL o por el body, un comensal podría leer la cuenta
 * (y los alias) de otra mesa. Por eso la ruta no tiene parámetro.
 *
 * Devuelve lo mismo que la cuenta del personal, con los montos en pesos.
 */
async function cuentaDeMiMesa(req, res, next) {
  try {
    const cuenta = await mesasService.cuentaPorComensal(req.user.id_mesa);
    // La sesión vive mientras la mesa tenga su token_qr, así que no existir
    // aquí es raro; igual se contesta 404 en vez de dejar pasar un null.
    if (!cuenta) return res.status(404).json({ error: 'Mesa no encontrada' });
    return res.json(cuenta);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  MOTIVO_NO_REGISTRADO,
  MENSAJE_NO_REGISTRADO,
  MOTIVO_REINTENTAR,
  MENSAJE_REINTENTAR,
  crear,
  listarActivos,
  obtener,
  actualizarEstado,
  cancelar,
  cancelarItem,
  listarPorMesa,
  cuentaDeMiMesa,
};
