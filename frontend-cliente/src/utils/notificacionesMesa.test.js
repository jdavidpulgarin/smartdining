import { describe, expect, it } from 'vitest';
import {
  extraerEmisorPedido,
  formatearMensajePedidoCreado,
} from './notificacionesMesa';

describe('extraerEmisorPedido', () => {
  it('extrae el comensal desde pedido.comensal', () => {
    const data = { pedido: { comensal: 'Beto' } };
    expect(extraerEmisorPedido(data)).toBe('Beto');
  });

  it('extrae el comensal desde pedido.alias', () => {
    const data = { pedido: { alias: 'Carlos' } };
    expect(extraerEmisorPedido(data)).toBe('Carlos');
  });

  it('extrae el comensal desde pedido.usuario', () => {
    const data = { pedido: { usuario: 'David' } };
    expect(extraerEmisorPedido(data)).toBe('David');
  });

  it('extrae el comensal desde los items si el pedido principal no lo trae', () => {
    const data = {
      pedido: {
        id_pedido: 10,
        items: [{ comensal: 'Elena', nombre: 'Bowl' }],
      },
    };
    expect(extraerEmisorPedido(data)).toBe('Elena');
  });

  it('devuelve null si no hay pedido o datos de emisor', () => {
    expect(extraerEmisorPedido(null)).toBeNull();
    expect(extraerEmisorPedido({})).toBeNull();
    expect(extraerEmisorPedido({ pedido: {} })).toBeNull();
  });
});

describe('formatearMensajePedidoCreado', () => {
  it('genera el mensaje personalizado cuando otro comensal envía su pedido', () => {
    const data = { pedido: { comensal: 'Beto' } };
    const mensaje = formatearMensajePedidoCreado(data, 'Ana');
    expect(mensaje).toBe('Beto envió su pedido a cocina');
  });

  it('devuelve null si el pedido fue enviado por el propio usuario (case-insensitive)', () => {
    const data = { pedido: { comensal: 'Ana' } };
    expect(formatearMensajePedidoCreado(data, 'Ana')).toBeNull();
    expect(formatearMensajePedidoCreado(data, '  ana  ')).toBeNull();
  });

  it('devuelve "Se envió un pedido de la mesa" si no hay nombre de emisor', () => {
    const data = { pedido: { id_pedido: 123, id_mesa: 5 } };
    expect(formatearMensajePedidoCreado(data, 'Ana')).toBe(
      'Se envió un pedido de la mesa'
    );
  });

  it('devuelve null si no hay datos de pedido', () => {
    expect(formatearMensajePedidoCreado(null, 'Ana')).toBeNull();
    expect(formatearMensajePedidoCreado({}, 'Ana')).toBeNull();
  });
});
