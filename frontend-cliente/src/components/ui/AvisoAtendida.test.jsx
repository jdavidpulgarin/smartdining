import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AvisoAtendida from './AvisoAtendida';
import ContenidoPrincipal from '../layout/ContenidoPrincipal';
import Pago from '../../pages/Pago';
import { avisoDeAtendida, posicionAvisoAtendida } from '../../utils/avisoAtendida';

// Pago con una cuenta por pagar (mismos mocks que pages/Pago.test.jsx).
vi.mock('../../hooks/useCuentaMesa', () => ({
  useCuentaMesa: () => ({
    cuenta: {
      id_mesa: 10, numero: 3, ubicacion: 'Terraza', total: 35000, pagado: 0, saldo: 35000, items_totales: 2,
      mia: { subtotal: 35000, pagado: 0, saldo: 35000 },
      comensales: [{ nombre: 'Ana', esMio: true, subtotal: 35000, pagado: 0, saldo: 35000 }],
    },
    cargando: false,
    error: null,
    recargar: vi.fn(),
    idMesa: 10,
    comensal: 'Ana',
  }),
}));
vi.mock('../../context/MesaSocketContext', () => ({
  useMesaSocket: () => ({ on: vi.fn(() => () => {}), enviar: vi.fn(), presencia: null, estado: 'conectado' }),
}));

const llamado = avisoDeAtendida({ eventId: 'e1', id_mesa: 10, tipo: 'llamado' }, 10);
const cuenta = avisoDeAtendida({ eventId: 'e2', id_mesa: 10, tipo: 'cuenta' }, 10);

// La etiqueta de apertura del aviso (para mirar sus clases y su estilo).
const etiquetaAviso = (html) => html.match(/<div[^>]*data-testid="aviso-atendida"[^>]*>/)?.[0] ?? '';

describe('AvisoAtendida', () => {
  it('accesible: role="status" y aria-live="polite", con el texto y el botón ✕', () => {
    const html = renderToStaticMarkup(<AvisoAtendida aviso={llamado} onCerrar={() => {}} />);
    const div = etiquetaAviso(html);
    expect(div).toContain('role="status"');
    expect(div).toContain('aria-live="polite"');
    expect(html).toContain('Tu mesero ya va en camino');
    expect(html).toContain('aria-label="Cerrar aviso"');
    expect(html).toContain('type="button"');
  });

  it("'cuenta' muestra «El mesero va con tu cuenta»", () => {
    const html = renderToStaticMarkup(<AvisoAtendida aviso={cuenta} onCerrar={() => {}} />);
    expect(html).toContain('El mesero va con tu cuenta');
    expect(html).not.toContain('Tu mesero ya va en camino');
  });

  it('sin aviso no pinta nada', () => {
    expect(renderToStaticMarkup(<AvisoAtendida aviso={null} onCerrar={() => {}} />)).toBe('');
  });

  it('fuera de /pago: banda fija a la altura pedida (encima de las barras fijas)', () => {
    const { bottom } = posicionAvisoAtendida({ ruta: '/menu', hayCarrito: true });
    const div = etiquetaAviso(renderToStaticMarkup(<AvisoAtendida aviso={llamado} onCerrar={() => {}} bottom={bottom} />));
    expect(div).toMatch(/class="[^"]*\bfixed\b/);
    expect(div).toContain('bottom:calc(max(14px, env(safe-area-inset-bottom)) + 140px)');
  });

  it('en línea: no es fixed ni lleva bottom', () => {
    const div = etiquetaAviso(renderToStaticMarkup(<AvisoAtendida aviso={llamado} onCerrar={() => {}} enLinea bottom="10px" />));
    expect(div).not.toMatch(/\bfixed\b/);
    expect(div).not.toContain('bottom:');
  });
});

describe('Aviso en /pago', () => {
  beforeEach(() => {
    let datos = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (k) => datos[k] ?? null,
      setItem: (k, v) => { datos[k] = String(v); },
      removeItem: (k) => { delete datos[k]; },
      clear: () => { datos = {}; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const pagoConAviso = (aviso) => renderToStaticMarkup(
    <MemoryRouter initialEntries={['/pago']}>
      <ContenidoPrincipal esComanda avisoAtendida={aviso} posicionAviso={posicionAvisoAtendida({ ruta: '/pago' })} onCerrarAviso={() => {}}>
        <Pago />
      </ContenidoPrincipal>
    </MemoryRouter>
  );

  it('el aviso va dentro del flujo, arriba del contenido, y los botones y montos de pago siguen', () => {
    const html = pagoConAviso(cuenta);
    const div = etiquetaAviso(html);
    expect(div).not.toBe('');
    expect(div).not.toMatch(/\bfixed\b/);
    expect(div).toContain('role="status"');
    expect(div).toContain('aria-live="polite"');
    expect(html).toContain('El mesero va con tu cuenta');

    // Pago completa, con sus botones y el monto.
    expect(html).toContain('PAGAR LA CUENTA');
    expect(html).toContain('PAGAR EN CAJA');
    expect(html).toContain('$ 35.000');

    // Dentro de <main>, antes del contenido de Pago.
    const main = html.indexOf('id="contenido-principal"');
    const aviso = html.indexOf('data-testid="aviso-atendida"');
    expect(main).toBeGreaterThanOrEqual(0);
    expect(aviso).toBeGreaterThan(main);
    expect(aviso).toBeLessThan(html.indexOf('LA CUENTA'));
    expect(aviso).toBeLessThan(html.indexOf('PAGAR LA CUENTA'));
  });

  it('sin aviso, Pago se pinta igual que siempre', () => {
    const html = pagoConAviso(null);
    expect(html).not.toContain('aviso-atendida');
    expect(html).toContain('PAGAR LA CUENTA');
  });

  it('fuera de /pago el contenido principal no pinta el aviso (va como banda fija desde Layout)', () => {
    const html = renderToStaticMarkup(
      <ContenidoPrincipal esComanda avisoAtendida={llamado} posicionAviso={posicionAvisoAtendida({ ruta: '/seguimiento' })}>
        <p>Seguimiento</p>
      </ContenidoPrincipal>
    );
    expect(html).not.toContain('aviso-atendida');
  });
});
