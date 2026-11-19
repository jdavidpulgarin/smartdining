import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Inicio from './Inicio';
import Header from '../components/layout/Header';
import Menu from './Menu';

// Mocks para pruebas de Inicio
vi.mock('../context/SesionContext', () => ({
  useSesion: () => ({
    sesion: null,
    estado: 'pide_nombre',
    error: null,
    enviando: false,
    recienUnido: false,
    tokenQrPendiente: 'token-simulado-mesa-4',
    unirse: vi.fn(),
    cerrarSesion: vi.fn(),
    limpiarError: vi.fn(),
  }),
}));

vi.mock('../utils/qr', () => ({
  leerMesaDelQr: (token) => (token ? 4 : null),
}));

vi.mock('../hooks/useSeguimientoMesa', () => ({
  default: () => ({
    misPedidos: [],
    resumen: { tienePedidos: false, estadoPrincipal: null },
  }),
}));

// Mocks para Menu
vi.mock('../services/menuService', () => ({
  obtenerCategorias: vi.fn().mockResolvedValue([]),
  obtenerPlatos: vi.fn().mockResolvedValue([]),
  obtenerPlatosArmables: vi.fn().mockResolvedValue([]),
  recargarMenu: vi.fn(),
  refrescarMenu: vi.fn().mockResolvedValue(),
  actualizarDisponibilidadPlatoEnCache: vi.fn(),
  actualizarDisponibilidadEnCache: vi.fn(),
  suscribirCambiosMenu: vi.fn(() => () => {}),
  adaptarCategorias: vi.fn((m) => m?.categorias || []),
  adaptarPlatos: vi.fn((m) => m?.platos || []),
  adaptarPlatosArmables: vi.fn((m) => m?.platosArmables || []),
  aplicarDisponibilidadEnListaPlatos: vi.fn((l) => l),
  aplicarDisponibilidadIngredienteEnArmables: vi.fn((l) => l),
}));

vi.mock('../context/CarritoContext', () => ({
  useCarrito: () => ({
    modo: 'individual',
    lineas: [],
    misLineas: [],
    total: 30000,
    totalMio: 30000,
    totalUnidades: 1,
    agregarLinea: vi.fn(),
  }),
}));

vi.mock('../context/MesaSocketContext', () => ({
  useMesaSocket: () => ({
    on: vi.fn(() => () => {}),
    estado: 'conectado',
  }),
}));

describe('Rediseño Comanda - Verificaciones visuales y accesibilidad', () => {
  it('el Inicio muestra "MESA" y el número real de la mesa detectada', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/inicio?token=token-simulado-mesa-4']}>
        <Inicio />
      </MemoryRouter>
    );

    expect(html).toContain('ESTÁS EN LA');
    expect(html).toContain('MESA');
    expect(html).toContain('4');
  });

  it('el encabezado conserva el aria-label del carrito', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/menu']}>
        <Header numeroMesa={4} comensal="Pedrito" cantidadCarrito={3} />
      </MemoryRouter>
    );

    expect(html).toContain('aria-label="Carrito, 3 productos"');
  });

  it('el Menú muestra la sección "ARMA TU PLATO" con "Desde"', () => {
    const platosArmablesMock = [
      {
        id_plato: 101,
        nombre: 'Bowl Personalizado',
        descripcion: 'Ingredientes frescos a tu gusto',
        precio: 30000,
        disponible: true,
        calorias: 450,
      },
    ];

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/menu']}>
        <Menu cargandoInicial={false} platosArmablesInicial={platosArmablesMock} />
      </MemoryRouter>
    );

    expect(html).toContain('ARMA TU PLATO');
    expect(html).toContain('Desde');
    expect(html).toContain('Bowl Personalizado');
  });

  it('la mascota chef se usa con alt vacío cuando es decorativa', () => {
    const htmlInicio = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/inicio?token=token-simulado-mesa-4']}>
        <Inicio />
      </MemoryRouter>
    );

    // Debe contener la imagen de la mascota
    expect(htmlInicio).toContain('/img/mascota-chef.webp');
    // Debe tener alt="" y aria-hidden="true"
    expect(htmlInicio).toMatch(/<img[^>]*src="\/img\/mascota-chef\.webp"[^>]*alt=""[^>]*aria-hidden="true"/);
  });
});
