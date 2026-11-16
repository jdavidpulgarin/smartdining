import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiModule from '../services/api';
import {
  refrescarMenu,
  recargarMenu,
  obtenerMenuRaw,
  suscribirCambiosMenu,
  adaptarPlatoArmable,
  limpiarMarcasAgotadoLocal,
  actualizarDisponibilidadPlatoEnCache,
} from '../services/menuService';
import { avisosCambiosCarrito, unirAvisos, crearOyenteMenuActualizado, conservarAgotados } from './cambiosMenu';
import { enriquecerItems, buscarPlatoEnMenu } from './carritoCompartido';
import { crearDeduplicador } from './deduplicador';
import { constructorReducer, estadoInicial } from '../components/constructor/constructorReducer';

// Regresión: editar la Arepa Rellena (nombre, precio, descripción, imagen o una
// opción) no le llegaba al comensal hasta recargar. Con menu:actualizado
// (EVENTS.md §5.8) la PWA vuelve a pedir GET /menu, repinta Menú, Constructor y
// Carrito sin recargar, y avisa si una línea del carrito cambió de precio o su
// plato salió de la carta.

const arepa = (extra = {}) => ({
  id_plato: 1003, nombre: 'Arepa Rellena', descripcion: 'La de siempre', precio: 15000,
  url_imagen: 'https://images.unsplash.com/photo-1?w=600', personalizable: true, disponible: true,
  pasos: [{
    id_paso: 301, nombre: 'Tipo de Arepa', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true,
    ingredientes: [
      { id_ingrediente: 29, nombre: 'Arepa de Maíz', precio_extra: 0, disponible: true },
      { id_ingrediente: 30, nombre: 'Arepa de Chócolo', precio_extra: 1500, disponible: true },
    ],
  }],
  ...extra,
});
const limonada = (extra = {}) => ({ id_plato: 1020, nombre: 'Limonada de Coco', precio: 8000, disponible: true, personalizable: false, ...extra });
const menu = (platos) => ({ categorias: [{ id_categoria: 100, categoria: 'Arma tu plato', platos }] });

const V1 = menu([arepa(), limonada()]);
const V2 = menu([
  arepa({
    nombre: 'Arepa Rellena Especial', precio: 16500, descripcion: 'Receta nueva', url_imagen: 'https://images.unsplash.com/photo-2?w=600',
    pasos: [{ ...arepa().pasos[0], ingredientes: [arepa().pasos[0].ingredientes[0], { id_ingrediente: 30, nombre: 'Arepa de Chócolo Dulce', precio_extra: 2000, disponible: true }] }],
  }),
]);

// Carrito compartido: Ana pidió una arepa con chócolo extra y dos limonadas.
const ITEMS = [
  { id_linea: 'l-1', id_plato: 1003, cantidad: 1, comensal: 'Ana', ingredientes: [{ id_ingrediente: 30, porcion: 'extra' }] },
  { id_linea: 'l-2', id_plato: 1020, cantidad: 2, comensal: 'Ana', ingredientes: [] },
];

describe('avisosCambiosCarrito', () => {
  it('avisa el precio nuevo de la línea y que la limonada salió de la carta', () => {
    const antes = enriquecerItems(ITEMS, V1, 'Ana');
    const despues = enriquecerItems(ITEMS, V2, 'Ana');
    expect(antes[0].precioUnitario).toBe(16500); // 15000 + 1500
    expect(despues[0].precioUnitario).toBe(18500); // 16500 + 2000
    const avisos = avisosCambiosCarrito(antes, despues, (id) => Boolean(buscarPlatoEnMenu(V2, id)));
    expect(avisos.map((a) => [a.tipo, a.id_plato])).toEqual([['precio', 1003], ['retirado', 1020]]);
    expect(avisos[0].texto).toMatch(/«Arepa Rellena Especial» cambió de precio: ahora \$\s?18\.500 \(antes \$\s?16\.500\)/);
    expect(avisos[1].texto).toMatch(/«Limonada de Coco» ya no está en la carta/);
  });

  it('sin cambios de precio ni platos retirados no avisa (solo cambió el nombre o la imagen)', () => {
    const soloNombre = menu([arepa({ nombre: 'Otra' }), limonada({ url_imagen: 'https://x/y.webp' })]);
    const antes = enriquecerItems(ITEMS, V1, 'Ana');
    expect(avisosCambiosCarrito(antes, enriquecerItems(ITEMS, soloNombre, 'Ana'), () => true)).toEqual([]);
  });

  it('un aviso por plato aunque esté en varias líneas; una línea que ya no está no avisa', () => {
    const dos = [...ITEMS, { ...ITEMS[0], id_linea: 'l-3', comensal: 'Beto' }];
    const antes = enriquecerItems(dos, V1, 'Ana');
    const despues = enriquecerItems(dos.slice(1), V2, 'Ana');
    const avisos = avisosCambiosCarrito(antes, despues, (id) => Boolean(buscarPlatoEnMenu(V2, id)));
    expect(avisos.filter((a) => a.tipo === 'precio')).toHaveLength(1);
    expect(avisosCambiosCarrito(null, despues)).toEqual([]);
  });

  it('unirAvisos: el nuevo del mismo plato y tipo reemplaza al viejo', () => {
    const a = { clave: 'precio:1', texto: 'viejo' };
    const b = { clave: 'retirado:2', texto: 'otro' };
    expect(unirAvisos([a, b], [{ clave: 'precio:1', texto: 'nuevo' }])).toEqual([b, { clave: 'precio:1', texto: 'nuevo' }]);
    expect(unirAvisos([a], [])).toEqual([a]);
  });
});

