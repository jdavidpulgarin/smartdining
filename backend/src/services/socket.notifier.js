const crypto = require('crypto');

/**
 * Único punto por donde el backend avisa al socket-server de Roberto.
 *
 * Contrato: socket-server/EVENTS.md (sección 6). Son POST a /internal/* con la
 * cabecera x-internal-key y un eventId UUID v4 por acción; reintentar con el
 * mismo eventId es seguro porque él deduplica.
 *
 * AISLAMIENTO (regla de diseño): el tiempo real es un extra, no parte de la
 * transacción. Ninguna función de aquí lanza: si el socket-server está caído,
 * lento o responde mal, se registra y se devuelve { ok: false }, y el pedido o
 * el pago siguen su curso. Por eso tampoco se hace await en los controllers
 * sobre el resultado para decidir la respuesta HTTP.
 */

const TIMEOUT_POR_DEFECTO_MS = 1500;

function config() {
  return {
    url: (process.env.SOCKET_URL || '').replace(/\/$/, ''),
    clave: process.env.INTERNAL_API_KEY || '',
    timeoutMs: Number(process.env.SOCKET_TIMEOUT_MS) || TIMEOUT_POR_DEFECTO_MS,
  };
}

/** Un eventId por acción del usuario, como exige la idempotencia de Roberto. */
function nuevoEventId() {
  return crypto.randomUUID();
}

/**
 * POST a una ruta interna. Nunca lanza.
 * @returns {Promise<{ok: boolean, motivo?: string, respuesta?: object}>}
 */
async function enviar(ruta, cuerpo) {
  const { url, clave, timeoutMs } = config();

  // Sin configuración no es un error: simplemente el tiempo real está apagado
  // (por ejemplo en las pruebas o en un entorno sin socket-server).
  if (!url || !clave) {
    return { ok: false, motivo: 'SIN_CONFIGURAR' };
  }

  // AbortSignal.timeout corta la espera; sin esto un socket-server colgado
  // dejaría la petición del comensal esperando.
  const control = AbortSignal.timeout(timeoutMs);

  try {
    const res = await fetch(`${url}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': clave },
      body: JSON.stringify(cuerpo),
      signal: control,
    });

    const texto = await res.text();
    let respuesta = null;
    try {
      respuesta = texto ? JSON.parse(texto) : null;
    } catch {
      respuesta = { crudo: texto.slice(0, 200) };
    }

    if (!res.ok) {
      console.error(`[socket] ${ruta} respondio ${res.status}:`, respuesta);
      return { ok: false, motivo: `HTTP_${res.status}`, respuesta };
    }
    return { ok: true, respuesta };
  } catch (err) {
    // Incluye el timeout (AbortError) y que el socket-server no esté levantado.
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] ${ruta} no se pudo notificar (${motivo}):`, err.message);
    return { ok: false, motivo };
  }
}

/**
 * Última cadena de avisos lanzada. Solo existe para que las pruebas puedan
 * esperarla: en producción nadie la mira.
 */
let ultimaCadena = Promise.resolve();

/**
 * Lanza varios avisos EN ORDEN y sin que el handler espere el resultado.
 *
 * Hay avisos cuyo orden importa y no se puede dejar al azar de la red: al
 * liquidar una cuenta, `payment-confirmed` tiene que salir ANTES que
 * `mesa-liberada`, porque mesa-liberada desconecta a los comensales y, si
 * llegara primero, la mesa nunca vería el pago que acaba de hacer (EVENTS.md
 * §8.6). Lanzarlos a la vez con tres llamadas sueltas no garantiza ese orden.
 *
 * Por eso se encadenan con await entre uno y otro, pero la cadena NO se espera
 * en el controller: la respuesta HTTP sale de inmediato, porque el cobro ya
 * está guardado y el tiempo real es un extra. El catch es defensivo: las
 * funciones de este módulo ya no lanzan, así que si algo llega aquí es un error
 * de programación y se registra en vez de volverse un rechazo sin dueño que
 * tumbe el proceso.
 *
 * @param {Array<() => Promise<any>>} pasos Avisos a enviar, en orden.
 * @returns {Promise<void>} La misma cadena, para quien quiera esperarla.
 */
