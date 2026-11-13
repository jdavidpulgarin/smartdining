import { describe, it, expect } from 'vitest'
import {
  debeRecargarPorPreload,
  VENTANA_RECARGA_MS,
} from './recargaPreload'

describe('recargaPreload (J-18 / calidad PWA)', () => {
  it('sin registro previo → true', () => {
    expect(debeRecargarPorPreload(Date.now(), null)).toBe(true)
    expect(debeRecargarPorPreload(Date.now(), undefined)).toBe(true)
  })

  it('hace 3 s → false', () => {
    const ahora = 100_000
    const ultima = 100_000 - 3000
    expect(debeRecargarPorPreload(ahora, ultima)).toBe(false)
    expect(debeRecargarPorPreload(ahora, String(ultima))).toBe(false)
  })

  it('hace 15 s → true', () => {
    const ahora = 100_000
    const ultima = 100_000 - 15000
    expect(debeRecargarPorPreload(ahora, ultima)).toBe(true)
    expect(debeRecargarPorPreload(ahora, String(ultima))).toBe(true)
  })

  it('valor inválido (NaN, texto) → true', () => {
    const ahora = 100_000
    expect(debeRecargarPorPreload(ahora, 'invalido')).toBe(true)
    expect(debeRecargarPorPreload(ahora, Number.NaN)).toBe(true)
  })

  it('exactamente en el límite de ventana (10s) no recarga hasta superarlo', () => {
    const ahora = 100_000
    const limite = ahora - VENTANA_RECARGA_MS
    expect(debeRecargarPorPreload(ahora, limite)).toBe(false)
    expect(debeRecargarPorPreload(ahora, limite - 1)).toBe(true)
  })
})
