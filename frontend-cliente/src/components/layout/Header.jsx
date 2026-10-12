import { Link } from 'react-router-dom';

function Header({ numeroMesa, comensal, cantidadCarrito = 0 }) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo / Nombre */}
        <Link to="/menu" className="flex items-center gap-1.5 no-underline">
          <span className="text-xl font-black font-titulo text-primary tracking-tight">
            Smart<span className="text-cafe">Dining</span>
          </span>
        </Link>

        {/* Indicador de Mesa, Comensal y Carrito */}
        <div className="flex items-center gap-2.5">
          {comensal && (
            <span className="text-xs font-medium text-cafe truncate max-w-28">
              Hola, <strong className="font-semibold">{comensal}</strong>
            </span>
          )}
          {numeroMesa && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary shrink-0">
              Mesa {numeroMesa}
            </span>
          )}

          {/* Botón Carrito */}
          <Link
            to="/carrito"
            className="relative min-w-12 min-h-12 p-2 inline-flex items-center justify-center text-cafe hover:text-primary transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={
              cantidadCarrito === 1
                ? 'Carrito, 1 producto'
                : `Carrito, ${cantidadCarrito} productos`
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-primary rounded-full min-w-4 h-4"
            >
              {cantidadCarrito}
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}

export default Header;
