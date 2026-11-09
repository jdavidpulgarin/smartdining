import { describe, it, expect } from 'vitest'
import {
  disponibilidadEnCarta,
  estadoDeReceta,
  resumenCarta,
  filtrarCarta,
  agruparPorCategoria,
  agruparOpciones,
  filasDeReceta,
  validarReceta,
  textoDeDesactivar,
} from '../inventario'

// Forma real de GET /inventario/carta (api-spec, D-17 PR 3).
const plato = (id, nombre, categoria, extra = {}) => ({
  id, nombre, categoria, personalizable: false, disponible: true, stock_suficiente: true,
  disponible_efectivo: true, motivo: null, tiene_receta: true, ...extra,
})
const opcion = (id, nombre, id_plato, platoNombre, id_paso, paso, paso_orden, extra = {}) => ({
  id, nombre, id_plato, plato: platoNombre, id_paso, paso, paso_orden, disponible: true, stock_suficiente: true,
  disponible_efectivo: true, motivo: null, tiene_receta: true, ...extra,
})

const carta = {
  platos: [
    plato(1001, 'Bowl Personalizado', 'Arma tu plato', { personalizable: true, tiene_receta: false }),
    plato(8, 'Costillas BBQ', 'Fuertes', { tiene_receta: false }),
    plato(7, 'Hamburguesa', 'Fuertes'),
  ],
  ingredientes: [
    opcion(10, 'Salsa de Ajo', 1001, 'Bowl Personalizado', 104, 'Elige tu Salsa', 4, { tiene_receta: false }),
    opcion(11, 'Arroz Integral', 1001, 'Bowl Personalizado', 101, 'Elige tu Base', 1),
    opcion(12, 'Salsa de Ajo', 1002, 'Wrap Personalizado', 204, 'Elige tu Salsa', 4),
  ],
}

describe('utils/inventario · recetas', () => {
  it('disponibilidadEnCarta: disponible, apagado a mano o sin stock', () => {
    expect(disponibilidadEnCarta(plato(1, 'x', 'y')).texto).toBe('DISPONIBLE')
    expect(disponibilidadEnCarta(plato(1, 'x', 'y', { disponible_efectivo: false, motivo: 'manual' })).texto).toBe('APAGADO A MANO')
    expect(disponibilidadEnCarta(plato(1, 'x', 'y', { disponible_efectivo: false, motivo: 'stock' })).texto).toBe('SIN STOCK')
  })

  it('estadoDeReceta: un personalizable sin receta "consume por sus opciones" y no es un faltante', () => {
    expect(estadoDeReceta(carta.platos[0], 'plato')).toMatchObject({ texto: 'CONSUME POR SUS OPCIONES', falta: false })
    expect(estadoDeReceta(carta.platos[1], 'plato')).toMatchObject({ texto: 'SIN RECETA', falta: true })
    expect(estadoDeReceta(carta.platos[2], 'plato')).toMatchObject({ texto: 'CON RECETA', falta: false })
    // Una opción sin receta sí es un faltante (no hay "personalizable" en las opciones).
    expect(estadoDeReceta(carta.ingredientes[0], 'ingrediente').falta).toBe(true)
  })

  it('resumenCarta y filtrarCarta (solo lo que falta, búsqueda sin tildes por nombre, plato o paso)', () => {
    expect(resumenCarta(carta)).toEqual({ platos: 1, opciones: 1 })
    const faltantes = filtrarCarta(carta, { soloFaltantes: true })
    expect(faltantes.platos.map((p) => p.id)).toEqual([8])
    expect(faltantes.ingredientes.map((i) => i.id)).toEqual([10])
    expect(filtrarCarta(carta, { busqueda: 'wráp' }).ingredientes.map((i) => i.id)).toEqual([12])
    expect(filtrarCarta(carta, { busqueda: 'base' }).ingredientes.map((i) => i.id)).toEqual([11])
  })

  it('agruparPorCategoria respeta el orden del servidor', () => {
    expect(agruparPorCategoria(carta.platos).map((g) => [g.categoria, g.platos.map((p) => p.id)])).toEqual([
      ['Arma tu plato', [1001]],
      ['Fuertes', [8, 7]],
    ])
  })

  it('agruparOpciones agrupa por id_paso (no por nombre) y ordena los pasos por paso_orden', () => {
    const grupos = agruparOpciones(carta.ingredientes)
    expect(grupos.map((g) => g.id_plato)).toEqual([1001, 1002])
    expect(grupos[0].pasos.map((p) => [p.id_paso, p.paso_orden])).toEqual([[101, 1], [104, 4]])
    // "Elige tu Salsa" del Bowl y del Wrap son pasos distintos aunque se llamen igual.
    expect(grupos[1].pasos.map((p) => p.id_paso)).toEqual([204])
  })

  it('filasDeReceta y validarReceta: el PUT lleva la receta completa, sin repetidos y con cantidades > 0', () => {
    const insumos = [{ id_insumo: 1, nombre: 'Queso cheddar' }, { id_insumo: 3, nombre: 'Carne Angus' }]
    expect(filasDeReceta([{ id_insumo: 3, cantidad: 1.5 }])).toEqual([{ id_insumo: '3', cantidad: '1.5' }])
    expect(validarReceta([{ id_insumo: '3', cantidad: '1' }, { id_insumo: '1', cantidad: '40,5' }], insumos))
      .toEqual({ datos: { insumos: [{ id_insumo: 3, cantidad: 1 }, { id_insumo: 1, cantidad: 40.5 }] } })
    expect(validarReceta([], insumos)).toEqual({ datos: { insumos: [] } })
    expect(validarReceta([{ id_insumo: '', cantidad: '1' }], insumos).error).toMatch(/Fila 1: elige el insumo/)
    expect(validarReceta([{ id_insumo: '1', cantidad: '0' }], insumos).error).toMatch(/Queso cheddar.*mayor que 0/)
    expect(validarReceta([{ id_insumo: '1', cantidad: '1' }, { id_insumo: '1', cantidad: '2' }], insumos).error).toMatch(/dos veces/)
  })

  it('textoDeDesactivar: nombra lo que se apaga, dice si no se usa, y sin /usos da el aviso genérico', () => {
    const usos = {
      platos: [{ id: 7, nombre: 'Hamburguesa', cantidad: 40 }],
      ingredientes: [{ id: 40, nombre: 'Queso Rallado', plato: 'Bowl', paso: 'Toppings', cantidad: 40 }],
    }
    expect(textoDeDesactivar('Queso', usos)).toBe(
      '¿Desactivar "Queso"? Se marcarán como no disponibles hasta que lo vuelvas a activar:\n- Hamburguesa\n- Bowl · Toppings · Queso Rallado'
    )
    expect(textoDeDesactivar('Sal', { platos: [], ingredientes: [] })).toMatch(/No lo usa ninguna receta/)
    expect(textoDeDesactivar('Sal', null)).toMatch(/Los platos y opciones que lo usan/)
  })
})
