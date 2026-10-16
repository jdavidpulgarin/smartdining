import { Link, useLocation } from 'react-router-dom';
import { pluralizar } from '../../utils/pluralizar';

function Header({ numeroMesa, comensal, cantidadCarrito = 0 }) {
  const location = useLocation();
  const rutaActual = location?.pathname || '';

  const nombreComensal = (comensal || '').trim().toUpperCase();

  let pastilla = null;
  if (rutaActual === '/carrito') {
    pastilla = (
      <Link
        to="/menu"
        className="min-h-10 px-3.5 py-1.5 rounded-full border border-borde bg-superficie-2 hover:bg-superficie text-texto font-etiqueta font-bold text-sm tracking-wide uppercase transition-colors inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
      >
        MENÚ
      </Link>
    );
  } else if (rutaActual === '/seguimiento') {
    pastilla = (
      <Link
        to="/menu"
        className="min-h-10 px-3.5 py-1.5 rounded-full border border-borde bg-superficie-2 hover:bg-superficie text-texto font-etiqueta font-bold text-sm tracking-wide uppercase transition-colors inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
      >
        PEDIR MÁS
      </Link>
    );
  } else {
    pastilla = (
      <Link
        to="/carrito"
        className="relative min-w-10 min-h-10 px-3 py-1.5 rounded-full border border-borde bg-superficie-2 hover:bg-superficie text-texto transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
        aria-label={`Carrito, ${cantidadCarrito} ${pluralizar(cantidadCarrito, 'producto', 'productos')}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-texto"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        {cantidadCarrito > 0 && (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-bold font-etiqueta leading-none text-white bg-primario rounded-full min-w-4 h-4"
          >
            {cantidadCarrito}
          </span>
        )}
      </Link>
    );
  }

  return (
    <header className="sticky top-0 z-50 bg-fondo/90 backdrop-blur-md border-b border-borde">
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
        {/* Identidad: SD rojo + Nombre / Mesa */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Link
            to="/menu"
            className="w-9 h-9 shrink-0 rounded-lg bg-primario flex items-center justify-center text-white font-etiqueta font-bold text-lg tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
            aria-label="Inicio SmartDining"
          >
            SD
          </Link>
          <div className="min-w-0">
            <p className="font-etiqueta font-bold text-base text-texto uppercase tracking-wide truncate leading-tight">
              {nombreComensal ? `HOLA, ${nombreComensal}` : 'SMARTDINING'}
            </p>
            {numeroMesa && (
              <p className="font-cuerpo text-xs text-texto-suave leading-none mt-0.5">
                Mesa {numeroMesa}
              </p>
            )}
          </div>
        </div>

        {/* Pastilla derecha */}
        <div className="shrink-0">{pastilla}</div>
      </div>
    </header>
  );
}

export default Header;
