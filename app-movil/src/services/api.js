/**
 * Cliente HTTP base para la API REST de SmartDining.
 * En etapa 1 no envía token; preparado para Authorization Bearer cuando llegue D-19.
 */

export function obtenerApiUrlBase() {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\/+$/, '').replace(/\/api$/, '');
}

export function tieneApiUrlConfigurada() {
  return obtenerApiUrlBase().length > 0;
}

export class ErrorApi extends Error {
  constructor({
    status = 0,
    motivo = null,
    mensaje = 'Ocurrió un error, intenta de nuevo',
    campo = null,
    retryAfter = null,
    faltantes = null,
  } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.motivo = motivo;
    this.mensaje = mensaje;
    this.campo = campo;
    this.retryAfter = retryAfter;
    this.faltantes = Array.isArray(faltantes) ? faltantes : null;
  }
}

export async function pedirJson(ruta, { method = 'GET', body, token } = {}) {
  const base = obtenerApiUrlBase();
  if (!base) {
    throw new ErrorApi({
      status: 0,
      motivo: 'sin_api_url',
      mensaje: 'EXPO_PUBLIC_API_URL no está configurada.',
    });
  }

  const rutaNormalizada = ruta.startsWith('/') ? ruta : `/${ruta}`;
  const url = `${base}${rutaNormalizada}`;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ErrorApi({
      status: 0,
      motivo: 'sin_conexion',
      mensaje: 'Sin conexión. Revisa tu internet e intenta de nuevo.',
    });
  }

  const retryHeader = respuesta.headers?.get
    ? respuesta.headers.get('retry-after') || respuesta.headers.get('Retry-After')
    : null;
  const retryParsed = retryHeader ? parseInt(retryHeader, 10) : null;
  const retryAfter =
    Number.isFinite(retryParsed) && retryParsed > 0
      ? retryParsed
      : respuesta.status === 429
        ? 60
        : null;

  const data = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const motivo = data?.motivo || null;
    let mensaje = data?.error || 'Ocurrió un error, intenta de nuevo';
    if (respuesta.status === 429 && !data?.error) {
      mensaje = 'Demasiados intentos. Espera un minuto e inténtalo de nuevo';
    }

    throw new ErrorApi({
      status: respuesta.status,
      motivo,
      mensaje,
      campo: data?.campo || null,
      retryAfter,
      faltantes: Array.isArray(data?.faltantes) ? data.faltantes : null,
    });
  }

  return data;
}
