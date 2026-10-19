const crypto = require('crypto');
const { salaMesa, SALA_ADMIN, esIdValido } = require('./salas');
const { log } = require('./log');
const { exito, fallo } = require('./ack');
const {
  ErrorHttp, enviarJson, enviarAck, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');
const {
  verificarJwt, esComensalSinAlias, ROL_COMENSAL, MAX_ALIAS,
} = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const { calcularMonto, validarCuenta, MODOS } = require('./cuenta');

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
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const identidad = token ? verificarJwt(token, ctx.config.jwtSecret) : null;
  if (!identidad) {
    if (token && esComensalSinAlias(token, ctx.config.jwtSecret)) {
      throw new ErrorHttp(401, 'TOKEN_INVALIDO', 'Sesión antigua sin nombre: escanea el QR de nuevo');
    }
    throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Se requiere un JWT válido');
  }
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
  // Quien paga es el alias FIRMADO en el JWT. `comensal` en el cuerpo es
  // opcional; si viene distinto, alguien intenta pagar (o ver "lo propio")
  // como otro comensal.
  const { comensal } = identidad;
  if (cuerpo.comensal !== undefined && cuerpo.comensal !== comensal) {
    throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Solo puedes pagar con tu propio nombre');
  }
  // El modo "igual" reparte entre las personas sentadas ahora en la mesa.
  const presencia = await ctx.presencia.calcular(idMesa);

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

  // La cuenta se consulta SIEMPRE, también si ya hay una intención pendiente:
  // solo así se sabe si su monto sigue valiendo. Sin backend no se cobra con
  // datos viejos (503).
  let cuenta;
  try {
    cuenta = await ctx.backend.get(`/api/mesas/${idMesa}/cuenta/interno`);
  } catch (err) {
    log.error('pagos: no se pudo consultar la cuenta', { id_mesa: idMesa, codigo: err.codigo || err.message });
    throw new ErrorHttp(503, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }
  if (!cuenta.ok) {
    log.error('pagos: el backend respondió error a la cuenta', { id_mesa: idMesa, status: cuenta.status });
    throw new ErrorHttp(502, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }
  const errorCuenta = validarCuenta(cuenta.cuerpo, idMesa);
  if (errorCuenta) {
    log.error('pagos: cuenta inválida del backend', { id_mesa: idMesa, motivo: errorCuenta });
    throw new ErrorHttp(502, 'ERROR_INTERNO', 'No se pudo consultar la cuenta; intenta de nuevo');
  }

  const monto = calcularMonto({
    modo: cuerpo.modo, cuenta: cuenta.cuerpo, comensal, presentes: presencia.total,
  });
  if (monto.error) throw new ErrorHttp(409, 'SIN_SALDO', 'No hay saldo por pagar en ese modo');

  // Una sola intención pendiente por comensal. Se reutiliza solo si es del
  // mismo modo y por el mismo monto recalculado; si no (cambió de modo, llegó
  // un pedido o cambió la presencia), se reemplaza por una nueva.
  const pendiente = await ctx.almacenPagos.obtenerPendiente(idMesa, comensal);
  if (pendiente) {
    const vigente = await ctx.almacenPagos.obtener(pendiente);
    if (vigente && vigente.estado === 'pendiente'
      && vigente.modo === cuerpo.modo && vigente.monto_centavos === monto.montoCentavos) {
      return responder({ ...vigente, referencia: pendiente }, 200);
    }
  }

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
  // Primero la intención y luego la marca de pendiente (SET NX, o cambio
  // atómico si reemplaza a otra): si otra petición del mismo comensal ganó la
  // carrera, se descarta la nuestra.
  await ctx.almacenPagos.guardarIntencion(referencia, intencion, ttlSeg);
  const ganadora = pendiente
    ? await ctx.almacenPagos.reemplazarPendiente(idMesa, comensal, pendiente, referencia, ttlSeg)
    : await ctx.almacenPagos.reservarPendiente(idMesa, comensal, referencia, ttlSeg);
  if (ganadora !== referencia) {
    await ctx.almacenPagos.borrarIntencion(referencia);
    const otra = await ctx.almacenPagos.obtener(ganadora);
    if (otra) return responder({ ...otra, referencia: ganadora }, 200);
  }
  // La vieja no se borra: si ya se pagó en otra pestaña, su webhook todavía
  // se registra (ver compararTransaccion). Se guarda 7 días, como una resuelta.
  if (pendiente) await ctx.almacenPagos.marcarReemplazada(pendiente, referencia, TTL_INTENCION_RESUELTA_SEG);
  return responder({ ...intencion, referencia }, 201);
}

// Una intención ya resuelta (o reemplazada) se conserva 7 días para reconocer
// reintentos tardíos.
const TTL_INTENCION_RESUELTA_SEG = 7 * 24 * 60 * 60;

// Estados de una intención que el webhook acepta como "se esperaba este cobro".
// Una reemplazada sigue valiendo: el comensal pudo pagarla en otra pestaña
// antes de pedir la nueva, y ese dinero ya salió de su cuenta.
const ESTADOS_COBRABLES = ['pendiente', 'reemplazada'];
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
  if (!ESTADOS_COBRABLES.includes(intencion.estado)) return 'intencion_no_pendiente';
  // EXACTAMENTE igual: ni un centavo de menos (pago parcial con la firma de
  // otra intención) ni de más.
  if (tx.monto_centavos !== intencion.monto_centavos) return 'monto_distinto';
  if (tx.moneda !== 'COP') return 'moneda_distinta';
  return null;
}

const aPesos = (centavos) => centavos / 100;

/**
 * ÚNICO lugar que arma y emite payment:confirmed (Wompi y cobros de caja).
 * Así el panel y la mesa reciben siempre el mismo payload, venga de donde venga.
 */
function emitirPagoConfirmado(io, {
  eventId, idMesa, comensal, montoCentavos, saldoCentavos, referencia,
}) {
  io.to(SALA_ADMIN).to(salaMesa(idMesa)).emit('payment:confirmed', {
    eventId,
    id_mesa: idMesa,
    comensal: comensal ?? null,
    monto: aPesos(montoCentavos),
    saldo_restante: aPesos(saldoCentavos),
    monto_centavos: montoCentavos,
    saldo_restante_centavos: saldoCentavos,
    referencia_externa: referencia ?? null,
    emitidoEn: new Date().toISOString(),
  });
}

/**
 * Capa 6: el pago se registra en el backend (la base es la fuente de verdad)
 * ANTES de anunciarlo. Contrato (pendiente: Daniel):
 *   POST /api/transacciones/internal  (x-internal-key)
 *   → 200/201 { ok, duplicado, saldo_restante_centavos, mesa_liberada }
 * idempotente por referencia_externa: si el webhook se reintenta, el backend
 * responde el mismo resultado sin registrar dos veces.
 *
 * Devuelve { registrado: true, saldo } o { rechazado: status } (4xx: el
 * backend no acepta este pago). Lanza si el backend no respondió o dio 5xx:
 * quien llama responde 503 para que la pasarela reintente.
 */
async function registrarEnBackend(ctx, { evento, tx, intencion }) {
  const r = await ctx.backend.post('/api/transacciones/internal', {
    referencia_externa: evento.referencia,
    id_transaccion_pasarela: tx.id,
    pasarela: ctx.pasarela.nombre,
    id_mesa: intencion.id_mesa,
    comensal: intencion.comensal,
    modo: intencion.modo,
    monto_centavos: tx.monto_centavos,
    moneda: tx.moneda,
    metodo_pago: 'online',
  });
  if (r.status >= 500) throw Object.assign(new Error(`el backend respondió ${r.status}`), { codigo: 'BACKEND_ERROR' });
  if (!r.ok) return { rechazado: r.status };
  const saldo = r.cuerpo && r.cuerpo.saldo_restante_centavos;
  if (!Number.isSafeInteger(saldo) || saldo < 0) {
    // Registrado pero con una respuesta que no entendemos: no se inventa un
    // saldo. Se reintenta (el backend es idempotente por referencia_externa).
    throw Object.assign(new Error('respuesta del backend sin saldo_restante_centavos'), { codigo: 'BACKEND_ERROR' });
  }
  return { registrado: true, saldo };
}

/**
 * Un pago que no cuadra (monto distinto, referencia desconocida, transacción
 * que la API no confirma o que el backend rechaza) NO se registra como pago:
 * se guarda como intento fallido (vía backend, tabla intentos_pago_fallidos)
 * y se avisa al panel para que el personal lo revise.
 *
 * Contrato (pendiente: Daniel): POST /api/pagos/intentos-fallidos/interno
 * (x-internal-key), idempotente por (id_transaccion_pasarela, motivo).
 * Si el backend no lo puede guardar, se lanza: el webhook responde 503 y la
 * pasarela reintenta (no se pierde la evidencia).
 */
async function alertarPago(ctx, { evento, tx, intencion, motivo }) {
  const r = await ctx.backend.post('/api/pagos/intentos-fallidos/interno', {
    referencia_externa: evento.referencia,
    id_transaccion_pasarela: evento.id_transaccion,
    pasarela: ctx.pasarela.nombre,
    id_mesa: intencion ? intencion.id_mesa : null,
    motivo,
    monto_centavos: tx ? tx.monto_centavos : evento.monto_centavos,
    monto_esperado_centavos: intencion ? intencion.monto_centavos : null,
    moneda: tx ? tx.moneda : evento.moneda,
    metodo_pago: 'online',
  });
  if (r.status >= 500) throw Object.assign(new Error(`el backend respondió ${r.status}`), { codigo: 'BACKEND_ERROR' });
  // Al panel: qué pasó y dónde, sin datos del pagador.
  ctx.io.to(SALA_ADMIN).emit('pago:alerta', {
    eventId: `${evento.id_transaccion}:${motivo}`,
    id_mesa: intencion ? intencion.id_mesa : null,
    referencia_externa: evento.referencia,
    id_transaccion_pasarela: evento.id_transaccion,
    motivo,
    emitidoEn: new Date().toISOString(),
  });
}

/** Un pago rechazado o con error libera al comensal para que pueda reintentar. */
async function registrarFallo(ctx, evento) {
  const intencion = await ctx.almacenPagos.obtener(evento.referencia);
  if (!intencion || !ESTADOS_COBRABLES.includes(intencion.estado)) return;
  await ctx.almacenPagos.actualizarEstado(evento.referencia, ESTADOS_FALLIDOS[evento.estado] || 'fallida', TTL_INTENCION_RESUELTA_SEG);
  // Si era una reemplazada, la marca apunta a la nueva y no se toca.
  await ctx.almacenPagos.liberarPendiente(intencion.id_mesa, intencion.comensal, evento.referencia);
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
    log.warn('pagos: webhook rechazado', { motivo: v.motivo, ip: ctx.ipCliente(req) });
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
      log.warn('pagos: la transacción no coincide con lo esperado', { id_transaccion: evento.id_transaccion, motivo: problema });
      await alertarPago(ctx, {
        evento, tx, intencion, motivo: problema,
      });
      // 200: reintentar no lo arreglaría (la pasarela devolvería lo mismo).
      return enviarJson(res, 200, { ok: true, duplicado: false, registrado: false });
    }

    const registro = await registrarEnBackend(ctx, { evento, tx, intencion });
    if (registro.rechazado) {
      log.warn('pagos: el backend rechazó el registro', { id_transaccion: tx.id, status: registro.rechazado });
      await alertarPago(ctx, {
        evento, tx, intencion, motivo: `backend_rechazo_${registro.rechazado}`,
      });
      return enviarJson(res, 200, { ok: true, duplicado: false, registrado: false });
    }

    await ctx.almacenPagos.actualizarEstado(evento.referencia, 'pagada', TTL_INTENCION_RESUELTA_SEG);
    // Solo libera la marca si apunta a ESTA referencia: si se pagó una
    // reemplazada, la intención nueva sigue pendiente (y, como el saldo
    // cambió, se reemplazará en la próxima petición).
    await ctx.almacenPagos.liberarPendiente(intencion.id_mesa, intencion.comensal, evento.referencia);

    // Recién ahora, con el pago guardado en la base, se anuncia. Si el saldo
    // llegó a 0, el backend libera la mesa y avisa por /internal/mesa-liberada.
    emitirPagoConfirmado(ctx.io, {
      eventId: tx.id,
      idMesa: intencion.id_mesa,
      comensal: intencion.comensal,
      montoCentavos: tx.monto_centavos,
      saldoCentavos: registro.saldo,
      referencia: evento.referencia,
    });
    return enviarJson(res, 200, { ok: true, duplicado: false, registrado: true });
  } catch (err) {
    // No se pudo terminar (pasarela o backend sin respuesta): se libera la
    // marca de idempotencia y se responde 5xx para que la pasarela reintente.
    await ctx.registroPagos.liberar(clave);
    log.error('pagos: no se pudo procesar el evento; se pide reintento', { id_transaccion: evento.id_transaccion, codigo: err.codigo || err.message });
    throw new ErrorHttp(503, 'ERROR_INTERNO', 'No se pudo procesar el evento; reintenta');
  }
}

