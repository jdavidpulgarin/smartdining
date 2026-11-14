import { describe, it, expect } from 'vitest'
import { listaExcedentes, textoExcedente, yaNoPendiente, mensajeErrorDevuelto } from '../excedentes'

// La forma real de GET /api/excedentes-pago-en-linea?estado=pendiente (#273).
const fila = (extra) => ({
  id: 1, id_mesa: 2, comensal: 'Ana', referencia_externa: 'SD-2-1', id_transaccion: 57,
  monto_centavos: 4000000, aplicado_centavos: 3000000, excedente_centavos: 1000000,
  motivo: 'excede_saldo_comensal', estado: 'pendiente', devuelto_por: null, devuelto_en: null,
  creado_en: '2026-11-14T16:00:00.000Z', ...extra,
})

describe('utils/excedentes (T4, §8.7)', () => {
  it('listaExcedentes: lee { excedentes } y pasa centavos a pesos', () => {
    expect(listaExcedentes({ estado: 'pendiente', excedentes: [fila()] })).toEqual([
      { id: 1, idMesa: 2, comensal: 'Ana', excedente: 10000, motivo: 'excede_saldo_comensal', creadoEn: '2026-11-14T16:00:00.000Z' },
    ])
  })

  it('listaExcedentes: del más viejo al más nuevo, sin devueltos ni filas inservibles', () => {
    const l = listaExcedentes({
      excedentes: [
        fila({ id: 3, creado_en: '2026-11-14T18:00:00.000Z' }),
        fila({ id: 2, creado_en: '2026-11-14T17:00:00.000Z' }),
        fila({ id: 4, estado: 'devuelto' }),
        fila({ id: 0 }),
        fila({ id: 5, excedente_centavos: 0 }),
        null,
      ],
    })
    expect(l.map((x) => x.id)).toEqual([2, 3])
    expect(listaExcedentes(undefined)).toEqual([])
    expect(listaExcedentes([fila()])).toHaveLength(1)
  })

  it('textoExcedente: a quién, cuánto y por qué, con el número de mesa del panel', () => {
    const [x] = listaExcedentes([fila()])
    expect(textoExcedente(x, (n) => '$' + n, (id) => id * 10)).toBe('Mesa 20 · Ana: devuélvele $10000 en efectivo (pagó en línea más de lo que debía).')
    const [y] = listaExcedentes([fila({ comensal: null, motivo: 'otra_visita' })])
    expect(textoExcedente(y, (n) => '$' + n)).toBe('Mesa 2: devuélvele $10000 en efectivo (pagó después de que su grupo se fue: se devuelve todo).')
    for (const motivo of ['excede_saldo_mesa', 'sin_cuenta', 'raro']) {
      expect(textoExcedente({ ...x, motivo })).toMatch(/devuélvele 10000 en efectivo/)
    }
  })

  it('yaNoPendiente y mensajeErrorDevuelto: 409 ya_devuelto es «otro cajero ya lo marcó»', () => {
    expect(yaNoPendiente({ status: 409, motivo: 'ya_devuelto' })).toBe(true)
    expect(yaNoPendiente({ status: 404 })).toBe(true)
    expect(yaNoPendiente({ status: 500 })).toBe(false)
    expect(mensajeErrorDevuelto({ status: 409, motivo: 'ya_devuelto' })).toMatch(/Otro cajero ya/)
    expect(mensajeErrorDevuelto({ sinConexion: true })).toMatch(/Sin conexión/)
    expect(mensajeErrorDevuelto({ status: 403 })).toMatch(/solo admin y cajero/)
    expect(mensajeErrorDevuelto({ message: 'boom' })).toMatch(/boom/)
  })
})
