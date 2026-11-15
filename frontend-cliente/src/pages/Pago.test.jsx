import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import Pago from './Pago';

// Mockeamos únicamente useCuentaMesa y useMesaSocket.
// No mockeamos utils/cuenta: estadoSelectorPago y decidirVisibilidadPago son los reales.
let mockCuentaActual = null;
let mockCargando = false;
let mockError = null;

vi.mock('../hooks/useCuentaMesa', () => ({
  useCuentaMesa: () => ({
    cuenta: mockCuentaActual,
    cargando: mockCargando,
    error: mockError,
    recargar: vi.fn(),
    idMesa: 5,
    comensal: 'Ana',
  }),
}));

vi.mock('../context/MesaSocketContext', () => ({
  useMesaSocket: () => ({
    on: vi.fn(() => () => {}),
    enviar: vi.fn(),
    presencia: null,
    estado: 'conectado',
  }),
}));

describe('Pago.jsx - renderizado de sección de pago', () => {
  beforeEach(() => {
    mockCargando = false;
    mockError = null;
  });

  it('a) 1 comensal en la cuenta con saldo > 0 → aparece el botón "PAGAR LA CUENTA" con el monto, y NO aparece el selector de 2 opciones', () => {
    mockCuentaActual = {
      id_mesa: 5,
      numero: 5,
      ubicacion: 'Terraza',
      total: 35000,
      pagado: 0,
      saldo: 35000,
      items_totales: 2,
      mia: {
        subtotal: 35000,
        pagado: 0,
        saldo: 35000,
      },
      comensales: [
        {
          nombre: 'Ana',
          esMio: true,
          subtotal: 35000,
          pagado: 0,
          saldo: 35000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pago />
      </MemoryRouter>
    );

    // Debe contener el botón "PAGAR LA CUENTA" con el monto
    expect(html).toContain('PAGAR LA CUENTA');
    expect(html).toContain('$ 35.000');
    // Botón de caja también debe estar presente en la sección de pago
    expect(html).toContain('PAGAR EN CAJA');

    // NO debe aparecer el selector de 2 opciones
    expect(html).not.toContain('¿CÓMO QUIERES PAGAR?');
    expect(html).not.toContain('aria-label="Modo de pago"');
  });

  it('b) 3 comensales y lo mío ya pagado, la mesa aún debe → aparece "PAGAR TODA LA CUENTA" con el saldo, sin selector', () => {
    mockCuentaActual = {
      id_mesa: 5,
      numero: 5,
      ubicacion: 'Terraza',
      total: 90000,
      pagado: 30000,
      saldo: 60000,
      items_totales: 6,
      mia: {
        subtotal: 30000,
        pagado: 30000,
        saldo: 0,
      },
      comensales: [
        {
          nombre: 'Ana',
          esMio: true,
          subtotal: 30000,
          pagado: 30000,
          saldo: 0,
        },
        {
          nombre: 'Beto',
          esMio: false,
          subtotal: 30000,
          pagado: 0,
          saldo: 30000,
        },
        {
          nombre: 'Carlos',
          esMio: false,
          subtotal: 30000,
          pagado: 0,
          saldo: 30000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pago />
      </MemoryRouter>
    );

    // Debe mostrar la sección de pago con "PAGAR TODA LA CUENTA" y el saldo de la mesa (60.000)
    expect(html).toContain('PAGAR TODA LA CUENTA');
    expect(html).toContain('$ 60.000');
    expect(html).toContain('PAGAR EN CAJA');

    // NO debe aparecer el selector de 2 opciones
    expect(html).not.toContain('¿CÓMO QUIERES PAGAR?');
    expect(html).not.toContain('aria-label="Modo de pago"');
  });

  it('c) 3 comensales, lo mío pendiente → aparece el selector con "Pagar lo mío" y "Pagar toda la cuenta", y el botón de pagar', () => {
    mockCuentaActual = {
      id_mesa: 5,
      numero: 5,
      ubicacion: 'Terraza',
      total: 90000,
      pagado: 0,
      saldo: 90000,
      items_totales: 6,
      mia: {
        subtotal: 30000,
        pagado: 0,
        saldo: 30000,
      },
      comensales: [
        {
          nombre: 'Ana',
          esMio: true,
          subtotal: 30000,
          pagado: 0,
          saldo: 30000,
        },
        {
          nombre: 'Beto',
          esMio: false,
          subtotal: 30000,
          pagado: 0,
          saldo: 30000,
        },
        {
          nombre: 'Carlos',
          esMio: false,
          subtotal: 30000,
          pagado: 0,
          saldo: 30000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pago />
      </MemoryRouter>
    );

    // Debe aparecer el selector con las opciones
    expect(html).toContain('¿CÓMO QUIERES PAGAR?');
    expect(html).toContain('aria-label="Modo de pago"');
    expect(html).toContain('Pagar lo mío');
    expect(html).toContain('Pagar toda la cuenta');

    // Botón de pagar presente con el monto de lo mío (30.000)
    expect(html).toContain('PAGAR $ 30.000');
    expect(html).toContain('PAGAR EN CAJA');
  });

  it('d) saldo 0 → no aparece ningún botón de pagar', () => {
    mockCuentaActual = {
      id_mesa: 5,
      numero: 5,
      ubicacion: 'Terraza',
      total: 50000,
      pagado: 50000,
      saldo: 0,
      items_totales: 3,
      mia: {
        subtotal: 50000,
        pagado: 50000,
        saldo: 0,
      },
      comensales: [
        {
          nombre: 'Ana',
          esMio: true,
          subtotal: 50000,
          pagado: 50000,
          saldo: 0,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pago />
      </MemoryRouter>
    );

    // No debe haber botones para iniciar pago ni selector
    expect(html).not.toContain('PAGAR $');
    expect(html).not.toContain('PAGAR LA CUENTA');
    expect(html).not.toContain('PAGAR TODA LA CUENTA');
    expect(html).not.toContain('PAGAR EN CAJA');
    expect(html).not.toContain('¿CÓMO QUIERES PAGAR?');
  });

  it('e) estado en_revision → muestra aviso, sin botón de reintentar, botón de pago en línea deshabilitado y pagar en caja visible', () => {
    mockCuentaActual = {
      id_mesa: 5,
      numero: 5,
      ubicacion: 'Terraza',
      total: 35000,
      pagado: 0,
      saldo: 35000,
      items_totales: 2,
      mia: {
        subtotal: 35000,
        pagado: 0,
        saldo: 35000,
      },
      comensales: [
        {
          nombre: 'Ana',
          esMio: true,
          subtotal: 35000,
          pagado: 0,
          saldo: 35000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Pago
          errorPagoInicial={{
            tipo: 'en_revision',
            mensaje: 'Tu pago anterior está en revisión. No vuelvas a pagar; pregúntale al mesero.',
          }}
        />
      </MemoryRouter>
    );

    // Muestra el texto de pago en revisión
    expect(html).toContain('Tu pago anterior está en revisión. No vuelvas a pagar; pregúntale al mesero.');

    // NO debe haber botón de reintentar
    expect(html.toLowerCase()).not.toContain('reintentar');

    // El botón de pagar en línea está deshabilitado
    const botones = Array.from(html.matchAll(/<button[\s\S]*?<\/button>/g)).map((m) => m[0]);
    const botonWompi = botones.find((b) => b.includes('PAGAR LA CUENTA'));
    const botonCaja = botones.find((b) => b.includes('PAGAR EN CAJA'));

    expect(botonWompi).toBeDefined();
    expect(botonWompi).toContain('disabled=""');

    // "Pagar en caja" sigue visible y no deshabilitado
    expect(botonCaja).toBeDefined();
    expect(botonCaja).not.toContain('disabled');
  });
});
