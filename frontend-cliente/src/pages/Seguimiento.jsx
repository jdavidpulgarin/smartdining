import { useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import { formatearPrecio } from '../utils/formato';

const CLAVE_ULTIMO_PEDIDO = 'smartdining_ultimo_pedido';

function Seguimiento() {
  const location = useLocation();
  const pedidoState = location.state?.pedido;

  useEffect(() => {
    if (pedidoState) {
      try {
        sessionStorage.setItem(
          CLAVE_ULTIMO_PEDIDO,
          JSON.stringify(pedidoState)
        );
      } catch {
        // Ignorar errores de almacenamiento
      }
    }
  }, [pedidoState]);

  const pedido =
    pedidoState ||
    (() => {
      try {
        const guardado = sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO);
        return guardado ? JSON.parse(guardado) : null;
      } catch {
        return null;
      }
    })();

  if (!pedido) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-cafe/10 text-cafe flex items-center justify-center text-3xl mb-4"
        >
          📋
        </div>
        <h2 className="text-xl font-bold text-cafe mb-2">
          No tienes pedidos activos en esta mesa
        </h2>
        <p className="text-sm text-gray-600 max-w-xs mb-6">
          Cuando confirmes un pedido desde el carrito, podrás ver su estado y avance aquí.
        </p>
        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center px-6 py-3 bg-primary hover:bg-primary-hover active:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm"
        >
          Ver menú
        </Link>
      </div>
    );
  }

  const estadoLegible =
    pedido.estado === 'recibido'
      ? 'En cocina'
      : pedido.estado === 'en_preparacion'
        ? 'En preparación'
        : pedido.estado === 'listo'
          ? 'Listo'
          : pedido.estado || 'En cocina';

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-black text-cafe font-titulo">
          Estado del pedido
        </h1>
        <p className="text-sm text-gray-600">
          Tu orden está siendo atendida en cocina
        </p>
      </div>

      <Card className="p-6 text-center space-y-4 border-2 border-primary/20">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-verde/10 text-verde text-3xl mb-1">
          🍳
        </div>

        <div>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Código de pedido
          </span>
          <span className="text-3xl font-black text-cafe tracking-wide font-titulo block">
            {pedido.codigo_pedido || `PED-${pedido.id_pedido}`}
          </span>
        </div>

        <div className="flex justify-center items-center gap-2 pt-1">
          <span className="text-sm text-gray-600 font-medium">Estado:</span>
          <Badge variante="exito" className="text-sm px-3 py-1">
            {estadoLegible}
          </Badge>
        </div>

        {pedido.total !== undefined && (
          <div className="pt-3 border-t border-gray-100 flex justify-between items-center text-sm">
            <span className="text-gray-600 font-medium">Total de la orden</span>
            <span className="font-extrabold text-cafe text-base">
              {formatearPrecio(pedido.total)}
            </span>
          </div>
        )}
      </Card>

      <div className="bg-crema/40 rounded-xl p-4 border border-cafe/10 text-xs text-cafe/80 space-y-1">
        <p className="font-semibold text-cafe">¿Qué sigue?</p>
        <p>
          Los cocineros están preparando tus platos. No es necesario que te levantes; te avisaremos cuando tu comida esté lista.
        </p>
      </div>

      <div className="pt-2">
        <Link
          to="/menu"
          className="min-h-12 w-full inline-flex items-center justify-center px-4 py-3 bg-primary hover:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm text-center"
        >
          Pedir más platos
        </Link>
      </div>
    </div>
  );
}

export default Seguimiento;
