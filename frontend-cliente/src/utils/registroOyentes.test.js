import { describe, it, expect, vi } from 'vitest';
import { crearRegistroOyentes } from './registroOyentes';

function crearClienteFalso() {
  const oyentes = new Map();
  return {
    oyentes,
    on: vi.fn((evento, fn) => {
      if (!oyentes.has(evento)) oyentes.set(evento, new Set());
      oyentes.get(evento).add(fn);
      return vi.fn(() => {
        oyentes.get(evento)?.delete(fn);
      });
    }),
    emitir(evento, datos) {
      for (const fn of oyentes.get(evento) || []) {
        fn(datos);
      }
    },
  };
}

describe('crearRegistroOyentes', () => {
  it('agregar antes de conectar: se adjunta al cliente al llamar a conectar()', () => {
    const registro = crearRegistroOyentes();
    const fn = vi.fn();

    registro.agregar('order:created', fn);

    const cliente = crearClienteFalso();
    expect(cliente.on).not.toHaveBeenCalled();

    registro.conectar(cliente);

    expect(cliente.on).toHaveBeenCalledTimes(1);
    expect(cliente.on).toHaveBeenCalledWith('order:created', fn);

    cliente.emitir('order:created', { id: 1 });
    expect(fn).toHaveBeenCalledWith({ id: 1 });
  });

  it('agregar después de conectar: se adjunta al cliente en el momento', () => {
    const registro = crearRegistroOyentes();
    const cliente = crearClienteFalso();
    registro.conectar(cliente);

    const fn = vi.fn();
    registro.agregar('payment:confirmed', fn);

    expect(cliente.on).toHaveBeenCalledTimes(1);
    expect(cliente.on).toHaveBeenCalledWith('payment:confirmed', fn);

    cliente.emitir('payment:confirmed', { monto: 2000 });
    expect(fn).toHaveBeenCalledWith({ monto: 2000 });
  });

  it('baja antes de conectar: no se suscribe al conectar', () => {
    const registro = crearRegistroOyentes();
    const fn = vi.fn();

    const baja = registro.agregar('mesa:presencia', fn);
    baja();

    const cliente = crearClienteFalso();
    registro.conectar(cliente);

    expect(cliente.on).not.toHaveBeenCalled();
    cliente.emitir('mesa:presencia', { total: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('baja después de conectar: desuscribe del cliente activo y del registro', () => {
    const registro = crearRegistroOyentes();
    const cliente = crearClienteFalso();
    registro.conectar(cliente);

    const fn = vi.fn();
    const baja = registro.agregar('plato:disponibilidad', fn);

    expect(cliente.oyentes.get('plato:disponibilidad')?.has(fn)).toBe(true);

    baja();
    expect(cliente.oyentes.get('plato:disponibilidad')?.has(fn)).toBe(false);

    cliente.emitir('plato:disponibilidad', { id_plato: 1005 });
    expect(fn).not.toHaveBeenCalled();

    // Si se desconecta y vuelve a conectar otro cliente, fn ya no se vuelve a suscribir
    const cliente2 = crearClienteFalso();
    registro.conectar(cliente2);
    expect(cliente2.on).not.toHaveBeenCalled();
  });

  it('desconectar y conectar a un cliente nuevo: los oyentes pasan al nuevo y no quedan en el viejo', () => {
    const registro = crearRegistroOyentes();
    const fn = vi.fn();
    registro.agregar('order:status', fn);

    const cliente1 = crearClienteFalso();
    registro.conectar(cliente1);

    expect(cliente1.oyentes.get('order:status')?.has(fn)).toBe(true);

    // Desconectar cliente 1
    registro.desconectar();
    expect(cliente1.oyentes.get('order:status')?.has(fn)).toBe(false);

    // Conectar cliente 2: debe recibir el oyente registrado
    const cliente2 = crearClienteFalso();
    registro.conectar(cliente2);

    expect(cliente2.oyentes.get('order:status')?.has(fn)).toBe(true);

    cliente2.emitir('order:status', { estado: 'listo' });
    expect(fn).toHaveBeenCalledWith({ estado: 'listo' });

    // Cliente 1 no recibe emisiones
    cliente1.emitir('order:status', { estado: 'viejo' });
    expect(fn).not.toHaveBeenCalledWith({ estado: 'viejo' });
  });

  it('sin duplicados al registrar la misma función dos veces para el mismo evento', () => {
    const registro = crearRegistroOyentes();
    const fn = vi.fn();

    registro.agregar('cart:updated', fn);
    registro.agregar('cart:updated', fn);

    const cliente = crearClienteFalso();
    registro.conectar(cliente);

    // Set evita duplicados en registro
    expect(cliente.on).toHaveBeenCalledTimes(1);
  });

  it('en modo local (sin cliente conectado), agregar devuelve baja funcional sin errores', () => {
    const registro = crearRegistroOyentes();
    const fn = vi.fn();

    const baja = registro.agregar('test:local', fn);
    expect(typeof baja).toBe('function');
    expect(() => baja()).not.toThrow();
  });
});