function encadenarAvisos(pasos) {
  const cadena = pasos
    .reduce((previo, paso) => previo.then(() => paso()), Promise.resolve())
    .then(() => undefined)
    .catch((err) => {
      console.error('[socket] la cadena de avisos fallo inesperadamente:', err && err.message);
    });

  ultimaCadena = cadena;
  return cadena;
}

/**
 * Espera a que terminen los avisos en vuelo. Es para las PRUEBAS: así pueden
 * comprobar qué se envió y en qué orden sin recurrir a temporizadores, que
 * harían la suite lenta y frágil.
 */
function esperarAvisos() {
  return ultimaCadena;
}

/**
 * Da forma al pedido tal como lo documenta EVENTS.md, no como lo devuelve la
 * base: los ítems usan `nombre` (no `plato_nombre`) porque ese es el nombre de
 * campo del contrato de Roberto, que es lo que leen los frontends.
 *
 * Cada ítem lleva `comensal` (quién lo pidió) e `ingredientes` con su porción y
 * el precio_aplicado que congeló la base, que es lo que el KDS necesita para
 * preparar un plato armado y la tablet para mostrar la cuenta por persona.
 * `notas_especiales` es solo la nota del ítem: el alias ya no va dentro.
 *
 * Cada ingrediente lleva además `paso`, el nombre del paso del constructor al
 * que pertenece ("Elige tu Base", "Añade Toppings"). El KDS agrupa por él para
 * leer el plato en el orden en que se arma, y sin ese campo una comanda que
 * entra EN VIVO se veía plana —"Ingredientes: a · b · c"— mientras que la misma
 * comanda, tras recargar, salía agrupada: los mismos datos se veían de dos
 * formas distintas según por dónde hubieran llegado.
 *
 * Los ingredientes mantienen el orden que trae la consulta (pasos_constructor
 * .orden), así que agrupar por `paso` respeta el orden del constructor sin que
 * el receptor tenga que ordenar nada.
 */
function armarPedido(pedido, detalles = []) {
  return {
    id_pedido: pedido.id_pedido,
    codigo_pedido: pedido.codigo_pedido ?? null,
    id_mesa: pedido.id_mesa,
    estado: pedido.estado,
    total: pedido.total,
    notas_generales: pedido.notas_generales ?? null,
    items: detalles.map((d) => ({
      id_plato: d.id_plato,
      nombre: d.plato_nombre ?? null,
      cantidad: d.cantidad,
      comensal: d.comensal ?? null,
      notas_especiales: d.notas_especiales ?? null,
      // `id_paso` se queda en la API REST: es una clave interna y quien recibe
      // el evento agrupa por el nombre, no por el id.
      ingredientes: (d.ingredientes || []).map((i) => ({
        id_ingrediente: i.id_ingrediente,
        nombre: i.nombre,
        porcion: i.porcion,
        precio_aplicado: i.precio_aplicado,
        // null cuando el ingrediente no viene de un paso del constructor; el
        // campo va igual, para que el receptor no tenga que distinguir entre
        // "sin paso" y "este evento no trae el dato".
        paso: i.paso ?? null,
      })),
    })),
  };
}

/**
 * POST /qr/generar — pide al socket-server el token del QR de una mesa.
 *
 * Reenvía el JWT del mesero/admin que abrió la mesa porque esa ruta exige
 * `Authorization: Bearer` con rol admin/mesero/cajero: el socket-server decide
 * por sí mismo si quien pide puede generar QR, sin que el backend suplante a
 * nadie con la clave interna.
 *
 * Como en validarTokenQr, aquí el resultado SÍ importa: sin token no se puede
 * abrir la mesa, así que se distingue "me rechazó" de "no pude preguntar".
 *
 * @returns {Promise<{alcanzado: boolean, token?: string, expira_en?: number,
 *                    status?: number, mensaje?: string, motivo?: string}>}
 */
