import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AvisoModoDemostracion, { manejarTeclaAviso } from './AvisoModoDemostracion';

describe('AvisoModoDemostracion component', () => {
  it('sin onContinuar muestra el texto, la tarjeta de prueba "4242 4242 4242 4242", role="note" y NO tiene botón', () => {
    const html = renderToStaticMarkup(<AvisoModoDemostracion />);

    expect(html).toContain('Modo demostración');
    expect(html).toContain(
      'Este pago es de prueba: no uses tu tarjeta real. Para probar, usa la tarjeta'
    );
    expect(html).toContain('4242 4242 4242 4242');
    expect(html).toContain('role="note"');
    expect(html).not.toContain('role="alertdialog"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Entendido, continuar al pago');
    expect(html).not.toContain('Cancelar');
  });

  it('con onContinuar y onCancelar → botones "Entendido, continuar al pago" y "Cancelar", role="alertdialog" y aria-modal="true"', () => {
    const onContinuar = () => {};
    const onCancelar = () => {};
    const html = renderToStaticMarkup(
      <AvisoModoDemostracion onContinuar={onContinuar} onCancelar={onCancelar} />
    );

    expect(html).toContain('Modo demostración');
    expect(html).toContain('4242 4242 4242 4242');
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).not.toContain('role="note"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('Entendido, continuar al pago');
    expect(html).toContain('Cancelar');
  });

  describe('manejarTeclaAviso', () => {
    it('Escape → llama onCancelar una vez; Enter u otra tecla → no llama', () => {
      const onCancelar = vi.fn();

      manejarTeclaAviso({ key: 'Escape' }, { onCancelar });
      expect(onCancelar).toHaveBeenCalledTimes(1);

      manejarTeclaAviso({ key: 'Enter' }, { onCancelar });
      manejarTeclaAviso({ key: 'ArrowDown' }, { onCancelar });
      manejarTeclaAviso({ key: 'Tab' }, { onCancelar });
      expect(onCancelar).toHaveBeenCalledTimes(1);
    });

    it('no falla si onCancelar no es una función o evento es inválido', () => {
      expect(() => manejarTeclaAviso({ key: 'Escape' })).not.toThrow();
      expect(() => manejarTeclaAviso(null)).not.toThrow();
      expect(() => manejarTeclaAviso(undefined, { onCancelar: null })).not.toThrow();
    });
  });
});
