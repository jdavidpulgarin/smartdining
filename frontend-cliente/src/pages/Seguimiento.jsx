import { useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { formatearPrecio } from '../utils/formato';

const CLAVE_ULTIMO_PEDIDO = 'smartdining_ultimo_pedido';

const PASOS_TIMELINE = [
  { clave: 'recibido', label: 'RECIBIDO' },
  { clave: 'en_preparacion', label: 'EN PREPARACIÓN' },
  { clave: 'listo', label: 'LISTO' },
  { clave: 'entregado', label: 'EN TU MESA' },
];

function obtenerIndiceEstado(estado) {
  switch (estado) {
    case 'recibido':
      return 0;
    case 'en_preparacion':
      return 1;
    case 'listo':
      return 2;
    case 'entregado':
      return 3;
    default:
      return 1;
  }
}

function Seguimiento() {
  const location = useLocation();
  const navigate = useNavigate();
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
          className="w-20 h-20 rounded-full bg-superficie border border-borde text-texto-suave flex items-center justify-center text-3xl mb-4"
        >
          📋
        </div>
        <h2 className="text-2xl font-titulo uppercase tracking-wider text-texto mb-2">
          No tienes pedidos activos en esta mesa
        </h2>
        <p className="text-sm text-texto-suave max-w-xs mb-6">
          Cuando confirmes un pedido desde el carrito, podrás ver su estado y avance aquí.
        </p>
        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center px-6 py-3 bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase tracking-wider font-bold text-sm rounded-xl transition-colors shadow-sm"
        >
          Ver menú
        </Link>
      </div>
    );
  }

  const estadoActual = pedido.estado || 'en_preparacion';
  const indiceActual = obtenerIndiceEstado(estadoActual);

  const tituloPorEstado = {
    recibido: 'PEDIDO RECIBIDO',
    en_preparacion: 'ESTÁ EN LA COCINA',
    listo: '¡LISTO!',
    entregado: 'EN TU MESA',
  };

  const subtituloPorEstado = {
    recibido: 'Tu orden fue recibida por la cocina.',
    en_preparacion: 'Listo en unos 8 minutos.',
    listo: 'Tu pedido está listo para servir.',
    entregado: '¡Buen provecho!',
  };

  const tituloEstado = tituloPorEstado[estadoActual] || 'ESTÁ EN LA COCINA';
  const subtituloEstado =
    subtituloPorEstado[estadoActual] || 'Tu orden está siendo atendida en cocina.';
  const codigoPedido = pedido.codigo_pedido || `PED-${pedido.id_pedido || '1061'}`;

  const itemsPedido = Array.isArray(pedido.lineas)
    ? pedido.lineas
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];

  return (
    <div className="space-y-4 pb-12">
      {/* Portada Hero Seguimiento */}
      <div className="-mx-4 -mt-4 mb-2 relative h-48 sm:h-56 overflow-hidden rounded-b-3xl bg-superficie">
        <img
          src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&q=80&auto=format"
          alt="Comida en preparación"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/75 to-fondo/20" />
        <div className="absolute bottom-0 inset-x-0 p-4">
          <p className="font-etiqueta text-xs uppercase tracking-wider text-texto-suave mb-1 font-bold">
            PEDIDO #{codigoPedido}
          </p>
          <h1 className="font-titulo text-4xl sm:text-5xl text-primario tracking-wider leading-none uppercase">
            {tituloEstado}
          </h1>
          <p className="text-xs sm:text-sm text-texto-suave mt-1">
            {subtituloEstado}
          </p>
        </div>
      </div>

      {/* Tarjeta de Línea de Tiempo de Estado */}
      <Card className="p-5 space-y-5 bg-superficie border border-borde rounded-2xl">
        <div className="space-y-4 pl-2">
          {PASOS_TIMELINE.map((paso, idx) => {
            const completado = idx < indiceActual;
            const activo = idx === indiceActual;

            return (
              <div key={paso.clave} className="flex items-start gap-3.5 relative">
                {/* Línea conectora */}
                {idx < PASOS_TIMELINE.length - 1 && (
                  <div
                    className={`absolute left-3 top-6 bottom-0 w-0.5 -mb-4 ${
                      idx < indiceActual ? 'bg-exito' : 'bg-borde'
                    }`}
                  />
                )}

                {/* Círculo indicador */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10 text-xs font-bold ${
                    completado
                      ? 'bg-exito text-white shadow-sm'
                      : activo
                        ? 'bg-acento text-fondo shadow-md ring-4 ring-acento/20'
                        : 'border-2 border-borde bg-superficie text-transparent'
                  }`}
                >
                  {completado ? '✓' : activo ? '●' : ''}
                </div>

                {/* Texto del paso */}
                <div className="min-w-0">
                  <p
                    className={`font-etiqueta uppercase text-sm tracking-wide font-bold ${
                      activo
                        ? 'text-acento'
                        : completado
                          ? 'text-texto'
                          : 'text-texto-tenue'
                    }`}
                  >
                    {paso.label}
                  </p>
                  {activo && (
                    <p className="text-[11px] text-texto-suave font-medium">
                      {subtituloEstado}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pedido.total !== undefined && (
          <div className="pt-3 border-t border-borde flex justify-between items-center text-sm">
            <span className="text-texto-suave font-medium">Total de la orden</span>
            <span className="font-bold font-etiqueta text-lg text-white">
              {formatearPrecio(pedido.total)}
            </span>
          </div>
        )}
      </Card>

      {/* Sección Lo que pidió la mesa (si hay líneas) */}
      {itemsPedido.length > 0 && (
        <section className="bg-superficie rounded-2xl p-4 border border-borde space-y-3">
          <h2 className="font-etiqueta uppercase font-bold text-sm tracking-wider text-texto">
            Lo que pidió la mesa
          </h2>
          <div className="space-y-2 divide-y divide-borde">
            {itemsPedido.map((item, idx) => (
              <div
                key={item.id_linea || idx}
                className="pt-2 first:pt-0 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-etiqueta uppercase text-sm font-bold text-texto truncate">
                    {item.nombre} {item.comensal ? `· ${item.comensal}` : ''}
                  </p>
                  {item.cantidad > 1 && (
                    <p className="text-xs text-texto-suave">{item.cantidad} unidades</p>
                  )}
                </div>
                <Badge
                  variante={
                    estadoActual === 'listo' || estadoActual === 'entregado'
                      ? 'exito'
                      : 'alerta'
                  }
                >
                  {estadoActual === 'listo'
                    ? 'LISTO'
                    : estadoActual === 'entregado'
                      ? 'ENTREGADO'
                      : 'PREPARANDO'}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Botón Pedir más platos */}
      <div className="pt-2">
        <Button
          variante="primario"
          onClick={() => navigate('/menu')}
          className="w-full min-h-12 py-3 px-4 font-bold font-etiqueta uppercase text-base rounded-xl"
        >
          Pedir más platos
        </Button>
      </div>
    </div>
  );
}

export default Seguimiento;
