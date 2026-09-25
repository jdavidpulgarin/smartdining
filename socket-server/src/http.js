const crypto = require('crypto');

const LIMITE_CUERPO = 100 * 1024; // 100 KB: de sobra para un pedido, corta abusos

class ErrorHttp extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

function enviarJson(res, status, cuerpo) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

/**
 * Lee el cuerpo COMPLETO como Buffer, sin parsear. Se entrega crudo porque la
 * firma de un webhook se calcula sobre los bytes exactos que envió el
 * proveedor: si se parsea y se vuelve a serializar, cambian espacios o el
 * orden de claves y la firma dejaría de coincidir (o, peor, se verificaría
 * sobre datos distintos a los que se procesan).
 */
function leerCuerpoCrudo(req, limite = LIMITE_CUERPO) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let total = 0;
    req.on('data', (t) => {
      total += t.length;
      if (total > limite) {
        reject(new ErrorHttp(413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo excede el límite permitido'));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

function parsearJson(buffer) {
  try {
    const dato = JSON.parse(buffer.toString('utf8') || '{}');
    if (dato === null || typeof dato !== 'object' || Array.isArray(dato)) throw new Error();
    return dato;
  } catch {
    throw new ErrorHttp(400, 'JSON_INVALIDO', 'El cuerpo debe ser un objeto JSON válido');
  }
}

/** Comparación en tiempo constante: no filtra por tiempo cuántos caracteres acertó el atacante. */
function igualesSeguro(a, b) {
  // Se comparan hashes para que ambos buffers tengan siempre la misma longitud
  // (timingSafeEqual lanza si difieren, y la longitud también sería una fuga).
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Exige la clave compartida con el backend en la cabecera x-internal-key. */
function exigirClaveInterna(req, config) {
  // Sin clave configurada el endpoint queda cerrado: es más seguro que dejarlo abierto.
  if (!config.internalApiKey) {
    throw new ErrorHttp(503, 'NO_CONFIGURADO', 'INTERNAL_API_KEY no está configurada');
  }
  const recibida = req.headers['x-internal-key'];
  if (typeof recibida !== 'string' || !igualesSeguro(recibida, config.internalApiKey)) {
    throw new ErrorHttp(401, 'NO_AUTORIZADO', 'Clave interna inválida');
  }
}

/**
 * Router mínimo. `rutas` mapea "METODO /ruta" -> async (req, res, ctx).
 * Cualquier ErrorHttp lanzado se traduce a su respuesta; lo demás es un 500
 * genérico (el detalle solo va al log, no al cliente).
 */
function crearRouter(rutas, ctx) {
  return async (req, res) => {
    const ruta = req.url.split('?')[0];
    const handler = rutas[`${req.method} ${ruta}`];
    if (!handler) return enviarJson(res, 404, { error: 'Ruta no encontrada' });
    try {
      await handler(req, res, ctx);
    } catch (err) {
      if (err instanceof ErrorHttp) {
        return enviarJson(res, err.status, { ok: false, codigo: err.codigo, mensaje: err.message });
      }
      console.error('[http] error inesperado:', err);
      enviarJson(res, 500, { ok: false, codigo: 'ERROR_INTERNO', mensaje: 'Error inesperado del servidor' });
    }
  };
}

/** Convierte un ack ({ok:false,...}) en la respuesta HTTP equivalente. */
function enviarAck(res, ack) {
  if (ack.ok) return enviarJson(res, 200, ack);
  const status = ack.codigo === 'PAYLOAD_INVALIDO' ? 400 : ack.codigo === 'NO_AUTORIZADO' ? 403 : 500;
  return enviarJson(res, status, ack);
}

module.exports = {
  ErrorHttp, enviarJson, enviarAck, leerCuerpoCrudo, parsearJson, igualesSeguro, exigirClaveInterna, crearRouter,
};
