import { obtenerSesion } from '../utils/sesion';
import { traducirErrorPago } from '../utils/cuenta';
import { ErrorApi } from './api';

/**
 * Servicio para crear intenciones de pago con Wompi (J-08).
 *
 * La intención se solicita a POST {VITE_SOCKET_URL}/pagos/intencion.
 * El cliente NUNCA envía precios, montos, comensal ni id_mesa:
 * el backend y socket-server los calculan directamente del JWT y la base.
 *
 * En modo simulado (DEV + VITE_MODO_SIMULADO):
 * - Si sessionStorage 'smartdining_sim_pago' tiene un código de error ('409', '429', '503', '401', '403'),
 *   lanza ese error para facilitar pruebas visuales.
 * - Si vale 'real', hace la petición real a socket-server (para probar 503 NO_CONFIGURADO).
 * - En caso normal, devuelve un mock de intención válido tras 600 ms.
 *
 * @param {('propio'|'igual'|'total')} modo - Modo de división del pago
 * @param {string} [eventIdReintento] - Opcional, para reintentar el mismo intento
 * @returns {Promise<object>} Intención de pago generada
 */
export async function crearIntencion(modo = 'propio', eventIdReintento = null) {
  const eventId = eventIdReintento || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `ev-${Date.now()}`);

  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    let simPago = null;
    try {
      simPago = sessionStorage.getItem('smartdining_sim_pago');
    } catch {
      // Ignorar error de lectura
    }

    // Si se configuró para llamar de verdad al socket-server
    if (simPago !== 'real') {
      await new Promise((resolve) => setTimeout(resolve, 600));

      if (simPago === '409') {
        throw new ErrorApi({
          status: 409,
          codigo: 'SIN_SALDO',
          mensaje: traducirErrorPago(409, 'SIN_SALDO'),
        });
      }
      if (simPago === '429') {
        throw new ErrorApi({
          status: 429,
          codigo: 'RATE_LIMIT',
          mensaje: traducirErrorPago(429, 'RATE_LIMIT'),
        });
      }
      if (simPago === '503') {
        throw new ErrorApi({
          status: 503,
          codigo: 'NO_CONFIGURADO',
          mensaje: traducirErrorPago(503, 'NO_CONFIGURADO'),
        });
      }
      if (simPago === '401') {
        throw new ErrorApi({
          status: 401,
          codigo: 'TOKEN_INVALIDO',
          mensaje: traducirErrorPago(401, 'TOKEN_INVALIDO'),
        });
      }
      if (simPago === '403') {
        throw new ErrorApi({
          status: 403,
          codigo: 'NO_AUTORIZADO',
          mensaje: traducirErrorPago(403, 'NO_AUTORIZADO'),
        });
      }

      // Simulado exitoso: calcular monto de la cuenta simulada según el comensal y modo
      let montoCentavos;
      try {
        const sesion = obtenerSesion();
        const { obtenerCuentaSimulada } = await import('./cuentaSimulada');
        const cuentaRaw = obtenerCuentaSimulada(sesion?.idMesa, sesion?.comensal);
        if (!cuentaRaw) {
          throw new ErrorApi({
            status: 503,
            codigo: 'ERROR_SIMULACION',
            mensaje: 'Simulación: no hay cuenta para calcular el monto',
          });
        }
        const { normalizarCuenta, montosPorModo } = await import('../utils/cuenta');
        const cuentaNorm = normalizarCuenta(cuentaRaw, sesion?.comensal);
        const montos = montosPorModo(cuentaNorm);
        const estimado = montos[modo];
        if (typeof estimado !== 'number' || !Number.isFinite(estimado)) {
          throw new ErrorApi({
            status: 503,
            codigo: 'ERROR_SIMULACION',
            mensaje: 'Simulación: no hay cuenta para calcular el monto',
          });
        }
        if (estimado <= 0) {
          throw new ErrorApi({
            status: 409,
            codigo: 'SIN_SALDO',
            mensaje: traducirErrorPago(409, 'SIN_SALDO'),
          });
        }
        montoCentavos = Math.round(estimado * 100);
      } catch (err) {
        if (err instanceof ErrorApi) throw err;
        throw new ErrorApi({
          status: 503,
          codigo: 'ERROR_SIMULACION',
          mensaje: 'Simulación: no hay cuenta para calcular el monto',
        });
      }

      const ahora = Date.now();
      return {
        referencia: `SD-5-${ahora}-sim`,
        monto_en_centavos: montoCentavos,
        moneda: 'COP',
        llave_publica: 'pub_test_simulada',
        firma_integridad: 'firma-simulada',
        expira_en: new Date(ahora + 30 * 60 * 1000).toISOString(),
        eventId,
      };
    }
  }

  const sesion = obtenerSesion();
  const token = sesion?.token;
  const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001';

  let res;
  try {
    res = await fetch(`${socketUrl}/pagos/intencion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token || ''}`,
      },
      body: JSON.stringify({
        modo,
        eventId,
      }),
    });
  } catch {
    throw new ErrorApi({
      status: 503,
      codigo: 'ERROR_RED',
      mensaje: 'No pudimos conectar con el servidor de pagos. Revisa tu conexión.',
    });
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const status = res.status;
    const codigo = data?.codigo || data?.error || 'ERROR_PAGO';
    const mensaje = traducirErrorPago(status, codigo) || data?.mensaje || 'Error al iniciar el pago';
    throw new ErrorApi({
      status,
      codigo,
      mensaje,
    });
  }

  return {
    ...data,
    eventId,
  };
}

export default {
  crearIntencion,
};