async function generarTokenQr(idMesa, jwtStaff, ttlMinutos) {
  const { url, timeoutMs } = config();
  if (!url) return { alcanzado: false, motivo: 'SIN_CONFIGURAR' };

  const cuerpo = { id_mesa: idMesa };
  if (ttlMinutos !== undefined) cuerpo.ttl_minutos = ttlMinutos;

  try {
    const res = await fetch(`${url}/qr/generar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtStaff}`,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const texto = await res.text();
    let respuesta = null;
    try {
      respuesta = texto ? JSON.parse(texto) : null;
    } catch {
      respuesta = null;
    }

    if (res.status === 201 && respuesta && respuesta.token) {
      return { alcanzado: true, token: respuesta.token, expira_en: respuesta.expira_en };
    }
    // 401/403/400: el socket-server contestó y dijo que no. Es un veredicto, no
    // una caída, así que el llamador puede traducirlo a su propio status.
    if (res.status >= 400 && res.status < 500) {
      return {
        alcanzado: true,
        status: res.status,
        mensaje: (respuesta && respuesta.mensaje) || 'El servicio de QR rechazó la solicitud',
      };
    }
    console.error(`[socket] /qr/generar respondio ${res.status}:`, respuesta);
    return { alcanzado: false, motivo: `HTTP_${res.status}` };
  } catch (err) {
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] /qr/generar no se pudo consultar (${motivo}):`, err.message);
    return { alcanzado: false, motivo };
  }
}

/**
 * POST /qr/validar — decide si un token QR sirve para abrir sesión de mesa.
 *
 * A diferencia del resto de este módulo, aquí el resultado SÍ importa: sin
 * validar no se puede entrar, así que el llamador tiene que distinguir "token
 * inválido" de "no pude preguntar" y responder 503 en el segundo caso.
 *
 * La ruta es pública en el socket-server (el comensal aún no tiene sesión
 * cuando escanea), por eso no lleva x-internal-key.
 *
 * @returns {Promise<{alcanzado: boolean, valido?: boolean, id_mesa?: number,
 *                    motivo?: string}>}
 */
async function validarTokenQr(token) {
  const { url, timeoutMs } = config();
  if (!url) return { alcanzado: false, motivo: 'SIN_CONFIGURAR' };

  try {
    const res = await fetch(`${url}/qr/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const texto = await res.text();
    let cuerpo = null;
    try {
      cuerpo = texto ? JSON.parse(texto) : null;
    } catch {
      cuerpo = null;
    }

    // 200 => válido; 401 => inválido con motivo. Cualquier otro status es un
    // problema del socket-server, no un veredicto sobre el token.
    if (res.status === 200 && cuerpo && cuerpo.valido) {
      return { alcanzado: true, valido: true, id_mesa: cuerpo.id_mesa, expira_en: cuerpo.expira_en };
    }
    if (res.status === 401) {
      return { alcanzado: true, valido: false, motivo: (cuerpo && cuerpo.motivo) || 'invalido' };
    }
    console.error(`[socket] /qr/validar respondio ${res.status}:`, cuerpo);
    return { alcanzado: false, motivo: `HTTP_${res.status}` };
  } catch (err) {
    const motivo = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'TIMEOUT' : 'INALCANZABLE';
    console.error(`[socket] /qr/validar no se pudo consultar (${motivo}):`, err.message);
    return { alcanzado: false, motivo };
  }
}

/** POST /internal/order-created — comanda nueva hacia KDS, admin y la mesa. */
async function notificarPedidoCreado(pedido, detalles) {
  return enviar('/internal/order-created', {
    eventId: nuevoEventId(),
    pedido: armarPedido(pedido, detalles),
  });
}

/** POST /internal/order-status — cambio de estado hacia KDS, admin y la mesa. */
async function notificarCambioEstado({ id_pedido, id_mesa, codigo_pedido, estado_anterior, estado }) {
  return enviar('/internal/order-status', {
    eventId: nuevoEventId(),
    id_pedido,
    id_mesa,
    codigo_pedido: codigo_pedido ?? null,
    estado_anterior: estado_anterior ?? null,
    estado,
  });
}

/**
 * POST /internal/qr-rotado — avisa a la tablet de la mesa que hay un QR nuevo.
 *
 * Modelo "QR en vidrio" (opción A): el QR no se imprime, lo muestra la tablet
 * fija de la mesa. El socket-server reenvía esto como `qr:actualizado` a
 * room:mesa-{id}, y la tablet redibuja el QR sola.
 *
 * Aislado como el resto de los avisos: si falla, la mesa ya quedó abierta y el
 * mesero siempre puede volver a pulsar "abrir" (es idempotente).
 */
