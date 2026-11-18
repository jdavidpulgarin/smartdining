import { API_URL } from '../config.js';

export class ErrorApi extends Error {
  constructor({
    status = 0,
    codigo = null,
    detalle = null,
    mensaje = 'Ocurrió un error al cargar la información.',
    motivo = null,
  } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = codigo ?? null;
    this.detalle = detalle ?? null;
    this.mensaje = mensaje;
    this.motivo = motivo ?? null;
  }
}

export async function pedirJson(ruta, { fetchFn = fetch, signal } = {}) {
  const rutaNormalizada = ruta.startsWith('/') ? ruta : `/${ruta}`;
  const url = `${API_URL}${rutaNormalizada}`;

  let respuesta;
  try {
    respuesta = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal,
    });
  } catch (error) {
    throw new ErrorApi({
      status: 0,
      motivo: error?.name === 'AbortError' ? 'timeout' : 'sin_conexion',
      mensaje:
        error?.name === 'AbortError'
          ? 'Tiempo de espera agotado.'
          : 'Sin conexión. Revisa tu internet e intenta de nuevo.',
      detalle: error?.message,
    });
  }

  let data = null;
  const contentType = respuesta.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await respuesta.json();
    } catch {
      data = null;
    }
  }

  if (!respuesta.ok) {
    const mensaje = typeof data?.mensaje === 'string'
      ? data.mensaje
      : typeof data?.error === 'string'
        ? data.error
        : `Error ${respuesta.status}: No se pudo completar la solicitud.`;

    throw new ErrorApi({
      status: respuesta.status,
      codigo: data?.codigo ?? null,
      detalle: data?.detalle ?? null,
      motivo: data?.motivo ?? null,
      mensaje,
    });
  }

  return data;
}
