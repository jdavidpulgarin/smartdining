import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { crearPedido } from './pedidoService';
import * as apiModule from './api';
import { CLAVE_SESION } from '../utils/sesion';

describe('pedidoService (H-05, H-06)', () => {
  let store = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    store = {};

    globalThis.sessionStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, val) => {
        store[key] = String(val);
      },
      clear: () => {
        store = {};
      },
    };
    globalThis.window = globalThis;
  });

  afterEach(() => {
    delete globalThis.sessionStorage;
    delete globalThis.window;
  });

  it('H-05: no incluye comensal ni apodo en los items enviados al backend', async () => {
    globalThis.sessionStorage.setItem(
      CLAVE_SESION,
      JSON.stringify({ token: 'jwt.comensal.ana', comensal: 'Ana' })
    );

    const spyPedirJson = vi
      .spyOn(apiModule, 'pedirJson')
      .mockResolvedValue({ id_pedido: 10, total: 25000 });

    const lineas = [
      {
        id_linea: 'linea-1',
        id_plato: 5,
        cantidad: 2,
        comensal: 'Ana', // Provisto en el cliente para la UI
        apodo: 'Ana',
        notas: 'Sin cebolla',
      },
    ];

    const res = await crearPedido({ lineas });

    expect(spyPedirJson).toHaveBeenCalledTimes(1);
    const [ruta, opciones] = spyPedirJson.mock.calls[0];

    expect(ruta).toBe('/pedidos');
    expect(opciones.method).toBe('POST');
    expect(opciones.token).toBe('jwt.comensal.ana');

    // Comprobar que en body.items NO se manda 'comensal' ni 'apodo' (H-05)
    expect(opciones.body.items[0]).toEqual({
      id_plato: 5,
      cantidad: 2,
      notas: 'Sin cebolla',
    });
    expect(opciones.body.items[0].comensal).toBeUndefined();
    expect(opciones.body.items[0].apodo).toBeUndefined();
    expect(res).toEqual({ id_pedido: 10, total: 25000 });
  });

  it('H-06: acota la cantidad entre 1 y 20 por item', async () => {
    globalThis.sessionStorage.setItem(
      CLAVE_SESION,
      JSON.stringify({ token: 'jwt.token' })
    );

    const spyPedirJson = vi
      .spyOn(apiModule, 'pedirJson')
      .mockResolvedValue({ ok: true });

    await crearPedido({
      lineas: [
        { id_plato: 1, cantidad: 0 },
        { id_plato: 2, cantidad: 99 },
      ],
    });

    const body = spyPedirJson.mock.calls[0][1].body;
    expect(body.items[0].cantidad).toBe(1);
    expect(body.items[1].cantidad).toBe(20);
  });

  it('H-06: rechaza pedidos con mas de 50 items', async () => {
    const muchasLineas = Array.from({ length: 51 }, (_, i) => ({
      id_plato: i + 1,
      cantidad: 1,
    }));

    await expect(crearPedido({ lineas: muchasLineas })).rejects.toThrow(
      /no puede contener más de 50 ítems/
    );
  });
});