async function notificarQrRotado(id_mesa, token_qr) {
  const resultado = await enviar('/internal/qr-rotado', { id_mesa, token_qr });

  // Un 400 aquí casi siempre es el límite de longitud del socket-server: hoy
  // acepta hasta 128 caracteres (MAX_TOKEN_QR_MOSTRADO) y nuestros tokens v1
  // miden ~150. Roberto lo va a subir a 255. Se deja constancia con el motivo y
  // la longitud real, sin recortar el token: un token recortado no valida.
  if (!resultado.ok && resultado.motivo === 'HTTP_400') {
    const mensaje = (resultado.respuesta && resultado.respuesta.mensaje) || 'sin mensaje';
    console.error(
      `[socket] /internal/qr-rotado rechazo el token de la mesa ${id_mesa}: ${mensaje} `
        + `(longitud enviada: ${String(token_qr).length}). La tablet no refrescara el QR.`
    );
  }

  return resultado;
}

/**
 * Motivos de /internal/mesa-liberada (EVENTS.md §5.1). El socket-server pone
 * 'liberada' por defecto si no se manda, así que lo que importa es mandar
 * 'pagada' cuando la causa fue un pago: las pantallas distinguen "se fueron
 * pagando" de "el mesero cerró la mesa" (H-22).
 */
const MOTIVO_PAGADA = 'pagada';
const MOTIVO_LIBERADA = 'liberada';

/**
 * Motivo con el que se anuncia una mesa que se liberó al cerrarse un pedido.
 *
 * Sale del estado FINAL del pedido, que es la causa real de la liberación: un
 * pedido que acabó en 'pagado' dejó la mesa libre porque se pagó; uno que acabó
 * 'cancelado' la dejó libre porque se anuló. Derivarlo así evita que cada
 * controller se invente el motivo por su cuenta, que es como apareció H-22.
 *
 * @param {string} estadoFinal Estado en el que quedó el pedido.
 */
function motivoPorEstadoFinal(estadoFinal) {
  return estadoFinal === 'pagado' ? MOTIVO_PAGADA : MOTIVO_LIBERADA;
}

/** Tope de referencia_externa que acepta el socket-server (EVENTS.md §8.6). */
const MAX_REFERENCIA_PAGO = 255;

/**
 * POST /internal/payment-confirmed — un cobro de CAJA (efectivo, datáfono o
 * abono parcial) ya guardado en la base, para que todas las cajas y la mesa
 * vean el saldo nuevo al instante (EVENTS.md §8.6).
 *
 * El socket-server lo reemite como `payment:confirmed`, el MISMO evento y el
 * mismo payload que un pago de Wompi, y convierte a pesos él solo. Por eso aquí
 * todo va en centavos enteros: el dinero en float pierde precisión al sumar
 * abonos.
 *
 * NO se llama para los pagos en línea: en esos el socket-server ya emite
 * `payment:confirmed` desde su propio webhook, y como lo hace sin pasar por su
 * registro de idempotencia, avisar también desde aquí anunciaría el pago dos
 * veces.
 *
 * Aislado como el resto: se llama DESPUÉS del COMMIT y si falla, el pago ya
 * está guardado y no se revierte; solo se pierde el aviso en vivo y las
 * pantallas lo verán al recargar la cuenta.
 *
 * @param {{id_mesa: number, monto_centavos: number,
 *          saldo_restante_centavos: number, comensal?: string|null,
 *          referencia_externa?: string|null, id_transaccion?: number|null}} pago
 */
