import { urlsServidor } from '../utils/urlsServidor';

export const API_URL = urlsServidor().api;

let manejadorSesionInvalida = null;

export function setManejadorSesionInvalida(fn) {
  manejadorSesionInvalida = typeof fn === 'function' ? fn : null;
}

export class ErrorApi extends Error {
  constructor({
    status = 0,
    motivo = null,
    mensaje = 'Ocurrió un error, intenta de nuevo',
    campo = null,
    retryAfter = null,
  } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.motivo = motivo;
    this.mensaje = mensaje;
    this.campo = campo;
    this.retryAfter = retryAfter;
  }
}

export async function pedirJson(ruta, { method = 'GET', body, token } = {}) {
  const rutaNormalizada = ruta.startsWith('/') ? ruta : `/${ruta}`;
  const url = `${API_URL}${rutaNormalizada}`;

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

  // Extraer cabecera Retry-After si el servidor limitó la tasa (429)
  const retryHeader = respuesta.headers?.get
    ? (respuesta.headers.get('retry-after') || respuesta.headers.get('Retry-After'))
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
    const campo = data?.campo || null;

    if (token && respuesta.status === 401 && manejadorSesionInvalida) {
      manejadorSesionInvalida(motivo || 'sesion_invalida', mensaje);
    }

    throw new ErrorApi({
      status: respuesta.status,
      motivo,
      mensaje,
      campo,
      retryAfter,
    });
  }

  return data;
}

export default {
  API_URL,
  ErrorApi,
  pedirJson,
  setManejadorSesionInvalida,
};
