const crypto = require('crypto');
const { esIdValido, salaMesa, SALA_ADMIN } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson,
} = require('./http');
const { verificarJwt, ROL_COMENSAL } = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const { calcularMonto, validarCuenta, MODOS } = require('./cuenta');

const MAX_ALIAS = 40;
// 5 intenciones por minuto por comensal: de sobra para reintentar un pago
// fallido y corta a quien intenta martillar al backend o a la pasarela.
const LIMITE_INTENCIONES = 5;
const VENTANA_LIMITE_SEG = 60;

/** Referencia única e impredecible: SD-{mesa}-{timestamp}-{12 bytes aleatorios}. */
function generarReferencia(idMesa, ahora = Date.now) {
  return `SD-${idMesa}-${ahora()}-${crypto.randomBytes(12).toString('base64url')}`;
}

/** Comensal autenticado por Bearer, con su sesión de mesa todavía vigente. */
async function comensalAutenticado(req, ctx) {
  const auth = req.headers.authorization || '';
  const identidad = auth.startsWith('Bearer ') ? verificarJwt(auth.slice(7), ctx.config.jwtSecret) : null;
  if (!identidad) throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Se requiere un JWT válido');
  if (identidad.rol !== ROL_COMENSAL) throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Solo un comensal puede pagar desde la mesa');
  if (await ctx.qr.revocadaDespuesDe(identidad.id_mesa, identidad.iat)) {
    throw new ErrorHttp(401, 'NO_AUTORIZADO', 'La sesión de esta mesa ya se cerró');
  }
  return identidad;
}

/**
 * POST /pagos/intencion — capas 1, 2 y 3 del pago:
 *  1. El monto lo calcula el servidor con la cuenta del backend (id_mesa del JWT).
 *  2. Referencia única e impredecible guardada con lo que se espera cobrar.
 *  3. Firma de integridad calculada aquí; el secreto nunca sale del servidor.
 * Cuerpo: { modo, eventId, comensal }. Cualquier otro campo (monto, id_mesa,
 * precio...) se ignora: el cliente no decide montos ni mesa.
 */
