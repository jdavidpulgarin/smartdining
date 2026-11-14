import { describe, it, expect } from 'vitest';
import { formatearNotificacionPush } from './notificacionPush';

describe('formatearNotificacionPush (J-09 / T9)', () => {
  it('formatea estado en_preparacion con titulo sobrio y cuerpo descriptivo', () => {
    const res = formatearNotificacionPush({
      titulo: 'Tu pedido está en preparación',
      cuerpo: 'SD-087',
      id_pedido: 87,
      estado: 'en_preparacion',
      url: '/seguimiento',
    });

    expect(res).toEqual({
      titulo: 'Tu pedido está en preparación',
      cuerpo: 'Pedido SD-087. Te avisamos cuando esté listo.',
    });
  });

  it('los titulos de estados conocidos no contienen emojis ni signos de exclamacion', () => {
    for (const estado of ['en_preparacion', 'listo', 'cancelado']) {
      const { titulo } = formatearNotificacionPush({ estado });
      expect(titulo).not.toMatch(/[!¡]/);
      expect(titulo).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
      expect(titulo).not.toContain('\u200D');
    }
  });

  it('formatea estado listo con titulo sobrio y cuerpo descriptivo', () => {
    const res = formatearNotificacionPush({
      titulo: 'Tu pedido está listo',
      cuerpo: 'SD-087',
      id_pedido: 87,
      estado: 'listo',
      url: '/seguimiento',
    });

    expect(res).toEqual({
      titulo: 'Tu pedido está listo',
      cuerpo: 'Pedido SD-087. Ya sale de cocina hacia tu mesa.',
    });
  });

  it('formatea estado cancelado indicando preguntar al mesero', () => {
    const res = formatearNotificacionPush({
      titulo: 'Tu pedido fue cancelado',
      cuerpo: 'SD-087',
      id_pedido: 87,
      estado: 'cancelado',
      url: '/seguimiento',
    });

    expect(res).toEqual({
      titulo: 'Tu pedido fue cancelado',
      cuerpo: 'Pedido SD-087. Pregúntale al mesero si necesitas ayuda.',
    });
  });

  it('conserva titulo y cuerpo tal cual cuando el estado no es conocido', () => {
    const res = formatearNotificacionPush({
      titulo: 'Aviso de mesa',
      cuerpo: 'El mesero va en camino',
      id_pedido: 87,
      estado: 'estado_personalizado',
      url: '/seguimiento',
    });

    expect(res).toEqual({
      titulo: 'Aviso de mesa',
      cuerpo: 'El mesero va en camino',
    });
  });

  it('usa titulo por defecto SmartDining si llega estado desconocido sin titulo', () => {
    expect(formatearNotificacionPush({ cuerpo: 'Detalle' })).toEqual({
      titulo: 'SmartDining',
      cuerpo: 'Detalle',
    });
    expect(formatearNotificacionPush()).toEqual({
      titulo: 'SmartDining',
      cuerpo: '',
    });
  });

  it('no deja "Pedido ." colgado si el cuerpo llega vacio en estado conocido', () => {
    expect(formatearNotificacionPush({ estado: 'listo', cuerpo: '' })).toEqual({
      titulo: 'Tu pedido está listo',
      cuerpo: 'Ya sale de cocina hacia tu mesa.',
    });
  });
});
