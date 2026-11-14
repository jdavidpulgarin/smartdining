import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Carrito from './Carrito';

let mockMisLineas = [];

vi.mock('../context/CarritoContext', () => ({
  useCarrito: () => ({
    modo: 'individual',
    estadoConexion: 'conectado',
    misLineas: mockMisLineas,
    otros: [],
    totalMio: mockMisLineas.reduce(
      (acc, l) => acc + (Number(l.precioUnitario || l.precio) || 0) * (l.cantidad || 1),
      0
    ),
    totalMesa: mockMisLineas.reduce(
      (acc, l) => acc + (Number(l.precioUnitario || l.precio) || 0) * (l.cantidad || 1),
      0
    ),
    totalUnidades: mockMisLineas.reduce((acc, l) => acc + (l.cantidad || 1), 0),
    actualizarCantidad: vi.fn(),
    eliminarLinea: vi.fn(),
    vaciarCarrito: vi.fn(),
    marcarFaltantesEnMenu: vi.fn(),
  }),
}));

vi.mock('../context/MesaSocketContext', () => ({
  useMesaSocket: () => ({
    on: vi.fn(() => () => {}),
  }),
}));

vi.mock('../utils/apodo', () => ({
  obtenerApodo: () => 'Ana',
}));

describe('Carrito.jsx - renderizado con stock y ajuste de cantidad', () => {
  beforeEach(() => {
    mockMisLineas = [];
  });

  it('sin ajustar: con cantidad 2 y disponible 1, el botón "ENVIAR MI PEDIDO A COCINA" está deshabilitado y sale "Se acabó"', () => {
    mockMisLineas = [
      {
        id_linea: 'linea-1',
        id_plato: 1008,
        nombre: 'Limonada de Coco',
        cantidad: 2,
        precioUnitario: 12000,
        subtotal: 24000,
      },
    ];

    const error409 = {
      tipo: 'sin_stock',
      status: 409,
      motivo: 'sin_stock',
      hayFaltantes: true,
      puedeEnviar: false,
      faltantes: [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: 1 },
      ],
      itemsAfectados: [
        {
          idLinea: 'linea-1',
          id_linea: 'linea-1',
          id_plato: 1008,
          nombre: 'Limonada de Coco',
          disponible: 1,
          puedeAjustar: true,
          faltantes: [
            { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: 1 },
          ],
        },
      ],
      lineasAfectadas: [
        { idLinea: 'linea-1', id_linea: 'linea-1', disponible: 1, puedeAjustar: true },
      ],
      idsLineasAfectadas: ['linea-1'],
      texto: 'Se acabó: Limonada de Coco. Quítalo para enviar el resto.',
      mensaje: 'Se acabó: Limonada de Coco. Quítalo para enviar el resto.',
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Carrito
          errorPedidoInicial={error409}
          faltantesIniciales={error409.faltantes}
        />
      </MemoryRouter>
    );

    // Botón de enviar está deshabilitado
    const botonEnviar = html.match(/<button[^>]*><span>Enviar mi pedido a cocina<\/span><\/button>/)?.[0];
    expect(botonEnviar).toBeDefined();
    expect(botonEnviar).toContain('disabled=""');
    // Debe mostrar la advertencia "Se acabó"
    expect(html).toContain('Se acabó: Limonada de Coco');
  });

  it('con la cantidad ajustada: con cantidad 1 y disponible 1, el botón "ENVIAR MI PEDIDO A COCINA" NO está deshabilitado y NO sale "Se acabó"', () => {
    mockMisLineas = [
      {
        id_linea: 'linea-1',
        id_plato: 1008,
        nombre: 'Limonada de Coco',
        cantidad: 1,
        precioUnitario: 12000,
        subtotal: 12000,
      },
    ];

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Carrito errorPedidoInicial={null} faltantesIniciales={[]} />
      </MemoryRouter>
    );

    // Botón de enviar está presente y NO está deshabilitado
    const botonEnviar = html.match(/<button[^>]*><span>Enviar mi pedido a cocina<\/span><\/button>/)?.[0];
    expect(botonEnviar).toBeDefined();
    expect(botonEnviar).not.toContain('disabled=""');
    // NO debe salir "Se acabó"
    expect(html).not.toContain('Se acabó');
  });
});