async function crearIntencionPago(req, res, ctx) {
  if (!ctx.pasarela || !ctx.backend) throw new ErrorHttp(503, 'NO_CONFIGURADO', 'Los pagos no están configurados');
  const identidad = await comensalAutenticado(req, ctx);
  const idMesa = identidad.id_mesa;
  const cuerpo = parsearJson(await leerCuerpoCrudo(req));

  if (!MODOS.includes(cuerpo.modo)) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', `modo debe ser uno de: ${MODOS.join(', ')}`);
  if (!esEventIdValido(cuerpo.eventId)) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
  const comensal = typeof cuerpo.comensal === 'string' ? cuerpo.comensal.trim() : '';
  if (!comensal || comensal.length > MAX_ALIAS) {
    throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', `comensal debe ser un texto de 1 a ${MAX_ALIAS} caracteres`);
  }

  // El alias no viaja en el JWT: como mínimo se exige que esa persona esté
  // sentada ahora en ESTA mesa (presencia real de la sala), para que nadie
  // pague ni consulte "lo propio" de un alias inventado.
  const presencia = await ctx.presencia.calcular(idMesa);
  if (!presencia.comensales.includes(comensal)) {
    throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Únete a la mesa (join:table) con tu nombre antes de pagar');
  }

  // Reintento del mismo eventId: misma respuesta, sin otra intención.
  const claveEvento = `comensal:pago:intencion:${idMesa}:${cuerpo.eventId}`;
  const previa = await ctx.registro.obtener(claveEvento);
  if (previa) return enviarJson(res, 200, previa);

  if (!(await ctx.limites.consumir(`pago:${idMesa}:${comensal}`, LIMITE_INTENCIONES, VENTANA_LIMITE_SEG))) {
    throw new ErrorHttp(429, 'RATE_LIMIT', 'Demasiados intentos de pago; espera un minuto');
  }

  const ttlSeg = ctx.config.wompi.ttlMinutos * 60;
  const responder = async (intencion, status) => {
    const respuesta = ctx.pasarela.crearIntencion({
      referencia: intencion.referencia,
      montoCentavos: intencion.monto_centavos,
      moneda: 'COP',
      expiraEn: new Date(intencion.expira_en),
    });
    await ctx.registro.guardar(claveEvento, respuesta);
    return enviarJson(res, status, respuesta);
  };

  // Una sola intención pendiente por comensal: si ya hay una, es esa.
  const pendiente = await ctx.almacenPagos.obtenerPendiente(idMesa, comensal);
  if (pendiente) {
    const intencion = await ctx.almacenPagos.obtener(pendiente);
    if (intencion && intencion.estado === 'pendiente') return responder({ ...intencion, referencia: pendiente }, 200);
  }

  let cuenta;
  try {
    cuenta = await ctx.backend.get(`/api/mesas/${idMesa}/cuenta/interno`);
  } catch (err) {
    console.error(`[pagos] cuenta de la mesa ${idMesa}: ${err.codigo || err.message}`);
    throw new ErrorHttp(503, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }
  if (!cuenta.ok) {
    console.error(`[pagos] cuenta de la mesa ${idMesa}: el backend respondió ${cuenta.status}`);
    throw new ErrorHttp(502, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }
  const errorCuenta = validarCuenta(cuenta.cuerpo, idMesa);
  if (errorCuenta) {
    console.error(`[pagos] cuenta de la mesa ${idMesa} inválida: ${errorCuenta}`);
    throw new ErrorHttp(502, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }

  const monto = calcularMonto({
    modo: cuerpo.modo, cuenta: cuenta.cuerpo, comensal, presentes: presencia.total,
  });
  if (monto.error) throw new ErrorHttp(409, 'SIN_SALDO', 'No hay saldo por pagar en ese modo');

  const ahora = Date.now();
  const referencia = generarReferencia(idMesa, () => ahora);
  const intencion = {
    id_mesa: idMesa,
    comensal,
    modo: cuerpo.modo,
    monto_centavos: monto.montoCentavos,
    estado: 'pendiente',
    creada_en: new Date(ahora).toISOString(),
    expira_en: new Date(ahora + ttlSeg * 1000).toISOString(),
  };
  // Primero la intención y luego la marca de pendiente (SET NX): si otra
  // petición del mismo comensal ganó la carrera, se descarta la nuestra.
  await ctx.almacenPagos.guardarIntencion(referencia, intencion, ttlSeg);
  const ganadora = await ctx.almacenPagos.reservarPendiente(idMesa, comensal, referencia, ttlSeg);
  if (ganadora !== referencia) {
    await ctx.almacenPagos.borrarIntencion(referencia);
    const otra = await ctx.almacenPagos.obtener(ganadora);
    if (otra) return responder({ ...otra, referencia: ganadora }, 200);
  }
  return responder({ ...intencion, referencia }, 201);
}

const TOLERANCIA_SEGUNDOS_POR_DEFECTO = 300; // 5 min: absorbe desfases de reloj sin dejar reutilizar capturas viejas
const TIPO_PAGO_EXITOSO = 'payment.succeeded';
const MAX_ID_EVENTO = 100;

/**
 * Verifica la firma del proveedor de pagos sobre el cuerpo CRUDO.
 *
 * Esquema (estilo Stripe): cabecera `x-signature: t=<unix_seg>,v1=<hex>`,
 * donde v1 = HMAC-SHA256(secreto, "<t>.<cuerpo crudo>").
 *   - Se firma el timestamp junto con el cuerpo: sin él, quien capture un
 *     webhook legítimo podría reenviarlo indefinidamente (replay).
 *   - Se admiten varios v1 en la cabecera para poder rotar el secreto sin
 *     perder pagos durante el cambio.
 *
 * Devuelve { valida: true } o { valida: false, motivo }.
 * NO parsea el cuerpo: hasta no saber que es auténtico no se le da ningún
 * tratamiento a lo que dice.
 */
function verificarFirmaWebhook(cuerpoCrudo, cabecera, secreto, { toleranciaSegundos = TOLERANCIA_SEGUNDOS_POR_DEFECTO, ahora = Date.now } = {}) {
  if (!Buffer.isBuffer(cuerpoCrudo)) return { valida: false, motivo: 'cuerpo' };
  if (typeof cabecera !== 'string' || !cabecera) return { valida: false, motivo: 'sin_firma' };

  let marca = null;
  const candidatas = [];
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const clave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (clave === 't') marca = valor;
    if (clave === 'v1') candidatas.push(valor);
  }
  if (!/^\d{1,12}$/.test(marca || '') || candidatas.length === 0) return { valida: false, motivo: 'formato' };

  const t = Number(marca);
  if (Math.abs(Math.floor(ahora() / 1000) - t) > toleranciaSegundos) return { valida: false, motivo: 'timestamp' };

  const esperada = crypto.createHmac('sha256', secreto)
    .update(Buffer.concat([Buffer.from(`${marca}.`), cuerpoCrudo]))
    .digest();

  const coincide = candidatas.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
    // timingSafeEqual: no revela por tiempo cuántos bytes de la firma acertó el atacante.
    return crypto.timingSafeEqual(Buffer.from(hex, 'hex'), esperada);
  });
  return coincide ? { valida: true } : { valida: false, motivo: 'firma' };
}

