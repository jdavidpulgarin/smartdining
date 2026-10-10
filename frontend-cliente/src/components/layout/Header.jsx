import { Link } from 'react-router-dom';

function Header({ numeroMesa, cantidadCarrito = 0 }) {
  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo / Nombre */}
        <Link to="/menu" className="flex items-center gap-1.5 no-underline">
          <span className="text-xl font-black text-blue-600 tracking-tight">
            Smart<span className="text-gray-900">Dining</span>
          </span>
        </Link>

        {/* Indicador de Mesa y Carrito */}
        <div className="flex items-center gap-3">
          {numeroMesa && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              Mesa {numeroMesa}
            </span>
          )}

          {/* Botón Carrito */}
          <Link
            to="/carrito"
            className="relative p-2 text-gray-700 hover:text-blue-600 transition-colors rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="absolute -top-1 -right-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full min-w-4 h-4"
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
