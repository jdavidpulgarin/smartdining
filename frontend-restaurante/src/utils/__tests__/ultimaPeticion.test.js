import { describe, it, expect } from 'vitest'
import { crearUltimaPeticion } from '../ultimaPeticion'

describe('crearUltimaPeticion', () => {
  it('una sola petición está vigente', () => {
    const u = crearUltimaPeticion()
    expect(u.nueva().vigente()).toBe(true)
  })

  it('al pedir otra, la anterior deja de estar vigente y la nueva sí', () => {
    const u = crearUltimaPeticion()
    const vieja = u.nueva()
    const nueva = u.nueva()
    expect(vieja.vigente()).toBe(false)
    expect(nueva.vigente()).toBe(true)
  })

  it('invalidar descarta todas las que estén en vuelo', () => {
    const u = crearUltimaPeticion()
    const a = u.nueva()
    u.invalidar()
    expect(a.vigente()).toBe(false)
  })

  it('cada contador es independiente', () => {
    const u1 = crearUltimaPeticion()
    const u2 = crearUltimaPeticion()
    const a = u1.nueva()
    u2.nueva()
    expect(a.vigente()).toBe(true)
  })
})
