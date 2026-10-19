import { pedirJson } from './api';
import { obtenerSesion } from '../utils/sesion';

/**
 * Servicio de consulta de la cuenta de la mesa (J-08).
 *
 * El backend extrae el id_mesa exclusivamente del JWT firmado del comensal
 * en la ruta GET /api/pedidos/mesa/cuenta.
 *
 * @param {number|string|null} [idMesa] - ID opcional de mesa para modo simulado
 * @returns {Promise<object>} Objeto de la cuenta de la mesa
 */
export async function obtenerCuenta(idMesa = null) {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const sesion = obtenerSesion();
    const { obtenerCuentaSimulada } = await import('./cuentaSimulada');
    return obtenerCuentaSimulada(idMesa ?? sesion?.idMesa, sesion?.comensal);
  }

  const sesion = obtenerSesion();
  const token = sesion?.token;

  return pedirJson('/pedidos/mesa/cuenta', {
    method: 'GET',
    token,
  });
}

export default {
  obtenerCuenta,
};
