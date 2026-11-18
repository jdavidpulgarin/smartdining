import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AvisoModoDemostracion from './AvisoModoDemostracion';

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
  });

  it('con onContinuar tiene el botón "Entendido, continuar al pago", role="alertdialog" y aria-labelledby', () => {
    const onContinuar = () => {};
    const html = renderToStaticMarkup(
      <AvisoModoDemostracion onContinuar={onContinuar} />
    );

    expect(html).toContain('Modo demostración');
    expect(html).toContain('4242 4242 4242 4242');
    expect(html).toContain('role="alertdialog"');
    expect(html).not.toContain('role="note"');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('<button');
    expect(html).toContain('Entendido, continuar al pago');
  });
});
