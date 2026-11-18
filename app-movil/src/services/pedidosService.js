/**
 * Servicio de pedidos móviles (Para llevar y Domicilio) y pago Wompi (pendiente D-20).
 * En Etapa 1 documenta los contratos esperados y expone la lista provisional de barrios.
 */

export const CANALES_PEDIDO = {
  PARA_LLEVAR: 'para_llevar',
  DOMICILIO: 'domicilio',
};

/**
 * Lista provisional de barrios para diseño del formulario en Etapa 1.
 * En D-20 será reemplazada por la cobertura y tarifas reales desde el backend.
 */
export const BARRIOS_PROVISIONALES = [
  { id: 'provisional-centro', nombre: 'Centro (provisional)' },
  { id: 'provisional-norte', nombre: 'Zona Norte (provisional)' },
  { id: 'provisional-sur', nombre: 'Zona Sur (provisional)' },
  { id: 'provisional-occidente', nombre: 'Occidente (provisional)' },
];

function errorNoImplementado(accion) {
  return new Error(
    `[D-20 pendiente] ${accion} estará disponible cuando se publiquen los endpoints de pedidos móviles y Wompi.`
  );
}

/**
 * Crea un pedido Para llevar o Domicilio (D-20).
 * Endpoint esperado: POST /api/pedidos/movil (con Authorization Bearer de D-19).
 * @param {{
 *   canal: 'para_llevar' | 'domicilio',
 *   lineas: Array<object>,
 *   direccion?: { direccion: string, barrioId: string, referencia?: string } | null
 * }} _payload
 * @param {string} _token
 * @returns {Promise<object>}
 */
export async function crearPedidoMovil(_payload, _token) {
  throw errorNoImplementado('crearPedidoMovil');
}

/**
 * Inicia la sesión de pago con Wompi para un pedido móvil (D-20).
 * Endpoint esperado: POST /api/pagos/movil/wompi (o equivalente de D-20).
 * @param {{ idPedido: number|string }} _datos
 * @param {string} _token
 * @returns {Promise<{ checkoutUrl?: string, referencia: string }>}
 */
export async function iniciarPagoWompi(_datos, _token) {
  throw errorNoImplementado('iniciarPagoWompi');
}

/**
 * Lista los pedidos del cliente autenticado (D-20).
 * Endpoint esperado: GET /api/pedidos/movil/mios
 * @param {string} _token
 * @returns {Promise<Array<object>>}
 */
export async function obtenerPedidosUsuario(_token) {
  throw errorNoImplementado('obtenerPedidosUsuario');
}
