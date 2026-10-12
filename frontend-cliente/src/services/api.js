export const API_URL = (
  import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
).replace(/\/+$/, '');

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
  } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.motivo = motivo;
    this.mensaje = mensaje;
    this.campo = campo;
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

  const data = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const motivo = data?.motivo || null;
    const mensaje = data?.error || 'Ocurrió un error, intenta de nuevo';
    const campo = data?.campo || null;

    if (token && respuesta.status === 401 && manejadorSesionInvalida) {
      manejadorSesionInvalida(motivo);
    }

    throw new ErrorApi({
      status: respuesta.status,
      motivo,
      mensaje,
      campo,
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
