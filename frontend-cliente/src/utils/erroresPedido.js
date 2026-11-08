import { ErrorApi } from '../services/api';

/**
 * Traduce un error producido al intentar crear un pedido (de red, ErrorApi o local)
 * a una estructura de estado legible y manejable por la UI del carrito.
 *
 * @param {Error|ErrorApi|unknown} err
 * @returns {{
 *   tipo: number|string,
 *   mensaje: string,
 *   ayuda?: string,
 *   esConexion?: boolean,
 *   bloquearSegundos?: number,
 *   recargarMenu?: boolean,
 *   ignorar?: boolean
 * }}
 */
export function traducirErrorPedido(err) {
  if (err?.status === 401) {
    // 401 es manejado centralmente por api.js para limpiar la sesión y redirigir
    return {
      tipo: 401,
      ignorar: true,
      mensaje: err?.mensaje || 'Sesión inválida o expirada',
    };
  }

  const esErrorApi = err instanceof ErrorApi || err?.name === 'ErrorApi' || typeof err?.status === 'number';

  if (esErrorApi) {
    if (err.status === 409) {
      return {
        tipo: 409,
        mensaje: err.mensaje || 'El plato o ingrediente seleccionado se agotó.',
        ayuda: 'Revisa tu pedido: algo se agotó en cocina',
        recargarMenu: true,
      };
    }

    if (err.status === 429) {
      const seg = Number(err.retryAfter) > 0 ? Number(err.retryAfter) : 60;
      return {
        tipo: 429,
        mensaje: `Demasiados intentos. Espera ${seg} segundos`,
        bloquearSegundos: seg,
      };
    }

    if (err.status === 0 || err.motivo === 'sin_conexion') {
      return {
        tipo: 0,
        mensaje:
          'No pudimos enviar tu pedido. Revisa tu conexión a internet e intenta de nuevo',
        esConexion: true,
      };
    }

    if (err.status === 400 || err.status === 422) {
      return {
        tipo: err.status,
        mensaje: err.mensaje || 'Revisa los datos del pedido',
      };
    }

    return {
      tipo: err.status,
      mensaje: err.mensaje || 'Ocurrió un error al enviar el pedido',
    };
  }

  return {
    tipo: 'local',
    mensaje: err?.message || 'Error al procesar el pedido',
  };
}

export default {
  traducirErrorPedido,
};
