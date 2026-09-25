const crypto = require('crypto');
const { ROLES_PERSONAL, verificarJwt } = require('./auth');
const { esIdValido } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

const VERSION = 'v1';
const TTL_MIN_MINUTOS = 1;
const TTL_MAX_MINUTOS = 24 * 60; // un QR que vive días dejaría de ser "de la sesión de mesa"
const ROLES_GENERAN_QR = ['admin', 'mesero', 'cajero'];

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Servicio de tokens QR.
 *
 * Modelo (decidido con el equipo): el token es REUTILIZABLE durante la sesión
 * de mesa. Cualquier comensal puede escanearlo las veces que quiera hasta que
 * (a) llegue su expiración explícita o (b) la mesa se libere al pagar y el
 * backend avise con revocarMesa(). No es de un solo uso porque en una mesa se
 * sientan varias personas y todas escanean el mismo QR impreso.
 *
 * Formato: v1.<payload base64url>.<firma HMAC-SHA256 base64url>
 * Payload: { m: id_mesa, iat: emitido (ms), exp: expira (ms), sid: id aleatorio }
 *
 * Es un token firmado (no cifrado): no lleva secretos, y la firma impide que
 * alguien fabrique uno para otra mesa o alargue su expiración.
 */
function crearServicioQr({ secreto, ttlMinutosPorDefecto = 360, ahora = Date.now }) {
  // Última liberación por mesa (ms). Un token emitido ANTES de ese instante
  // ya no vale, aunque no haya expirado ni tenga la firma alterada.
  const revocadoDesde = new Map();

  const firmar = (contenido) => crypto.createHmac('sha256', secreto).update(contenido).digest();

  function generar(idMesa, ttlMinutos = ttlMinutosPorDefecto) {
    if (!esIdValido(idMesa)) throw new RangeError('id_mesa inválido');
    if (!Number.isFinite(ttlMinutos) || ttlMinutos < TTL_MIN_MINUTOS || ttlMinutos > TTL_MAX_MINUTOS) {
      throw new RangeError(`ttl_minutos debe estar entre ${TTL_MIN_MINUTOS} y ${TTL_MAX_MINUTOS}`);
    }
    const iat = ahora();
    const exp = iat + ttlMinutos * 60 * 1000;
    // El sid (aleatorio) hace único cada token aunque se generen dos para la
    // misma mesa en el mismo milisegundo, y permitiría rastrearlos en logs.
    const payload = { m: idMesa, iat, exp, sid: crypto.randomBytes(12).toString('base64url') };
    const cuerpo = `${VERSION}.${b64(JSON.stringify(payload))}`;
    return { token: `${cuerpo}.${b64(firmar(cuerpo))}`, id_mesa: idMesa, emitido_en: iat, expira_en: exp };
  }

  /** Valida en el servidor: formato, firma, expiración y revocación. */
  function validar(token) {
    if (typeof token !== 'string' || token.length > 512) return { valido: false, motivo: 'formato' };
    const partes = token.split('.');
    if (partes.length !== 3 || partes[0] !== VERSION) return { valido: false, motivo: 'formato' };

    // Primero la firma: no se parsea nada del payload hasta saber que lo
    // firmamos nosotros.
    const esperada = firmar(`${partes[0]}.${partes[1]}`);
    const recibida = Buffer.from(partes[2], 'base64url');
    if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
      return { valido: false, motivo: 'firma' };
    }

    let p;
    try {
      p = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    } catch {
      return { valido: false, motivo: 'formato' };
    }
    if (!esIdValido(p.m) || !Number.isFinite(p.iat) || !Number.isFinite(p.exp)) {
      return { valido: false, motivo: 'formato' };
    }
    if (ahora() >= p.exp) return { valido: false, motivo: 'expirado' };
    if (p.iat < (revocadoDesde.get(p.m) || 0)) return { valido: false, motivo: 'revocado' };
    return { valido: true, id_mesa: p.m, expira_en: p.exp };
  }

  /** La mesa se liberó: invalida todos los QR emitidos hasta este momento. */
  function revocarMesa(idMesa) {
    // +1 ms para que también quede fuera un token emitido en este mismo
    // milisegundo; el QR nuevo de la mesa siguiente se genera después.
    revocadoDesde.set(idMesa, ahora() + 1);
  }

  return { generar, validar, revocarMesa };
}

/** Deriva una clave de firma propia si no se configuró QR_SECRET. */
function derivarSecretoQr(config) {
  if (config.qrSecret) return config.qrSecret;
  // Separación de claves: aunque falte QR_SECRET, la firma del QR NO usa el
  // JWT_SECRET directamente, así un token QR nunca sirve como JWT ni al revés.
  return crypto.createHmac('sha256', config.jwtSecret).update('smartdining:qr:v1').digest('hex');
}

const rutasQr = {
  'POST /qr/generar': async (req, res, ctx) => {
    const auth = req.headers.authorization || '';
    const identidad = auth.startsWith('Bearer ') ? verificarJwt(auth.slice(7), ctx.config.jwtSecret) : null;
    if (!identidad) throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Se requiere un JWT válido');
    if (!ROLES_GENERAN_QR.includes(identidad.rol) || !ROLES_PERSONAL.includes(identidad.rol)) {
      throw new ErrorHttp(403, 'NO_AUTORIZADO', 'Tu rol no puede generar QR');
    }
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    try {
      const ttl = cuerpo.ttl_minutos === undefined ? undefined : Number(cuerpo.ttl_minutos);
      const qr = ctx.qr.generar(cuerpo.id_mesa, ttl);
      enviarJson(res, 201, qr);
    } catch (err) {
      if (err instanceof RangeError) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', err.message);
      throw err;
    }
  },

  // Público a propósito: el comensal aún no tiene sesión cuando escanea.
  'POST /qr/validar': async (req, res, ctx) => {
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    const resultado = ctx.qr.validar(cuerpo.token);
    enviarJson(res, resultado.valido ? 200 : 401, resultado);
  },

  'POST /internal/mesa-liberada': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    if (!esIdValido(cuerpo.id_mesa)) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'id_mesa debe ser un entero positivo');
    ctx.qr.revocarMesa(cuerpo.id_mesa);
    enviarJson(res, 200, { ok: true });
  },
};

module.exports = { crearServicioQr, derivarSecretoQr, rutasQr, TTL_MAX_MINUTOS };
