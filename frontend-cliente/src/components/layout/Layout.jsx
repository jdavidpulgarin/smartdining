import Header from './Header';
import { useMesaSession } from '../../hooks/useMesaSession';

function Layout({ children }) {
  const { mesa } = useMesaSession();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header numeroMesa={mesa} cantidadCarrito={0} />
      <main className="flex-1 w-full max-w-md mx-auto p-4">
        {children}
      </main>
    </div>
  );
}

export default Layout;
