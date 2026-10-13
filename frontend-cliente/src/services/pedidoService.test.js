import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { crearPedido, NOTAS_MAX_SERVIDOR, NOTAS_GENERALES_MAX_SERVIDOR } from './pedidoService';
import * as apiModule from './api';
import { CLAVE_SESION } from '../utils/sesion';

describe('pedidoService (H-05, H-06, J-05)', () => {
  let store = {};

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
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
    vi.unstubAllEnvs();
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
        comensal: 'Ana',
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

  it('J-05: mapea ingredientes de platos armados desde el constructor (linea.ingredientes)', async () => {
    const spyPedirJson = vi
      .spyOn(apiModule, 'pedirJson')
      .mockResolvedValue({ id_pedido: 12, total: 30000 });

    const lineas = [
      {
        id_linea: 'linea-armada',
        id_plato: 1001,
        cantidad: 1,
        precioUnitario: 30000,
        precio: 30000,
        subtotal: 30000,
        comensal: 'Carlos',
        apodo: 'Carlos',
        id_mesa: 5,
        ingredientes: [
          { id_ingrediente: 10, porcion: 'extra' },
          { id_ingrediente: 15, porcion: 'ligera' },
        ],
        detalle: [{ nombre: 'Arroz' }],
      },
    ];

    await crearPedido({ lineas });

    const body = spyPedirJson.mock.calls[0][1].body;
    const item = body.items[0];

    expect(item).toEqual({
      id_plato: 1001,
      cantidad: 1,
      ingredientes: [
        { id_ingrediente: 10, porcion: 'extra' },
        { id_ingrediente: 15, porcion: 'ligera' },
      ],
    });
    // Verifica que no se filtran precios, mesa ni comensal
    expect(item.precio).toBeUndefined();
    expect(item.precioUnitario).toBeUndefined();
    expect(item.precio_unitario).toBeUndefined();
    expect(item.subtotal).toBeUndefined();
    expect(item.total).toBeUndefined();
    expect(item.comensal).toBeUndefined();
    expect(item.apodo).toBeUndefined();
    expect(item.id_mesa).toBeUndefined();
    expect(body.id_mesa).toBeUndefined();
    expect(body.total).toBeUndefined();
  });

  it('J-05: omite la propiedad ingredientes si el plato no tiene ingredientes', async () => {
    const spyPedirJson = vi
      .spyOn(apiModule, 'pedirJson')
      .mockResolvedValue({ id_pedido: 15, total: 10000 });

    const lineas = [
      {
        id_plato: 50,
        cantidad: 1,
        ingredientes: [],
      },
    ];

    await crearPedido({ lineas });
    const item = spyPedirJson.mock.calls[0][1].body.items[0];

    expect(item.id_plato).toBe(50);
    expect(item.cantidad).toBe(1);
    expect('ingredientes' in item).toBe(false);
  });

  it('J-05: rechaza platos con mas de 20 ingredientes o con ingredientes repetidos', async () => {
    const masDe20 = Array.from({ length: 21 }, (_, i) => ({
      id_ingrediente: i + 1,
      porcion: 'normal',
    }));

    await expect(
      crearPedido({
        lineas: [{ id_plato: 1, cantidad: 1, ingredientes: masDe20 }],
      })
    ).rejects.toThrow(/no puede superar 20 ingredientes/);

    const repetidos = [
      { id_ingrediente: 5, porcion: 'normal' },
      { id_ingrediente: 5, porcion: 'extra' },
    ];

    await expect(
      crearPedido({
        lineas: [{ id_plato: 1, cantidad: 1, ingredientes: repetidos }],
      })
    ).rejects.toThrow(/repetir ingredientes/);
  });

  it('J-05: corta notas individuales a 200 y notas generales a 500 caracteres', async () => {
    const spyPedirJson = vi
      .spyOn(apiModule, 'pedirJson')
      .mockResolvedValue({ id_pedido: 20 });

    const notaLarga = 'A'.repeat(300);
    const notasGenLarga = 'B'.repeat(600);

    await crearPedido({
      lineas: [{ id_plato: 1, cantidad: 1, notas: notaLarga }],
      notasGenerales: notasGenLarga,
    });

    const body = spyPedirJson.mock.calls[0][1].body;
    expect(body.items[0].notas.length).toBe(NOTAS_MAX_SERVIDOR);
    expect(body.notas_generales.length).toBe(NOTAS_GENERALES_MAX_SERVIDOR);
  });

  it('J-05: en modo simulado delega en crearPedidoSimulado', async () => {
    vi.stubEnv('VITE_MODO_SIMULADO', 'true');

    const res = await crearPedido({
      lineas: [
        { id_plato: 1, cantidad: 2, precioUnitario: 15000 },
        { id_plato: 2, cantidad: 1, precioUnitario: 20000 },
      ],
    });

    expect(res).toHaveProperty('id_pedido');
    expect(res).toHaveProperty('codigo_pedido');
    expect(res.codigo_pedido).toMatch(/^PED-[A-Z0-9]{4}$/);
    expect(res.total).toBe(50000);
    expect(res.estado).toBe('recibido');
  });

  it('J-05: en modo simulado lanza 409 si alguna nota dice "agotado"', async () => {
    vi.stubEnv('VITE_MODO_SIMULADO', 'true');

    await expect(
      crearPedido({
        lineas: [{ id_plato: 1, cantidad: 1, notas: 'con salsa, pero si está agotado no' }],
      })
    ).rejects.toMatchObject({
      status: 409,
      motivo: 'agotado',
    });
  });
});
