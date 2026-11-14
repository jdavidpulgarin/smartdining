import { describe, it, expect } from 'vitest'
import { constructorReducer, estadoInicial } from '../constructorReducer'

const base = { id_paso: 10, max_sel: 1 }
const multi = { id_paso: 20, max_sel: 2 }
const libre = { id_paso: 30, max_sel: 0 }
const ing = (id, extra = {}) => ({ id_ingrediente: id, disponible: true, ...extra })
const alternar = (estado, paso, ingrediente) => constructorReducer(estado, { type: 'ALTERNAR_INGREDIENTE', paso, ingrediente })

describe('constructorReducer (Tomar pedido · Arma tu plato)', () => {
  it('sin acción o con un tipo desconocido devuelve el mismo estado', () => {
    expect(constructorReducer(estadoInicial, null)).toBe(estadoInicial)
    expect(constructorReducer(estadoInicial, {})).toBe(estadoInicial)
    expect(constructorReducer(estadoInicial, { type: 'NO_EXISTE' })).toBe(estadoInicial)
  })

  it('paso de una sola opción: elegir otra reemplaza la anterior, con porción normal', () => {
    let e = alternar(estadoInicial, base, ing(1))
    expect(e.selecciones[10]).toEqual({ 1: 'normal' })
    e = alternar(e, base, ing(2))
    expect(e.selecciones[10]).toEqual({ 2: 'normal' })
  })

  it('tocar una opción ya elegida la quita', () => {
    const e = alternar(alternar(estadoInicial, multi, ing(1)), multi, ing(1))
    expect(e.selecciones[20]).toEqual({})
  })

  it('paso con máximo: no deja pasar del máximo; sin máximo (0) acepta todas', () => {
    let e = alternar(alternar(estadoInicial, multi, ing(1)), multi, ing(2))
    const lleno = alternar(e, multi, ing(3))
    expect(lleno).toBe(e)
    expect(Object.keys(e.selecciones[20])).toEqual(['1', '2'])
    e = estadoInicial
    for (const id of [1, 2, 3, 4]) e = alternar(e, libre, ing(id))
    expect(Object.keys(e.selecciones[30])).toHaveLength(4)
  })

  it('un ingrediente agotado, o sin paso o ingrediente, no cambia nada', () => {
    expect(alternar(estadoInicial, base, ing(1, { disponible: false }))).toBe(estadoInicial)
    expect(alternar(estadoInicial, null, ing(1))).toBe(estadoInicial)
    expect(alternar(estadoInicial, base, null)).toBe(estadoInicial)
  })

  it('CAMBIAR_PORCION: solo ligera, normal o extra, y solo si el ingrediente está elegido', () => {
    const e = alternar(estadoInicial, multi, ing(1))
    const extra = constructorReducer(e, { type: 'CAMBIAR_PORCION', id_paso: 20, id_ingrediente: 1, porcion: 'extra' })
    expect(extra.selecciones[20][1]).toBe('extra')
    expect(constructorReducer(e, { type: 'CAMBIAR_PORCION', id_paso: 20, id_ingrediente: 1, porcion: 'doble' })).toBe(e)
    expect(constructorReducer(e, { type: 'CAMBIAR_PORCION', id_paso: 20, id_ingrediente: 9, porcion: 'extra' })).toBe(e)
    expect(constructorReducer(e, { type: 'CAMBIAR_PORCION', id_paso: 99, id_ingrediente: 1, porcion: 'extra' })).toBe(e)
  })

  it('ESTABLECER_PASO: acepta números >= 0 (también en texto); rechaza negativos y basura', () => {
    expect(constructorReducer(estadoInicial, { type: 'ESTABLECER_PASO', paso: 2 }).pasoActual).toBe(2)
    expect(constructorReducer(estadoInicial, { type: 'ESTABLECER_PASO', paso: '3' }).pasoActual).toBe(3)
    expect(constructorReducer(estadoInicial, { type: 'ESTABLECER_PASO', paso: -1 })).toBe(estadoInicial)
    expect(constructorReducer(estadoInicial, { type: 'ESTABLECER_PASO', paso: 'x' })).toBe(estadoInicial)
  })

  it('CAMBIAR_NOTAS: recorta a 200 caracteres; lo que no es texto queda vacío', () => {
    expect(constructorReducer(estadoInicial, { type: 'CAMBIAR_NOTAS', notas: 'sin cebolla' }).notas).toBe('sin cebolla')
    expect(constructorReducer(estadoInicial, { type: 'CAMBIAR_NOTAS', notas: 'a'.repeat(250) }).notas).toHaveLength(200)
    expect(constructorReducer(estadoInicial, { type: 'CAMBIAR_NOTAS', notas: 5 }).notas).toBe('')
  })

  it('REINICIAR: vuelve al primer paso con las selecciones y notas que se le den (o vacías)', () => {
    const sucio = { pasoActual: 3, selecciones: { 10: { 1: 'extra' } }, notas: 'x', enResumen: true }
    expect(constructorReducer(sucio, { type: 'REINICIAR' })).toEqual({ pasoActual: 0, selecciones: {}, notas: '', enResumen: false })
    expect(constructorReducer(sucio, { type: 'REINICIAR', seleccionesIniciales: { 10: { 2: 'normal' } }, notasIniciales: 'poco picante' }))
      .toEqual({ pasoActual: 0, selecciones: { 10: { 2: 'normal' } }, notas: 'poco picante', enResumen: false })
  })
})