// Tope de 100 millones de pesos (en centavos): ninguna cuenta real lo alcanza
// y corta montos absurdos antes de que lleguen a las pantallas.
const MAX_CENTAVOS = 10_000_000_000;
const MAX_REFERENCIA = 255;

const esCentavos = (v, minimo) => Number.isSafeInteger(v) && v >= minimo && v <= MAX_CENTAVOS;

/** Valida el payload de un cobro de caja. Devuelve mensaje de error o null. */
function validarPagoCaja(p) {
  if (!esIdValido(p.id_mesa)) return 'id_mesa debe ser un entero positivo';
  if (!esCentavos(p.monto_centavos, 1)) return `monto_centavos debe ser un entero entre 1 y ${MAX_CENTAVOS}`;
  if (!esCentavos(p.saldo_restante_centavos, 0)) return `saldo_restante_centavos debe ser un entero entre 0 y ${MAX_CENTAVOS}`;
  if (p.comensal !== undefined && p.comensal !== null
    && (typeof p.comensal !== 'string' || !p.comensal.trim() || p.comensal.length > MAX_ALIAS)) {
    return `comensal debe ser un texto de 1 a ${MAX_ALIAS} caracteres o null`;
  }
  if (p.referencia_externa !== undefined && p.referencia_externa !== null
    && (typeof p.referencia_externa !== 'string' || !p.referencia_externa.length || p.referencia_externa.length > MAX_REFERENCIA)) {
    return `referencia_externa debe ser un texto de 1 a ${MAX_REFERENCIA} caracteres o null`;
  }
  if (p.id_transaccion !== undefined && p.id_transaccion !== null && !esIdValido(p.id_transaccion)) {
    return 'id_transaccion debe ser un entero positivo';
  }
  return null;
}

