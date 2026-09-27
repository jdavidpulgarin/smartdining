const crypto = require('crypto');
const { esIdValido, salaMesa, SALA_ADMIN } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson,
} = require('./http');

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
    if (ctx.registroPagos.obtener(clave)) return enviarJson(res, 200, { ok: true, duplicado: true });
    ctx.registroPagos.guardar(clave, true);

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

module.exports = { verificarFirmaWebhook, validarEventoPago, rutasPagos, TIPO_PAGO_EXITOSO };