/** Valida la estructura del evento YA autenticado. Devuelve mensaje de error o null. */
function validarEventoPago(e) {
  if (typeof e.id !== 'string' || !e.id || e.id.length > MAX_ID_EVENTO) return 'id del evento inválido';
  if (typeof e.type !== 'string') return 'type inválido';
  if (e.type !== TIPO_PAGO_EXITOSO) return null; // otros tipos se ignoran, no son error
  const d = e.data;
  if (!d || typeof d !== 'object') return 'data es obligatoria';
  if (!esIdValido(d.id_pedido)) return 'data.id_pedido debe ser un entero positivo';
  if (!esIdValido(d.id_mesa)) return 'data.id_mesa debe ser un entero positivo';
  if (typeof d.monto !== 'number' || !Number.isFinite(d.monto) || d.monto <= 0) return 'data.monto debe ser un número positivo';
  if (typeof d.referencia_externa !== 'string' || !d.referencia_externa || d.referencia_externa.length > 100) {
    return 'data.referencia_externa inválida';
  }
  return null;
}

const rutasPagos = {
  'POST /pagos/intencion': crearIntencionPago,

  'POST /pagos/webhook': async (req, res, ctx) => {
    // Sin secreto no hay forma de autenticar al proveedor: se cierra el
    // endpoint en vez de aceptar pagos "sin firma".
    if (!ctx.config.pagosWebhookSecret) {
      throw new ErrorHttp(503, 'NO_CONFIGURADO', 'PAYMENT_WEBHOOK_SECRET no está configurado');
    }

    // 1) Cuerpo crudo, sin parsear.
    const crudo = await leerCuerpoCrudo(req);

    // 2) Firma. Nada de lo que sigue ocurre si esto falla.
    const firma = verificarFirmaWebhook(crudo, req.headers['x-signature'], ctx.config.pagosWebhookSecret, {
      toleranciaSegundos: ctx.config.pagosToleranciaSegundos,
    });
    if (!firma.valida) {
      // El motivo va al log, no al cliente: no le damos pistas a quien sondea.
      console.warn(`[pagos] webhook rechazado (${firma.motivo}) desde ${req.socket.remoteAddress}`);
      throw new ErrorHttp(400, 'FIRMA_INVALIDA', 'Firma inválida');
    }

    // 3) Recién ahora se interpreta el contenido.
    const evento = parsearJson(crudo);
    const error = validarEventoPago(evento);
    if (error) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', error);
    if (evento.type !== TIPO_PAGO_EXITOSO) {
      // 200 para que el proveedor no reintente eventos que no nos interesan.
      return enviarJson(res, 200, { ok: true, ignorado: true });
    }

    // 4) Idempotencia: los proveedores reintentan (a veces durante días) y
    // pueden entregar el mismo evento dos veces.
    const clave = `pago:${evento.id}`;
    if (!(await ctx.registroPagos.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });

    const { data } = evento;
    ctx.io.to(SALA_ADMIN).to(salaMesa(data.id_mesa)).emit('payment:confirmed', {
      eventId: evento.id,
      id_pedido: data.id_pedido,
      id_mesa: data.id_mesa,
      monto: data.monto,
      referencia_externa: data.referencia_externa,
      emitidoEn: new Date().toISOString(),
    });
    enviarJson(res, 200, { ok: true, duplicado: false });
  },
};

module.exports = {
  verificarFirmaWebhook, validarEventoPago, rutasPagos, TIPO_PAGO_EXITOSO, generarReferencia, LIMITE_INTENCIONES,
};
