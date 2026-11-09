import { describe, it, expect } from 'vitest'
import {
  leerNumero,
  formatoCantidad,
  estadoDeInsumo,
  ordenarInsumos,
  resumenInsumos,
  filtrarInsumos,
  validarInsumo,
  cambiosDeInsumo,
  validarMovimiento,
  notaDeMovimiento,
  textoDeAlerta,
} from '../inventario'

// Forma real de GET /inventario/insumos (api-spec, D-17 PR 2).
const insumo = (id, nombre, stock_actual, stock_minimo, extra = {}) => ({
  id_insumo: id,
  nombre,
  unidad: 'g',
  stock_actual,
  stock_minimo,
  activo: true,
  bajo: stock_actual <= stock_minimo,
  agotado: stock_actual === 0,
  actualizado_en: '2026-11-08T12:00:00.000Z',
  ...extra,
})

const lista = [
  insumo(1, 'Queso cheddar', 3000, 500),
  insumo(2, 'Arepa de chócolo', 2, 4, { unidad: 'unidad' }),
  insumo(3, 'Carne Angus 200 g', 0, 2, { unidad: 'porcion' }),
  insumo(4, 'Aceite de trufa', 250, 50, { activo: false }),
  insumo(5, 'Aguacate', 3000, 500),
]

