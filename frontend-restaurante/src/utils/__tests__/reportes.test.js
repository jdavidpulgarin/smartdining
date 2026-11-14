import { describe, it, expect } from 'vitest'
import { resumirMetodos, cuadreConCaja, barrasVentasPorDia, COLOR_METODO, COLOR_OTRO_METODO } from '../reportes'

describe('resumirMetodos (T6)', () => {
  it('cada método conocido tiene su propio color, distinto de los demás', () => {
    const { filas } = resumirMetodos([
      { metodo: 'Efectivo', monto: 1, porcentaje: 25 },
      { metodo: 'Tarjeta', monto: 1, porcentaje: 25 },
      { metodo: 'Online', monto: 1, porcentaje: 25 },
      { metodo: 'Transferencia', monto: 1, porcentaje: 25 },
    ])
    const colores = filas.map((f) => f.color)
    expect(new Set(colores).size).toBe(4)
    expect(filas.find((f) => f.metodo === 'Online').color).toBe(COLOR_METODO.Online)
  })

  it('el color va con el método, no con la posición', () => {
    const a = resumirMetodos([{ metodo: 'Tarjeta', monto: 9 }, { metodo: 'Efectivo', monto: 1 }]).filas
    const b = resumirMetodos([{ metodo: 'Efectivo', monto: 9 }, { metodo: 'Tarjeta', monto: 1 }]).filas
    expect(a.find((f) => f.metodo === 'Tarjeta').color).toBe(b.find((f) => f.metodo === 'Tarjeta').color)
  })

  it('un método desconocido usa el color de «otro»', () => {
    expect(resumirMetodos([{ metodo: 'Bono', monto: 5 }]).filas[0].color).toBe(COLOR_OTRO_METODO)
  })

  it('el total suma los montos, sin errores de coma flotante', () => {
    expect(resumirMetodos([{ metodo: 'Efectivo', monto: 0.1 }, { metodo: 'Tarjeta', monto: 0.2 }]).total).toBe(0.3)
    expect(resumirMetodos([{ metodo: 'Efectivo', monto: 216000 }, { metodo: 'Tarjeta', monto: 12000 }]).total).toBe(228000)
  })

  it('sin métodos: lista vacía y total 0', () => {
    expect(resumirMetodos()).toEqual({ filas: [], total: 0 })
    expect(resumirMetodos(null)).toEqual({ filas: [], total: 0 })
  })
})

describe('cuadreConCaja (T6)', () => {
  it('cuadra cuando la suma por métodos es igual a «Recaudado hoy»', () => {
    expect(cuadreConCaja(228000, 228000)).toEqual({ estado: 'cuadra', diferencia: 0 })
    expect(cuadreConCaja(228000, '228000.00')).toEqual({ estado: 'cuadra', diferencia: 0 })
  })
  it('no cuadra: dice la diferencia (métodos − Caja)', () => {
    expect(cuadreConCaja(216000, 228000)).toEqual({ estado: 'no_cuadra', diferencia: -12000 })
  })
  it('sin el dato de la Caja no afirma nada', () => {
    expect(cuadreConCaja(5, null).estado).toBe('sin_dato')
    expect(cuadreConCaja(5, undefined).estado).toBe('sin_dato')
  })
})


describe('barrasVentasPorDia (T6)', () => {
  it('sin el campo (backend viejo): null, no se inventan barras', () => {
    expect(barrasVentasPorDia(undefined)).toBeNull()
    expect(barrasVentasPorDia(null)).toBeNull()
  })

  it('ordena por fecha y calcula la altura relativa a la más alta; los días en 0 quedan en 0', () => {
    const b = barrasVentasPorDia([
      { fecha: '2026-11-13', total: 228000, pedidos: 9 },
      { fecha: '2026-11-11', total: 0, pedidos: 0 },
      { fecha: '2026-11-12', total: 114000, pedidos: 4 },
    ])
    expect(b.map((x) => x.fecha)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13'])
    expect(b.map((x) => x.altura)).toEqual([0, 50, 100])
    expect(b[2].pedidos).toBe(9)
  })

  it('la fecha AAAA-MM-DD se pinta como ESE día (no el anterior por UTC)', () => {
    const [b] = barrasVentasPorDia([{ fecha: '2026-11-13', total: 1, pedidos: 1 }])
    expect(b.etiqueta).toMatch(/13/)
    expect(b.titulo).toMatch(/13 de noviembre/)
  })

  it('un día con poquito no desaparece (mínimo 2 %)', () => {
    const b = barrasVentasPorDia([{ fecha: '2026-11-12', total: 1000, pedidos: 1 }, { fecha: '2026-11-13', total: 1000000, pedidos: 50 }])
    expect(b[0].altura).toBe(2)
  })

  it('descarta filas con fecha mal formada y montos no numéricos cuentan 0', () => {
    const b = barrasVentasPorDia([{ fecha: '13/11/2026', total: 5 }, { fecha: '2026-11-13', total: 'x', pedidos: null }])
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ total: 0, pedidos: 0, altura: 0 })
  })
})
