import { useEffect, useRef } from 'react';
import { useSeguimientoContext } from '../context/SeguimientoContext';

/**
 * Hook para consumir el estado compartido de seguimiento de pedidos de la mesa (J-07, J-14).
 *
 * Lee del `SeguimientoContext` global para que `Header` y `Seguimiento` compartan
 * exactamente la misma lista reactiva de pedidos. Si recibe `pedidoInicial`
 * (por ejemplo desde `location.state.pedido`), lo incorpora al estado compartido
 * sin sobrescribir actualizaciones más recientes.
 *
 * @param {object|null} [pedidoInicial] - Pedido que viene de navegación (location.state)
 */
export function useSeguimientoMesa(pedidoInicial = null) {
  const contexto = useSeguimientoContext();
  if (!contexto) {
    throw new Error('useSeguimientoMesa debe usarse dentro de SeguimientoProvider');
  }

  const { registrarPedido } = contexto;
  const ultimoInicialRef = useRef(null);

  useEffect(() => {
    if (pedidoInicial && pedidoInicial !== ultimoInicialRef.current) {
      ultimoInicialRef.current = pedidoInicial;
      registrarPedido(pedidoInicial, { seleccionar: true });
    }
  }, [pedidoInicial, registrarPedido]);

  return contexto;
}

export default useSeguimientoMesa;