describe('utils/inventario', () => {
  it('leerNumero: acepta coma y hasta 2 decimales; nunca signo', () => {
    expect(leerNumero('12,5')).toBe(12.5)
    expect(leerNumero('0')).toBe(0)
    expect(leerNumero('1.234')).toBeNull()
    expect(leerNumero('-3')).toBeNull()
    expect(leerNumero('')).toBeNull()
  })

  it('formatoCantidad: unidad corta y sin decimales de más', () => {
    expect(formatoCantidad(450, 'g')).toBe('450 g')
    expect(formatoCantidad(2.5, 'porcion')).toMatch(/^2,5 porc\.$/)
    expect(formatoCantidad('x', 'g')).toBe('—')
  })

  it('estadoDeInsumo: inactivo manda; luego agotado, bajo y ok (con lo que calcula el servidor)', () => {
    expect(lista.map(estadoDeInsumo)).toEqual(['ok', 'bajo', 'agotado', 'inactivo', 'ok'])
    // Sin bajo/agotado del servidor, los deduce con la misma regla que v_stock_bajo.
    expect(estadoDeInsumo({ stock_actual: 5, stock_minimo: 5, activo: true })).toBe('bajo')
  })

  it('ordenarInsumos: agotados, bajos, el resto por nombre y los inactivos al final', () => {
    expect(ordenarInsumos(lista).map((i) => i.id_insumo)).toEqual([3, 2, 5, 1, 4])
  })

  it('resumenInsumos: cuenta solo activos; los agotados también están bajo el mínimo', () => {
    expect(resumenInsumos(lista)).toEqual({ bajo: 2, agotado: 1 })
  })

  it('filtrarInsumos: activos, bajo el mínimo, inactivos y búsqueda sin tildes', () => {
    expect(filtrarInsumos(lista).map((i) => i.id_insumo)).toEqual([1, 2, 3, 5])
    expect(filtrarInsumos(lista, { filtro: 'bajo' }).map((i) => i.id_insumo)).toEqual([2, 3])
    expect(filtrarInsumos(lista, { filtro: 'inactivos' }).map((i) => i.id_insumo)).toEqual([4])
    expect(filtrarInsumos(lista, { busqueda: 'CHOCOLO' }).map((i) => i.id_insumo)).toEqual([2])
  })

  it('validarInsumo: alta con stock inicial opcional (> 0) y edición con activo', () => {
    expect(validarInsumo({ nombre: ' Queso ', unidad: 'g', stock_minimo: '', stock_inicial: '' }, { nuevo: true }))
      .toEqual({ datos: { nombre: 'Queso', unidad: 'g', stock_minimo: 0 } })
    expect(validarInsumo({ nombre: 'Queso', unidad: 'g', stock_minimo: '500', stock_inicial: '2000,5' }, { nuevo: true }))
      .toEqual({ datos: { nombre: 'Queso', unidad: 'g', stock_minimo: 500, stock_inicial: 2000.5 } })
    expect(validarInsumo({ nombre: 'Queso', unidad: 'g', stock_minimo: '5', activo: false }))
      .toEqual({ datos: { nombre: 'Queso', unidad: 'g', stock_minimo: 5, activo: false } })

    expect(validarInsumo({ nombre: '', unidad: 'g' }).error).toMatch(/obligatorio/)
    expect(validarInsumo({ nombre: 'x'.repeat(81), unidad: 'g' }).error).toMatch(/80/)
    expect(validarInsumo({ nombre: 'Queso', unidad: 'kg' }).error).toMatch(/unidad/)
    expect(validarInsumo({ nombre: 'Queso', unidad: 'g', stock_minimo: '-1' }).error).toMatch(/mínimo/)
    expect(validarInsumo({ nombre: 'Queso', unidad: 'g', stock_inicial: '0' }, { nuevo: true }).error).toMatch(/mayor que 0/)
  })

  it('cambiosDeInsumo: solo lo que cambió, y nunca el stock', () => {
    const original = lista[0]
    expect(cambiosDeInsumo(original, { nombre: 'Queso cheddar', unidad: 'g', stock_minimo: 500, activo: true })).toEqual({})
    const cambios = cambiosDeInsumo(original, { nombre: 'Queso cheddar', unidad: 'g', stock_minimo: 800, activo: false })
    expect(cambios).toEqual({ stock_minimo: 800, activo: false })
    expect(cambios).not.toHaveProperty('stock_actual')
  })

  it('validarMovimiento: entrada suma, con motivo opcional', () => {
    expect(validarMovimiento({ tipo: 'entrada', cantidad: '1500' }, 3000))
      .toEqual({ datos: { tipo: 'entrada', cantidad: 1500 }, resultante: 4500 })
    expect(validarMovimiento({ tipo: 'entrada', cantidad: '0' }, 3000).error).toMatch(/mayor que 0/)
  })

  it('validarMovimiento: merma resta, no más de lo que hay y con motivo obligatorio', () => {
    expect(validarMovimiento({ tipo: 'merma', cantidad: '50', motivo: '' }, 450).error).toMatch(/motivo es obligatorio/)
    expect(validarMovimiento({ tipo: 'merma', cantidad: '500', motivo: 'Se cayó' }, 450).error).toMatch(/más de lo que hay/)
    expect(validarMovimiento({ tipo: 'merma', cantidad: '50', motivo: ' Se cayó ' }, 450))
      .toEqual({ datos: { tipo: 'merma', cantidad: 50, motivo: 'Se cayó' }, resultante: 400 })
  })

  it('validarMovimiento: el ajuste se pide como conteo y viaja como diferencia con signo', () => {
    expect(validarMovimiento({ tipo: 'ajuste', contado: '1,5', motivo: 'Conteo' }, 4))
      .toEqual({ datos: { tipo: 'ajuste', cantidad: -2.5, motivo: 'Conteo' }, resultante: 1.5 })
    expect(validarMovimiento({ tipo: 'ajuste', contado: '10', motivo: 'Conteo' }, 4).datos.cantidad).toBe(6)
    expect(validarMovimiento({ tipo: 'ajuste', contado: '4', motivo: 'Conteo' }, 4).error).toMatch(/coincide/)
    expect(validarMovimiento({ tipo: 'ajuste', contado: '3', motivo: '' }, 4).error).toMatch(/motivo es obligatorio/)
    expect(validarMovimiento({ tipo: 'ajuste', contado: '', motivo: 'x' }, 4).error).toMatch(/contado/)
    // Sin errores de coma flotante: 0.3 - 0.1 da 0.2 exacto.
    expect(validarMovimiento({ tipo: 'ajuste', contado: '0.3', motivo: 'x' }, 0.1).datos.cantidad).toBe(0.2)
  })

  it('notaDeMovimiento y textoDeAlerta', () => {
    expect(notaDeMovimiento({ tipo: 'merma', cantidad: 0, id_detalle: 701, motivo: 'Cancelado…' })).toMatch(/ya se había descontado/)
    expect(notaDeMovimiento({ tipo: 'merma', cantidad: -50, id_detalle: null, motivo: 'Se cayó' })).toBe('Se cayó')
    expect(textoDeAlerta({ nombre: 'Queso costeño', unidad: 'g', stock_actual: 450, stock_minimo: 500, agotado: false }))
      .toBe('Queso costeño: bajo el mínimo (450 g de 500 g)')
    expect(textoDeAlerta({ nombre: 'Masa', unidad: 'porcion', stock_actual: 0, stock_minimo: 10, agotado: true })).toBe('Masa: AGOTADO')
  })
})