describe('refrescarMenu + oyente de menu:actualizado (con GET /menu simulado)', () => {
  let respuesta;
  let pedidos;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
    limpiarMarcasAgotadoLocal();
    recargarMenu();
    pedidos = 0;
    respuesta = V1;
    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async (ruta) => {
      if (ruta !== '/menu') throw new Error(`ruta inesperada ${ruta}`);
      pedidos += 1;
      return structuredClone(respuesta);
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('obtenerMenuRaw guarda el menú en memoria; refrescarMenu lo vuelve a pedir y avisa a los suscritos', async () => {
    await obtenerMenuRaw();
    respuesta = V2;
    expect((await obtenerMenuRaw()).categorias[0].platos[0].nombre).toBe('Arepa Rellena'); // sigue en memoria
    expect(pedidos).toBe(1);
    const vistos = [];
    const baja = suscribirCambiosMenu((m) => vistos.push(m.categorias[0].platos[0].nombre));
    const nuevo = await refrescarMenu();
    baja();
    expect(pedidos).toBe(2);
    expect(nuevo.categorias[0].platos[0].nombre).toBe('Arepa Rellena Especial');
    expect(vistos).toEqual(['Arepa Rellena Especial']);
    // El Constructor, suscrito, arma el plato nuevo con la opción renombrada.
    const plato = adaptarPlatoArmable(nuevo, 1003);
    expect([plato.nombre, plato.precio, plato.pasos[0].ingredientes[1].nombre]).toEqual(['Arepa Rellena Especial', 16500, 'Arepa de Chócolo Dulce']);
  });

  it('el oyente: refresca, entrega el menú, avisa los cambios del carrito y deduplica por eventId', async () => {
    let menuActual = await obtenerMenuRaw();
    const avisados = [];
    const oyente = crearOyenteMenuActualizado({
      refrescar: refrescarMenu,
      leerAntes: () => enriquecerItems(ITEMS, menuActual, 'Ana'),
      enriquecer: (m) => enriquecerItems(ITEMS, m, 'Ana'),
      estaEnCarta: (m, id) => Boolean(buscarPlatoEnMenu(m, id)),
      alRecibirMenu: (m) => { menuActual = m; },
      alAvisar: (a) => avisados.push(...a),
      deduplicador: crearDeduplicador(),
    });
    respuesta = V2;
    const ev = { eventId: '7d3f0c52-8a41-4e6b-b1f7-3c9a2e5d6f10', id_plato: 1003, accion: 'plato-editado' };
    const avisos = await oyente(ev);
    expect(pedidos).toBe(2);
    expect(menuActual.categorias[0].platos[0].nombre).toBe('Arepa Rellena Especial');
    expect(avisos.map((a) => a.tipo)).toEqual(['precio', 'retirado']);
    expect(avisados).toHaveLength(2);
    // Repetido: no vuelve a pedir.
    expect(await oyente(ev)).toBeNull();
    expect(pedidos).toBe(2);
  });

  it('el oyente nunca rechaza: si GET /menu falla, lo deja en el log', async () => {
    apiModule.pedirJson.mockRejectedValueOnce(new Error('sin red'));
    const log = { error: vi.fn() };
    const oyente = crearOyenteMenuActualizado({
      refrescar: refrescarMenu, leerAntes: () => [], enriquecer: () => [], estaEnCarta: () => true,
      alRecibirMenu: vi.fn(), alAvisar: vi.fn(), deduplicador: crearDeduplicador(), log,
    });
    await expect(oyente({ eventId: 'a' })).resolves.toBeNull();
    expect(log.error).toHaveBeenCalled();
  });
});

describe('constructorReducer: PODAR_SELECCIONES (la carta cambió en el Constructor)', () => {
  it('suelta las opciones que ya no existen o se agotaron y conserva las demás', () => {
    const estado = { ...estadoInicial, selecciones: { 301: { 30: 'normal' }, 302: { 40: 'extra', 41: 'normal' }, 999: { 5: 'normal' } } };
    const plato = {
      pasos: [
        { id_paso: 301, ingredientes: [{ id_ingrediente: 29, disponible: true }] },
        { id_paso: 302, ingredientes: [{ id_ingrediente: 40, disponible: true }, { id_ingrediente: 41, disponible: false }] },
      ],
    };
    const nuevo = constructorReducer(estado, { type: 'PODAR_SELECCIONES', plato });
    expect(nuevo.selecciones).toEqual({ 301: {}, 302: { 40: 'extra' } });
  });

  it('si todo sigue existiendo devuelve el mismo estado (sin repintar)', () => {
    const estado = { ...estadoInicial, selecciones: { 301: { 30: 'normal' } } };
    const plato = { pasos: [{ id_paso: 301, ingredientes: [{ id_ingrediente: 30, disponible: true }] }] };
    expect(constructorReducer(estado, { type: 'PODAR_SELECCIONES', plato })).toBe(estado);
  });
});

describe('conservarAgotados: volver a pedir el menú no borra lo que el comensal ya veía AGOTADO', () => {
  const agotada = { ...limonada(), disponible: false };

  it('un plato marcado agotado que el servidor ya no trae se conserva (marcado) en su categoría', () => {
    const anterior = menu([arepa(), agotada]);
    const servidor = menu([arepa({ nombre: 'Arepa Rellena Especial' })]);
    const r = conservarAgotados(anterior, servidor);
    expect(r.categorias[0].platos.map((p) => [p.nombre, p.disponible])).toEqual([['Arepa Rellena Especial', true], ['Limonada de Coco', false]]);
  });

  it('lo que el servidor trae manda; un plato que estaba disponible y ya no viene, no vuelve; los de olvidar tampoco', () => {
    expect(conservarAgotados(menu([agotada]), menu([limonada()])).categorias[0].platos[0].disponible).toBe(true);
    expect(conservarAgotados(menu([arepa(), limonada()]), menu([arepa()])).categorias[0].platos).toHaveLength(1);
    expect(conservarAgotados(menu([arepa(), agotada]), menu([arepa()]), [1020]).categorias[0].platos).toHaveLength(1);
  });

  it('una categoría que el servidor ya no trae vuelve con sus agotados; sin nada que conservar devuelve el mismo menú', () => {
    const otra = { id_categoria: 200, categoria: 'Bebidas', platos: [{ ...agotada, id_plato: 2001, nombre: 'Jugo de Mora' }] };
    const r = conservarAgotados({ categorias: [V1.categorias[0], otra] }, V1);
    expect(r.categorias.map((c) => c.categoria)).toEqual(['Arma tu plato', 'Bebidas']);
    expect(conservarAgotados(V1, V2)).toBe(V2);
    expect(conservarAgotados(null, V2)).toBe(V2);
  });
});

describe('refrescarMenu conserva los agotados del menú en memoria (demo G-08, paso 7)', () => {
  let respuesta;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
    limpiarMarcasAgotadoLocal();
    recargarMenu();
    respuesta = V1;
    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async () => structuredClone(respuesta));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('la limonada se agotó (plato:disponibilidad) y el servidor ya no la trae: sigue en la carta como agotada', async () => {
    await obtenerMenuRaw();
    actualizarDisponibilidadPlatoEnCache(1020, false);
    respuesta = menu([arepa()]); // GET /menu sin la limonada (sin stock)
    const nuevo = await refrescarMenu();
    expect(nuevo.categorias[0].platos.map((p) => [p.id_plato, p.disponible])).toEqual([[1003, true], [1020, false]]);
  });

  it('con olvidar (plato-eliminado) el agotado borrado no vuelve; recargarMenu a secas no conserva nada', async () => {
    await obtenerMenuRaw();
    actualizarDisponibilidadPlatoEnCache(1020, false);
    respuesta = menu([arepa()]);
    expect((await refrescarMenu({ olvidar: [1020] })).categorias[0].platos).toHaveLength(1);
    recargarMenu();
    expect((await obtenerMenuRaw()).categorias[0].platos).toHaveLength(1);
  });

  it('el oyente olvida el plato borrado (accion plato-eliminado)', async () => {
    const refrescar = vi.fn(async () => V1);
    const oyente = crearOyenteMenuActualizado({
      refrescar, leerAntes: () => [], enriquecer: () => [], estaEnCarta: () => true,
      alRecibirMenu: () => {}, alAvisar: () => {}, deduplicador: crearDeduplicador(),
    });
    await oyente({ eventId: 'e1', id_plato: 1020, accion: 'plato-eliminado' });
    await oyente({ eventId: 'e2', id_plato: 1003, accion: 'plato-editado' });
    expect(refrescar.mock.calls).toEqual([[{ olvidar: [1020] }], [undefined]]);
  });
});
