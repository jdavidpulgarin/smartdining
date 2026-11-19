import { Link, useLocation } from 'react-router-dom';
import { pluralizar } from '../../utils/pluralizar';
import useSeguimientoMesa from '../../hooks/useSeguimientoMesa';
import { infoEstado, resumenPedidosActivos } from '../../utils/seguimiento';

function Header({ numeroMesa, comensal, cantidadCarrito = 0 }) {
  const location = useLocation();
  const rutaActual = location?.pathname || '';

  const { misPedidos } = useSeguimientoMesa();
  const resumen = resumenPedidosActivos(misPedidos);
  const mostrarBotonSeguimiento =
    rutaActual !== '/seguimiento' && resumen.tienePedidos;
  const infoEstadoPrincipal = resumen.estadoPrincipal
    ? infoEstado(resumen.estadoPrincipal)
    : null;

  const nombreComensal = (comensal || '').trim().toUpperCase();

  let pastilla = null;
  if (rutaActual === '/carrito') {
    pastilla = (
      <Link
        to="/menu"
        className="min-h-11 px-4 py-1.5 rounded-full border-2 border-carbon bg-papel hover:bg-carbon hover:text-ambar text-carbon font-titulo text-lg tracking-wider uppercase transition-colors inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa"
      >
        MENÚ
      </Link>
    );
  } else if (rutaActual === '/seguimiento') {
    pastilla = (
      <Link
        to="/menu"
        className="min-h-11 px-4 py-1.5 rounded-full border-2 border-carbon bg-papel text-carbon hover:bg-carbon hover:text-ambar font-titulo text-lg tracking-wider uppercase transition-colors inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa"
      >
        PEDIR MÁS
      </Link>
    );
  } else {
    pastilla = (
      <Link
        to="/carrito"
        className="relative w-[52px] h-[52px] rounded-full bg-carbon text-ambar grid place-items-center cursor-pointer shrink-0 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa"
        aria-label={`Carrito, ${cantidadCarrito} ${pluralizar(cantidadCarrito, 'producto', 'productos')}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-[26px] h-[26px]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 4h2.5l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.4" />
          <circle cx="10" cy="19.5" r="1.4" />
          <circle cx="17" cy="19.5" r="1.4" />
        </svg>
        {cantidadCarrito > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 min-w-[24px] h-[24px] px-1 rounded-full bg-papel text-carbon border-2 border-carbon font-cuerpo font-bold text-[13px] leading-[20px] text-center shadow-sm anim-pop"
          >
            {cantidadCarrito}
          </span>
        )}
      </Link>
    );
  }

  return (
    <header className="sticky top-0 z-50 bg-ambar border-b-[3px] border-carbon">
      <div className="max-w-[480px] mx-auto px-5 h-[82px] flex items-center justify-between gap-3">
        {/* Identidad: SD carbón + Nombre / Mesa */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/menu"
            className="w-[46px] h-[46px] rounded-[12px] bg-carbon text-ambar grid place-items-center font-titulo text-[25px] tracking-[0.04em] shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa"
            aria-label="Inicio SmartDining"
          >
            <span aria-hidden="true">SD</span>
          </Link>
          <div className="min-w-0">
            <p className="font-titulo text-[24px] sm:text-[25px] text-carbon tracking-[0.04em] uppercase truncate leading-none">
              {nombreComensal ? `HOLA, ${nombreComensal}` : 'SMARTDINING'}
            </p>
            {numeroMesa && (
              <p className="font-cuerpo text-xs font-semibold text-[#3b2a26] leading-tight mt-0.5">
                Mesa {numeroMesa}
              </p>
            )}
          </div>
        </div>

        {/* Acciones derechas: Mis pedidos (si aplica) y pastilla */}
        <div className="shrink-0 flex items-center gap-2">
          {mostrarBotonSeguimiento && (
            <Link
              to="/seguimiento"
              aria-label={
                resumen.cantidad > 0
                  ? `Mis pedidos (${resumen.cantidad} ${pluralizar(resumen.cantidad, 'activo', 'activos')})`
                  : 'Mis pedidos'
              }
              className="relative w-[52px] h-[52px] rounded-full bg-carbon text-ambar grid place-items-center cursor-pointer shrink-0 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-[24px] h-[24px]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 5H7a2 2 0 00-2 2v14l3-2 3 2 3-2 3 2V7a2 2 0 00-2-2h-2" />
                <path d="M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                <path d="M9 11h6" />
                <path d="M9 15h4" />
              </svg>

              {resumen.cantidad > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1 text-[10px] font-bold font-titulo leading-none text-carbon bg-papel border-2 border-carbon rounded-full min-w-4 h-4 shadow-sm"
                >
                  {resumen.cantidad}
                </span>
              )}

              {infoEstadoPrincipal && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-carbon ${
                    resumen.estadoPrincipal === 'listo' ? 'dot-latido' : ''
                  }`}
                  style={{ backgroundColor: infoEstadoPrincipal.color }}
                />
              )}
            </Link>
          )}

          {pastilla}
        </div>
      </div>
    </header>
  );
}

export default Header;