async function notificarPagoConfirmado({
  id_mesa,
  monto_centavos,
  saldo_restante_centavos,
  comensal = null,
  referencia_externa = null,
  id_transaccion = null,
}) {
  // El socket-server exige monto_centavos >= 1 y responde 400 si no. Un cobro
  // de cero o negativo no existe en caja, así que en vez de gastar una petición
  // que se va a rechazar se deja constancia y no se llama.
  if (!Number.isSafeInteger(monto_centavos) || monto_centavos < 1) {
    console.error(
      `[socket] /internal/payment-confirmed no se envia: monto_centavos invalido (${monto_centavos}) en la mesa ${id_mesa}`
    );
    return { ok: false, motivo: 'MONTO_INVALIDO' };
  }

  // Una referencia más larga que el tope haría que el socket-server rechazara
  // el aviso entero con 400. Vale más perder el dato del voucher que el aviso:
  // el número completo queda en transacciones.referencia_externa.
  let referencia = referencia_externa ?? null;
  if (typeof referencia === 'string' && referencia.length > MAX_REFERENCIA_PAGO) {
    console.warn(
      `[socket] /internal/payment-confirmed: referencia_externa de ${referencia.length} caracteres `
        + `(tope ${MAX_REFERENCIA_PAGO}) en la mesa ${id_mesa}; se envia null para no perder el aviso`
    );
    referencia = null;
  }

  return enviar('/internal/payment-confirmed', {
    // Un eventId por cobro: es la primera guardia de idempotencia del
    // socket-server. La segunda es id_transaccion, que evita que un reintento
    // con un eventId nuevo anuncie el mismo cobro dos veces.
    eventId: nuevoEventId(),
    id_mesa,
    comensal: comensal ?? null,
    monto_centavos,
    saldo_restante_centavos,
    referencia_externa: referencia,
    id_transaccion: id_transaccion ?? null,
  });
}

/**
 * POST /internal/mesa-liberada — invalida los QR emitidos de esa mesa y borra
 * su carrito y sus suscripciones push, para que el grupo siguiente empiece
 * limpio. Se llama tras un pago efectivo (estado_transaccion 'completada').
 *
 * `motivo` es opcional y solo viaja si se pasa. Lo manda quien liberó la mesa
 * por un PAGO —el cobro en caja y el pago en línea (EVENTS.md §8.3)— con
 * MOTIVO_PAGADA, que es lo que corrige H-22: antes el cobro de caja no mandaba
 * nada y el socket-server lo anunciaba con su valor por omisión, 'liberada', o
 * sea "el mesero cerró la mesa", cuando en realidad el grupo pagó.
 *
 * Liberar a mano no lo manda: 'liberada' es justo el valor por omisión del
 * socket-server, así que el cuerpo se queda como estaba.
 */
async function notificarMesaLiberada(id_mesa, motivo) {
  const cuerpo = { id_mesa };
  if (motivo !== undefined && motivo !== null) cuerpo.motivo = motivo;
  return enviar('/internal/mesa-liberada', cuerpo);
}

/**
 * POST /internal/ingrediente-disponibilidad (D-05) — un ingrediente se agotó
 * (`false`) o volvió (`true`). El socket-server lo difunde a TODOS los sockets
 * como `ingrediente:disponibilidad` (EVENTS.md §5.3): cada mesa deshabilita esa
 * opción del constructor en vivo, y el KDS puede avisar.
 *
 * Solo viajan los dos campos y el eventId. `emitidoEn` NO se manda: lo pone él
 * al emitir (sala.js), y mandarlo sería un campo que se ignora.
 *
 * Un eventId por llamada, incluso si el valor no cambió: así un reenvío lo
 * recuperan los clientes que se perdieron el anterior, en vez de que Roberto lo
 * deduplique y el aviso se pierda en silencio.
 */
async function notificarIngredienteDisponibilidad(id_ingrediente, disponible) {
  return enviar('/internal/ingrediente-disponibilidad', {
    id_ingrediente,
    disponible,
    eventId: nuevoEventId(),
  });
}

module.exports = {
  nuevoEventId,
  armarPedido,
  encadenarAvisos,
  esperarAvisos,
  generarTokenQr,
  validarTokenQr,
  notificarQrRotado,
  notificarPedidoCreado,
  notificarCambioEstado,
  notificarPagoConfirmado,
  notificarMesaLiberada,
  notificarIngredienteDisponibilidad,
  motivoPorEstadoFinal,
  MOTIVO_PAGADA,
  MOTIVO_LIBERADA,
  MAX_REFERENCIA_PAGO,
  TIMEOUT_POR_DEFECTO_MS,
};
