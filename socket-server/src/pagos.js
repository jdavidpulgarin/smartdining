const crypto = require('crypto');
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

// Una intención ya resuelta se conserva 7 días para reconocer reintentos tardíos.
const TTL_INTENCION_RESUELTA_SEG = 7 * 24 * 60 * 60;
const ESTADOS_FALLIDOS = { DECLINED: 'rechazada', ERROR: 'error', VOIDED: 'anulada' };

/**
 * Capa 5: aunque la firma sea válida, se cree a la API de la pasarela, no al
 * evento, y se compara contra lo que ESTE servidor esperaba cobrar.
 * Devuelve null si todo coincide o el motivo de la discrepancia.
 */
function compararTransaccion({ evento, tx, intencion }) {
  if (!tx) return 'transaccion_inexistente';
  if (tx.id !== evento.id_transaccion) return 'transaccion_distinta';
  if (tx.estado !== 'APPROVED') return 'estado_no_aprobado';
  if (tx.referencia !== evento.referencia) return 'referencia_distinta';
  if (!intencion) return 'referencia_desconocida';
  if (intencion.estado !== 'pendiente') return 'intencion_no_pendiente';
  // EXACTAMENTE igual: ni un centavo de menos (pago parcial con la firma de
  // otra intención) ni de más.
  if (tx.monto_centavos !== intencion.monto_centavos) return 'monto_distinto';
  if (tx.moneda !== 'COP') return 'moneda_distinta';
  return null;
}

/** Un pago rechazado o con error libera al comensal para que pueda reintentar. */
async function registrarFallo(ctx, evento) {
  const intencion = await ctx.almacenPagos.obtener(evento.referencia);
  if (!intencion || intencion.estado !== 'pendiente') return;
  await ctx.almacenPagos.actualizarEstado(evento.referencia, ESTADOS_FALLIDOS[evento.estado] || 'fallida', TTL_INTENCION_RESUELTA_SEG);
  await ctx.almacenPagos.liberarPendiente(intencion.id_mesa, intencion.comensal);
}

/**
 * POST /pagos/webhook — eventos de la pasarela (capa 4).
 *
 * 1. Cuerpo CRUDO; la pasarela verifica su checksum en tiempo constante y la
 *    antigüedad del evento. Sin eso, nada de lo que dice el evento se usa.
 * 2. Solo interesa transaction.updated; el resto responde 200 para que el
 *    proveedor no reintente.
 * 3. Idempotencia por (transacción, estado): un reintento responde 200 sin
 *    efectos.
 */
async function recibirEventoPasarela(req, res, ctx) {
  if (!ctx.pasarela) throw new ErrorHttp(503, 'NO_CONFIGURADO', 'Los pagos no están configurados');
  const crudo = await leerCuerpoCrudo(req);
  const v = ctx.pasarela.verificarEvento(crudo, req.headers);
  if (!v.valido) {
    // El motivo va al log, no al cliente: no le damos pistas a quien sondea.
    console.warn(`[pagos] webhook rechazado (${v.motivo}) desde ${req.socket.remoteAddress}`);
    throw new ErrorHttp(400, 'FIRMA_INVALIDA', 'Firma inválida');
  }
  const { evento } = v;
  if (evento.tipo !== 'transaction.updated') return enviarJson(res, 200, { ok: true, ignorado: true });

  const clave = `pago:${ctx.pasarela.nombre}:${evento.id_transaccion}:${evento.estado}`;
  if (!(await ctx.registroPagos.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });

  try {
    if (evento.estado !== 'APPROVED') {
      // DECLINED, ERROR, VOIDED: nada que cobrar ni que anunciar como pago.
      if (ESTADOS_FALLIDOS[evento.estado]) await registrarFallo(ctx, evento);
      return enviarJson(res, 200, { ok: true, duplicado: false, registrado: false, estado: evento.estado });
    }

    const tx = await ctx.pasarela.consultarTransaccion(evento.id_transaccion);
    const intencion = await ctx.almacenPagos.obtener(evento.referencia);
    const problema = compararTransaccion({ evento, tx, intencion });
    if (problema) {
      console.warn(`[pagos] transacción ${evento.id_transaccion} no coincide: ${problema}`);
      // 200: reintentar no lo arreglaría (la pasarela devolvería lo mismo).
      return enviarJson(res, 200, { ok: true, duplicado: false, registrado: false });
    }

    // Registro en el backend: siguiente paso. Hasta entonces, nada se emite.
    return enviarJson(res, 200, { ok: true, duplicado: false, registrado: false, verificado: true });
  } catch (err) {
    // No se pudo terminar (pasarela o backend sin respuesta): se libera la
    // marca de idempotencia y se responde 5xx para que la pasarela reintente.
    await ctx.registroPagos.liberar(clave);
    console.error(`[pagos] transacción ${evento.id_transaccion}: ${err.codigo || err.message}; se pide reintento`);
    throw new ErrorHttp(503, 'ERROR_INTERNO', 'No se pudo procesar el evento; reintenta');
  }
}

const rutasPagos = {
  'POST /pagos/intencion': crearIntencionPago,

  'POST /pagos/webhook': recibirEventoPasarela,
};

module.exports = {
  rutasPagos, generarReferencia, compararTransaccion, LIMITE_INTENCIONES,
};
