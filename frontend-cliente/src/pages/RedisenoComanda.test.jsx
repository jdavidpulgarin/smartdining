import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Inicio from './Inicio';
import Header from '../components/layout/Header';
import Menu from './Menu';
import Carrito from './Carrito';
import LineaCarrito from '../components/carrito/LineaCarrito';
import IngredientCard from '../components/ui/IngredientCard';
import SelectorPorcion from '../components/constructor/SelectorPorcion';
import Modal from '../components/ui/Modal';
import LineaTiempo from '../components/seguimiento/LineaTiempo';
import IlustracionEstado from '../components/seguimiento/IlustracionEstado';
import Despedida from './Despedida';

if (typeof document === 'undefined') {
  global.document = {
    body: { style: {} },
    activeElement: null,
  };
}

// Mock de createPortal para permitir renderToStaticMarkup de Modal en entorno Node
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPortal: (node) => node,
  };
});

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
    misLineas: [
      {
        id_linea: 'linea-mock-1',
        nombre: 'Bowl de Pollo',
        cantidad: 1,
        precioUnitario: 30000,
        subtotal: 30000,
      },
    ],
    otros: [],
    total: 30000,
    totalMio: 30000,
    totalMesa: 30000,
    totalUnidades: 1,
    agregarLinea: vi.fn(),
    actualizarCantidad: vi.fn(),
    eliminarLinea: vi.fn(),
    vaciarCarrito: vi.fn(),
    marcarFaltantesEnMenu: vi.fn(),
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

  // PARTE 2: Tests de Carrito y Armar plato estilo comanda
  it('Carrito muestra la sección comanda "LO TUYO", subtotal y botón de enviar a cocina', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Carrito />
      </MemoryRouter>
    );

    expect(html).toContain('LO TUYO');
    expect(html).toContain('SUBTOTAL LO TUYO');
    expect(html).toContain('CUENTA');
    expect(html).toContain('Enviar mi pedido a cocina');
    expect(html).toContain('Seguir pidiendo');
  });

  it('Modal de confirmación de pedido comanda renderiza botones de acción', () => {
    const html = renderToStaticMarkup(
      <Modal abierto={true} onCerrar={() => {}} titulo="¿ENVIAR A COCINA?">
        <div>
          <button type="button">Confirmar y enviar</button>
          <button type="button">Revisar platos</button>
        </div>
      </Modal>
    );

    expect(html).toContain('¿ENVIAR A COCINA?');
    expect(html).toContain('Confirmar y enviar');
    expect(html).toContain('Revisar platos');
  });

  it('LineaCarrito renderiza el contador − / + con aria-labels y el precio en COP', () => {
    const linea = {
      id_linea: 'linea-test-1',
      nombre: 'Tacos Al Pastor',
      cantidad: 2,
      precioUnitario: 15000,
      subtotal: 30000,
      detalle: ['Tortilla de maíz', 'Carne al pastor'],
    };

    const html = renderToStaticMarkup(
      <LineaCarrito
        linea={linea}
        onActualizarCantidad={() => {}}
        onEliminar={() => {}}
      />
    );

    expect(html).toContain('Tacos Al Pastor');
    expect(html).toContain('aria-label="Disminuir cantidad de Tacos Al Pastor"');
    expect(html).toContain('aria-label="Aumentar cantidad de Tacos Al Pastor"');
    expect(html).toContain('30.000');
  });

  it('IngredientCard agotado tiene aria-disabled="true" e insignia AGOTADO', () => {
    const html = renderToStaticMarkup(
      <IngredientCard
        nombre="Aguacate Extra"
        agotado={true}
        disabled={true}
        precioExtra={5000}
      />
    );

    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('AGOTADO');
    expect(html).toContain('opacity-40');
  });

  it('SelectorPorcion tiene radiogroup y las opciones Ligera, Normal y Extra', () => {
    const html = renderToStaticMarkup(
      <SelectorPorcion
        nombreIngrediente="Queso costeño"
        porcionActual="normal"
        precioExtra={4000}
        onCambiar={() => {}}
      />
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Ligera');
    expect(html).toContain('Normal');
    expect(html).toContain('Extra');
    expect(html).toContain('4.000');
  });

  // PARTE 3: Tests de Seguimiento y Despedida estilo comanda
  it('LineaTiempo muestra los 4 pasos comanda preservando sus etiquetas', () => {
    const html = renderToStaticMarkup(<LineaTiempo estado="en_preparacion" />);

    expect(html).toContain('SEGUIMIENTO');
    expect(html).toContain('4 PASOS');
    expect(html).toContain('RECIBIDO');
    expect(html).toContain('EN PREPARACIÓN');
    expect(html).toContain('LISTO');
    expect(html).toContain('EN TU MESA');
    expect(html).toContain('aria-current="step"');
  });

  it('IlustracionEstado renderiza la escena vectorial con aria-hidden="true"', () => {
    const html = renderToStaticMarkup(<IlustracionEstado estado="recibido" />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('seg-gira');
    expect(html).toContain('seg-tk');
    expect(html).toContain('seg-ck');
  });

  it('Despedida muestra el ticket CUENTA PAGADA, sello verde y botón Volver al inicio', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={[{ pathname: '/despedida', state: { motivo: 'pagada', numeroMesa: 3, comensal: 'Carlos' } }]}>
        <Despedida />
      </MemoryRouter>
    );

    expect(html).toContain('fondo-comanda-rojo');
    expect(html).toContain('CUENTA PAGADA');
    expect(html).toContain('PAGADO');
    expect(html).toContain('¡GRACIAS POR VENIR!');
    expect(html).toContain('MESA 3');
    expect(html).toContain('btn-despedida-inicio');
    expect(html).toContain('Volver al inicio');
    expect(html).toContain('/img/mascota-chef.webp');
  });
});
