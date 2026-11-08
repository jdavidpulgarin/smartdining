import { describe, it, expect } from 'vitest'
import { crearVentanaEventos, crearUltimoPorId, TAMANO_VENTANA_EVENTOS } from '../eventosSocket'

describe('crearVentanaEventos (deduplicar por eventId)', () => {
  it('la primera vez es nuevo; la segunda, repetido', () => {
    const yaVisto = crearVentanaEventos()
    expect(yaVisto('a')).toBe(false)
    expect(yaVisto('a')).toBe(true)
    expect(yaVisto('b')).toBe(false)
  })

  it('sin eventId no se puede deduplicar: siempre cuenta como nuevo', () => {
    const yaVisto = crearVentanaEventos()
    expect(yaVisto(undefined)).toBe(false)
    expect(yaVisto(undefined)).toBe(false)
    expect(yaVisto('')).toBe(false)
  })

  it(`recuerda solo los últimos ${TAMANO_VENTANA_EVENTOS}: olvida el más antiguo`, () => {
    const yaVisto = crearVentanaEventos()
    for (let i = 0; i <= TAMANO_VENTANA_EVENTOS; i++) yaVisto(`e${i}`)
    // e0 salió de la ventana; e1 y el último siguen.
    expect(yaVisto(`e${TAMANO_VENTANA_EVENTOS}`)).toBe(true)
    expect(yaVisto('e1')).toBe(true)
    expect(yaVisto('e0')).toBe(false)
  })

  it('cada ventana es independiente', () => {
    const a = crearVentanaEventos()
    const b = crearVentanaEventos()
    a('x')
    expect(b('x')).toBe(false)
  })
})

describe('crearUltimoPorId (estado completo sin eventId)', () => {
  it('descarta un aviso más viejo que el último aplicado del mismo id', () => {
    const esViejo = crearUltimoPorId()
    expect(esViejo(7, '2026-11-08T18:00:02Z')).toBe(false)
    expect(esViejo(7, '2026-11-08T18:00:01Z')).toBe(true)
    // Otro id no se ve afectado.
    expect(esViejo(8, '2026-11-08T18:00:01Z')).toBe(false)
  })

  it('el mismo instante o uno posterior se aplica', () => {
    const esViejo = crearUltimoPorId()
    esViejo(7, '2026-11-08T18:00:02Z')
    expect(esViejo(7, '2026-11-08T18:00:02Z')).toBe(false)
    expect(esViejo(7, '2026-11-08T18:00:03Z')).toBe(false)
  })

  it('sin emitidoEn legible no compara y aplica', () => {
    const esViejo = crearUltimoPorId()
    esViejo(7, '2026-11-08T18:00:02Z')
    expect(esViejo(7, undefined)).toBe(false)
    expect(esViejo(7, 'ayer')).toBe(false)
  })
})
