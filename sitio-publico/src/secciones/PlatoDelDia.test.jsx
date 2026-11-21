// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PlatoDelDia from './PlatoDelDia.jsx';

describe('Sección PlatoDelDia', () => {
  const cartaEnVivo = {
    origen: 'vivo',
    platos: [
      { nombre: 'Salchipapa con todo', precio: 25000, disponible: true },
      { nombre: 'Hamburguesa Smart Angus', precio: 34000, disponible: true },
      { nombre: 'Pollo asado', precio: 30000, disponible: false }, // agotado
    ],
  };

  it('con plato disponible en carta en vivo: muestra etiqueta de tiquete con día en mayúsculas ("MARTES") y "Plato del día", título, lema, precio y botón "PÍDELO EN TU MESA"', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia dia="martes" carta={cartaEnVivo} />
    );

    expect(html).toContain('id="hoy"');

    // 1) Etiqueta de tiquete: día en mayúsculas, "Plato del día" y subrayado curvo en SVG
    expect(html).toContain('etiqueta-tiquete');
    expect(html).toContain('MARTES');
    expect(html).toContain('Plato del día');
    expect(html).toContain('<svg');
    expect(html).not.toContain('animate-pulse');

    // 2) Título en dos partes y lema
    expect(html).toContain('SALCHIPAPA');
    expect(html).toContain('CON TODO');
    expect(html).toContain('como debe ser');

    // 3) Descripción suelta
    expect(html).toContain('Papas a la francesa crocantes');

    // 4) Ticket de papel con precio de la carta y contraste alto
    expect(html).toContain('ticket-papel');
    expect(html).toContain('PRECIO DE HOY');
    expect(html).toContain('text-primario-oscuro');
    expect(html).toContain('25.000');
    expect(html).toContain('$');
    expect(html).toContain('Disponible hoy');

    // Botón de pedido
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');

    // Video con atributos requeridos
    expect(html).toContain('<video');
    expect(html).toContain('poster="/videos/plato-del-dia/salchipapa.webp"');
    expect(html).toContain('/videos/plato-del-dia/salchipapa.mp4');
    expect(html).toContain('preload="none"');
    expect(html).toContain('muted');
    expect(html).toMatch(/playsinline/i);
    expect(html).toContain('loop');
  });

  it('con plato agotado en la carta: muestra bloque "Hoy no hay plato del día" sin precio, video ni botón', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia dia="jueves" carta={cartaEnVivo} />
    );

    expect(html).toContain('Hoy no hay plato del día');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PÍDELO EN TU MESA');
    expect(html).not.toContain('30.000');
  });

  it('con plato no existente en la carta: muestra "Hoy no hay plato del día" sin precio ni botón', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia dia="viernes" carta={cartaEnVivo} />
    );

    expect(html).toContain('Hoy no hay plato del día');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PÍDELO EN TU MESA');
  });

  it('con error al cargar la carta (errorCarta = true): muestra "Hoy no hay plato del día"', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia dia="martes" carta={null} errorCarta={true} />
    );

    expect(html).toContain('Hoy no hay plato del día');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PÍDELO EN TU MESA');
  });

  it('con carta de respaldo (origen: "fija"): muestra información y video pero SIN precio y SIN botón "PÍDELO EN TU MESA"', () => {
    const cartaRespaldo = {
      origen: 'fija',
      platos: [
        { nombre: 'Salchipapa con todo', precio: 25000, disponible: true },
      ],
    };

    const html = renderToStaticMarkup(
      <PlatoDelDia dia="martes" carta={cartaRespaldo} />
    );

    // Muestra cabecera de tiquete, título, lema, descripción y video
    expect(html).toContain('etiqueta-tiquete');
    expect(html).toContain('MARTES');
    expect(html).toContain('Plato del día');
    expect(html).toContain('SALCHIPAPA');
    expect(html).toContain('como debe ser');
    expect(html).toContain('<video');

    // NO muestra precio ni ticket ni botón
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PRECIO DE HOY');
    expect(html).not.toContain('25.000');
    expect(html).not.toContain('$');
    expect(html).not.toContain('PÍDELO EN TU MESA');
  });

  it('mientras carga la carta (cargandoCarta = true): se ve el esqueleto y NO "Hoy no hay plato del día"', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia
        dia="martes"
        carta={cartaEnVivo}
        cargandoCarta={true}
      />
    );

    expect(html).toContain('id="hoy"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Cargando el plato del día');
    expect(html).toContain('aspect-video');
    expect(html).not.toContain('Hoy no hay plato del día');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PÍDELO EN TU MESA');
  });

  it('con carta null sin error: se ve el esqueleto y NO "Hoy no hay plato del día"', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia
        dia="martes"
        carta={null}
        cargandoCarta={false}
        errorCarta={false}
      />
    );

    expect(html).toContain('id="hoy"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Cargando el plato del día');
    expect(html).toContain('aspect-video');
    expect(html).not.toContain('Hoy no hay plato del día');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PÍDELO EN TU MESA');
  });

  it('con día sin video disponible (lunes): muestra tarjeta de especialidad sin etiqueta <video>', () => {
    const html = renderToStaticMarkup(
      <PlatoDelDia dia="lunes" carta={cartaEnVivo} />
    );

    expect(html).toContain('HAMBURGUESA');
    expect(html).toContain('SMART ANGUS');
    expect(html).toContain('Especialidad de la casa');
    expect(html).not.toContain('<video');
    expect(html).toContain('ticket-papel');
    expect(html).toContain('34.000');
    expect(html).toContain('PÍDELO EN TU MESA');
  });

  it('el IntersectionObserver observa la sección real y arranca el video tras pasar del esqueleto a la carta cargada', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = window.matchMedia || vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const elementosObservados = [];
    let callbackObservador = null;

    const mockObserve = vi.fn((el) => {
      elementosObservados.push(el);
    });
    const mockDisconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(callback) {
        callbackObservador = callback;
      }
      observe(el) {
        mockObserve(el);
      }
      disconnect() {
        mockDisconnect();
      }
    }
    window.IntersectionObserver = MockIntersectionObserver;
    globalThis.IntersectionObserver = MockIntersectionObserver;

    const playMock = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.play = playMock;
    window.HTMLMediaElement.prototype.pause = vi.fn();

    const contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    const root = createRoot(contenedor);

    try {
      // 1) Primer render con carta null: se ve el esqueleto
      await act(async () => {
        root.render(<PlatoDelDia dia="martes" carta={null} />);
      });

      expect(contenedor.querySelector('[aria-busy="true"]')).not.toBeNull();

      // 2) Re-render con una carta que trae el plato del martes
      await act(async () => {
        root.render(<PlatoDelDia dia="martes" carta={cartaEnVivo} />);
      });

      // 3) Comprueba que el IntersectionObserver termina observando la sección real
      expect(mockObserve).toHaveBeenCalled();
      const seccionReal = contenedor.querySelector('section#hoy');
      expect(elementosObservados).toContain(seccionReal);

      // 4) Al simular que entra en pantalla se llama play()
      expect(callbackObservador).not.toBeNull();
      await act(async () => {
        callbackObservador([{ isIntersecting: true }]);
      });

      expect(playMock).toHaveBeenCalled();
    } finally {
      await act(async () => {
        root.unmount();
      });
      expect(mockDisconnect).toHaveBeenCalled();
      contenedor.remove();
    }
  });

  it('con plato disponible del sábado: muestra el texto "recién salida de la parrilla"', () => {
    const cartaSabado = {
      origen: 'vivo',
      platos: [
        { nombre: 'Carne asada con papas', precio: 38000, disponible: true },
      ],
    };

    const html = renderToStaticMarkup(
      <PlatoDelDia dia="sabado" carta={cartaSabado} />
    );

    expect(html).toContain('recién salida de la parrilla');
  });
});
