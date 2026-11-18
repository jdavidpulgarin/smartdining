import { useEffect, useMemo, useState } from 'react';
import restauranteDefault from './datos/restaurante.js';
import { obtenerMenuPublico } from './services/menuService.js';
import { efectoCarta } from './utils/efectoCarta.js';
import Encabezado from './componentes/Encabezado.jsx';
import Inicio from './secciones/Inicio.jsx';
import Nosotros from './secciones/Nosotros.jsx';
import CartaSeccion from './secciones/Carta.jsx';
import Videos from './secciones/Videos.jsx';
import ComoPedir from './secciones/ComoPedir.jsx';
import Proximamente from './secciones/Proximamente.jsx';
import Contacto from './secciones/Contacto.jsx';
import Pie from './secciones/Pie.jsx';
import PlatoDetalleModal from './components/menu/PlatoDetalleModal.jsx';

/**
 * Devuelve la lista de enlaces de secciones activos según los datos del restaurante.
 * Solo incluye '#videos' si restaurante.videos contiene elementos.
 */
export function obtenerSecciones(datosRestaurante = {}) {
  const lista = [
    { href: '#inicio', etiqueta: 'Inicio' },
    { href: '#nosotros', etiqueta: 'Nosotros' },
    { href: '#carta', etiqueta: 'Carta' },
  ];

  if (Array.isArray(datosRestaurante.videos) && datosRestaurante.videos.length > 0) {
    lista.push({ href: '#videos', etiqueta: 'Videos' });
  }

  lista.push(
    { href: '#como-pedir', etiqueta: '¿Cómo pedir?' },
    { href: '#proximamente', etiqueta: 'Próximamente' },
    { href: '#contacto', etiqueta: 'Contacto' }
  );

  return lista;
}

/**
 * Componente raíz del sitio público.
 * Gestiona la carga de la carta en vivo con respaldo fijo y refresco periódico.
 */
export function App({
  menuInicial = null,
  cargandoInicial = false,
  errorInicial = false,
  datosRestaurante = restauranteDefault,
} = {}) {
  const [menu, setMenu] = useState(() => menuInicial ?? null);
  const [cargando, setCargando] = useState(() =>
    menuInicial ? false : cargandoInicial || true
  );
  const [error, setError] = useState(() => errorInicial);
  const [platoSeleccionado, setPlatoSeleccionado] = useState(null);

  useEffect(
    () =>
      efectoCarta({
        menuInicial,
        setMenu,
        setError,
        setCargando,
      }),
    [menuInicial]
  );

  const manejarReintentar = async () => {
    setCargando(true);
    setError(false);
    try {
      const datos = await obtenerMenuPublico();
      setMenu(datos);
    } catch (err) {
      console.error('Error al reintentar la carga del menú:', err);
      setError(true);
    } finally {
      setCargando(false);
    }
  };

  const secciones = useMemo(
    () => obtenerSecciones(datosRestaurante),
    [datosRestaurante]
  );

  const tieneVideos =
    Array.isArray(datosRestaurante.videos) && datosRestaurante.videos.length > 0;

  return (
    <div className="min-h-screen bg-fondo text-texto font-cuerpo flex flex-col overflow-x-hidden">
      <Encabezado secciones={secciones} datosRestaurante={datosRestaurante} />
      <main id="contenido" className="flex-1">
        <Inicio datosRestaurante={datosRestaurante} />
        <Nosotros datosRestaurante={datosRestaurante} />
        <CartaSeccion
          menu={menu}
          cargando={cargando}
          error={error}
          onReintentar={manejarReintentar}
          onSeleccionarPlato={setPlatoSeleccionado}
        />
        {tieneVideos && <Videos datosRestaurante={datosRestaurante} />}
        <ComoPedir />
        <Proximamente />
        <Contacto datosRestaurante={datosRestaurante} />
      </main>
      <Pie datosRestaurante={datosRestaurante} secciones={secciones} />

      {/* Modal de detalle en solo lectura */}
      <PlatoDetalleModal
        key={platoSeleccionado?.id ?? 'cerrado'}
        plato={platoSeleccionado}
        abierto={Boolean(platoSeleccionado)}
        onCerrar={() => setPlatoSeleccionado(null)}
        soloLectura
      />
    </div>
  );
}

export default App;
