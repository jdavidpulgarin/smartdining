import { describe, it, expect } from 'vitest'
import {
  estadoDisponibilidad,
  confirmacionAlCambiar,
  ETIQUETA_DISPONIBILIDAD,
  DISPONIBLE,
  SIN_STOCK,
  NO_DISPONIBLE,
} from '../disponibilidadPlato'

describe('estadoDisponibilidad (T8)', () => {
  it('encendido y con stock: disponible', () => {
    expect(estadoDisponibilidad({ available: true, stockOk: true })).toBe(DISPONIBLE)
  })
  it('encendido sin stock: agotado por inventario', () => {
    expect(estadoDisponibilidad({ available: true, stockOk: false })).toBe(SIN_STOCK)
  })
  it('apagado a mano: no disponible, tenga o no stock', () => {
    expect(estadoDisponibilidad({ available: false, stockOk: true })).toBe(NO_DISPONIBLE)
    expect(estadoDisponibilidad({ available: false, stockOk: false })).toBe(NO_DISPONIBLE)
  })
  it('sin datos: disponible (como el backend, que no manda el campo si es true)', () => {
    expect(estadoDisponibilidad({})).toBe(DISPONIBLE)
  })
  it('las etiquetas distinguen la causa', () => {
    expect(ETIQUETA_DISPONIBILIDAD[NO_DISPONIBLE]).toBe('NO DISPONIBLE')
    expect(ETIQUETA_DISPONIBILIDAD[SIN_STOCK]).toBe('AGOTADO · SIN STOCK')
    expect(ETIQUETA_DISPONIBILIDAD[DISPONIBLE]).toBe('DISPONIBLE')
  })
})

describe('confirmacionAlCambiar (T8)', () => {
  it('al desactivar pide confirmación con el nombre del plato', () => {
    expect(confirmacionAlCambiar({ name: 'Limonada de Coco' }, false)).toMatch(/«Limonada de Coco» como NO DISPONIBLE/)
  })
  it('al activar no pide nada', () => {
    expect(confirmacionAlCambiar({ name: 'Limonada de Coco' }, true)).toBeNull()
  })
  it('sin nombre usa «este plato»', () => {
    expect(confirmacionAlCambiar({}, false)).toMatch(/este plato/)
  })
})
