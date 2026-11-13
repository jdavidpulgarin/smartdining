import { describe, it, expect, vi } from 'vitest'
import {
  debeRecargarPorPreload,
  manejarPreloadError,
  CLAVE_RECARGA_PRELOAD,
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

describe('manejarPreloadError', () => {
  function crearStorage(inicial = {}) {
    const store = { ...inicial }
    return {
      getItem: vi.fn((clave) => (clave in store ? store[clave] : null)),
      setItem: vi.fn((clave, valor) => {
        store[clave] = String(valor)
      }),
    }
  }

  it('sin registro previo → recarga 1 vez y guarda la hora', () => {
    const storage = crearStorage()
    const recargar = vi.fn()
    const evento = { preventDefault: vi.fn() }
    const ahora = 100_000

    const resultado = manejarPreloadError(evento, { storage, ahora, recargar })

    expect(resultado).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith(
      CLAVE_RECARGA_PRELOAD,
      String(ahora)
    )
  })

  it('registro de hace 3 s → no recarga', () => {
    const storage = crearStorage({ [CLAVE_RECARGA_PRELOAD]: '97000' })
    const recargar = vi.fn()
    const evento = { preventDefault: vi.fn() }
    const ahora = 100_000

    const resultado = manejarPreloadError(evento, { storage, ahora, recargar })

    expect(resultado).toBe(false)
    expect(recargar).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('storage cuyo getItem lanza → no recarga y no lanza', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError')
      }),
      setItem: vi.fn(),
    }
    const recargar = vi.fn()
    const evento = { preventDefault: vi.fn() }
    const ahora = 100_000

    let resultado
    expect(() => {
      resultado = manejarPreloadError(evento, { storage, ahora, recargar })
    }).not.toThrow()

    expect(resultado).toBe(false)
    expect(recargar).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('storage cuyo setItem lanza → no recarga', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError')
      }),
    }
    const recargar = vi.fn()
    const evento = { preventDefault: vi.fn() }
    const ahora = 100_000

    let resultado
    expect(() => {
      resultado = manejarPreloadError(evento, { storage, ahora, recargar })
    }).not.toThrow()

    expect(resultado).toBe(false)
    expect(recargar).not.toHaveBeenCalled()
  })

  it('storage null → no recarga', () => {
    const recargar = vi.fn()
    const evento = { preventDefault: vi.fn() }
    const ahora = 100_000

    const resultado = manejarPreloadError(evento, {
      storage: null,
      ahora,
      recargar,
    })

    expect(resultado).toBe(false)
    expect(recargar).not.toHaveBeenCalled()
  })

  it('siempre llama evento.preventDefault()', () => {
    const recargar = vi.fn()

    // Con recarga exitosa
    const evento1 = { preventDefault: vi.fn() }
    manejarPreloadError(evento1, {
      storage: crearStorage(),
      ahora: 100_000,
      recargar,
    })
    expect(evento1.preventDefault).toHaveBeenCalledTimes(1)

    // Con registro reciente (no recarga)
    const evento2 = { preventDefault: vi.fn() }
    manejarPreloadError(evento2, {
      storage: crearStorage({ [CLAVE_RECARGA_PRELOAD]: '99000' }),
      ahora: 100_000,
      recargar,
    })
    expect(evento2.preventDefault).toHaveBeenCalledTimes(1)

    // Con storage cuyo getItem lanza
    const evento3 = { preventDefault: vi.fn() }
    manejarPreloadError(evento3, {
      storage: {
        getItem: () => {
          throw new Error('SecurityError')
        },
      },
      ahora: 100_000,
      recargar,
    })
    expect(evento3.preventDefault).toHaveBeenCalledTimes(1)

    // Con storage null
    const evento4 = { preventDefault: vi.fn() }
    manejarPreloadError(evento4, {
      storage: null,
      ahora: 100_000,
      recargar,
    })
    expect(evento4.preventDefault).toHaveBeenCalledTimes(1)
  })
})
