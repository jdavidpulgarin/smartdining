import { Navigate } from 'react-router-dom';
import Header from './Header';
import { useMesaSession } from '../../hooks/useMesaSession';
import { useCarrito } from '../../context/CarritoContext';
import { obtenerApodo } from '../../utils/apodo';

function Layout({ children }) {
  const { mesa } = useMesaSession();
  const { totalUnidades } = useCarrito();
  const apodo = obtenerApodo();

  if (!apodo) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-crema text-cafe flex flex-col">
      <Header numeroMesa={mesa} cantidadCarrito={totalUnidades} />
      <main className="flex-1 w-full max-w-md mx-auto p-4">
        {children}
      </main>
    </div>
  );
}

export default Layout;