/**
 * Cobro de caja (efectivo, datáfono o abono parcial) ya guardado por el
 * backend: se anuncia con el mismo payment:confirmed que un pago de Wompi.
 * Solo se reenvían los campos conocidos; el resto del cuerpo se descarta.
 */
async function difundirPagoConfirmado(ctx, p) {
  if (!esEventIdValido(p.eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
  const errorPayload = validarPagoCaja(p);
  if (errorPayload) return fallo('PAYLOAD_INVALIDO', errorPayload, { eventId: p.eventId });

  // Doble guardia, como order:created: por eventId (reintento exacto) y por
  // id_transaccion (el backend reintenta el mismo cobro con otro eventId).
  // Se reservan ambas claves; si cualquiera ya existía, es un duplicado.
  const nuevoEvento = await ctx.registro.reservar(`payment:confirmed:${p.eventId}`);
  const tieneTx = p.id_transaccion !== undefined && p.id_transaccion !== null;
  const nuevaTx = tieneTx ? await ctx.registro.reservar(`payment:confirmed:tx:${p.id_transaccion}`) : true;
  if (!nuevoEvento || !nuevaTx) return exito({ eventId: p.eventId, duplicado: true });

  emitirPagoConfirmado(ctx.io, {
    eventId: p.eventId,
    idMesa: p.id_mesa,
    comensal: p.comensal,
    montoCentavos: p.monto_centavos,
    saldoCentavos: p.saldo_restante_centavos,
    referencia: p.referencia_externa,
  });
  return exito({ eventId: p.eventId, duplicado: false });
}

const rutasPagos = {
  'POST /pagos/intencion': crearIntencionPago,

  'POST /pagos/webhook': recibirEventoPasarela,

  // No depende de la pasarela: la caja cobra aunque Wompi no esté configurado.
  'POST /internal/payment-confirmed': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    enviarAck(res, await difundirPagoConfirmado(ctx, cuerpo));
  },
};

module.exports = {
  rutasPagos, generarReferencia, compararTransaccion, emitirPagoConfirmado, difundirPagoConfirmado, LIMITE_INTENCIONES,
};
