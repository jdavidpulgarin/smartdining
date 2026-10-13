import { Navigate } from 'react-router-dom';
import Header from './Header';
import { useMesaSession } from '../../hooks/useMesaSession';
import { useCarrito } from '../../context/CarritoContext';

function Layout({ children }) {
  const { mesa, comensal, valida, cargando } = useMesaSession();
  const { totalUnidades } = useCarrito();

  if (cargando) {
    return null;
  }

  if (!valida) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-crema text-cafe flex flex-col">
      <Header
        numeroMesa={mesa}
        comensal={comensal}
        cantidadCarrito={totalUnidades}
      />
      <main className="flex-1 w-full max-w-md mx-auto p-4">{children}</main>
    </div>
  );
}

export default Layout;
