import { describe, it, expect } from 'vitest'
import {
  hoyBogota,
  fechaValida,
  sumarDias,
  diasDelRango,
  rangoRapido,
  validarRango,
  consultaDeConsumo,
  mensajeErrorConsumo,
  filtrarConsumo,
  fechaCorta,
  conSigno,
} from '../consumo'

describe('utils/consumo (P-22, reporte de consumo)', () => {
  it('hoyBogota: el día de Bogotá, también a las 8 p. m. (ya "mañana" en UTC)', () => {
    expect(hoyBogota(new Date('2026-11-13T01:30:00Z'))).toBe('2026-11-12')
    expect(hoyBogota(new Date('2026-11-13T05:30:00Z'))).toBe('2026-11-13')
  })

  it('fechaValida: formato AAAA-MM-DD y que exista', () => {
    expect(fechaValida('2026-11-01')).toBe(true)
    expect(fechaValida('2028-02-29')).toBe(true)
    expect(['2026-02-30', '2026-13-01', '2026-1-01', '', null, '01/11/2026'].map(fechaValida)).toEqual([false, false, false, false, false, false])
  })

  it('sumarDias y diasDelRango: cruzan meses y cuentan los dos extremos', () => {
    expect(sumarDias('2026-11-01', -1)).toBe('2026-10-31')
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01')
    expect(diasDelRango('2026-11-01', '2026-11-01')).toBe(1)
    expect(diasDelRango('2026-10-01', '2026-10-31')).toBe(31)
  })

  it('rangoRapido: hoy, últimos 7 días (con hoy) y este mes', () => {
    expect(rangoRapido('hoy', '2026-11-13')).toEqual({ desde: '2026-11-13', hasta: '2026-11-13' })
    expect(rangoRapido('7', '2026-11-03')).toEqual({ desde: '2026-10-28', hasta: '2026-11-03' })
    expect(rangoRapido('mes', '2026-11-13')).toEqual({ desde: '2026-11-01', hasta: '2026-11-13' })
  })

  it('validarRango: la misma regla del contrato', () => {
    const hoy = '2026-11-13'
    expect(validarRango({ desde: '2026-11-01', hasta: '2026-11-13' }, hoy)).toBeNull()
    expect(validarRango({ desde: '2026-10-01', hasta: '2026-10-31' }, hoy)).toBeNull() // 31 días: cabe
    expect(validarRango({ desde: '2026-10-01', hasta: '2026-11-01' }, hoy)).toMatch(/31 días/) // 32
    expect(validarRango({ desde: '2026-11-10', hasta: '2026-11-09' }, hoy)).toMatch(/anterior/)
    expect(validarRango({ desde: '2026-11-13', hasta: '2026-11-14' }, hoy)).toMatch(/futura/)
    expect(validarRango({ desde: '', hasta: '2026-11-13' }, hoy)).toMatch(/dos fechas/)
    expect(validarRango({ desde: '2026-02-30', hasta: '2026-03-01' }, hoy)).toMatch(/dos fechas/)
  })

  it('consultaDeConsumo: id_insumo solo si se eligió', () => {
    expect(consultaDeConsumo({ desde: '2026-11-01', hasta: '2026-11-13' })).toBe('desde=2026-11-01&hasta=2026-11-13')
    expect(consultaDeConsumo({ desde: '2026-11-01', hasta: '2026-11-13', idInsumo: '7' })).toBe('desde=2026-11-01&hasta=2026-11-13&id_insumo=7')
  })

  it('mensajeErrorConsumo: sin conexión, 403, 404 y consulta_invalida', () => {
    expect(mensajeErrorConsumo({ sinConexion: true })).toMatch(/Sin conexión/)
    expect(mensajeErrorConsumo({ status: 403 })).toMatch(/Solo el administrador/)
    expect(mensajeErrorConsumo({ status: 404, motivo: 'no_encontrado' })).toMatch(/ya no existe/)
    expect(mensajeErrorConsumo({ status: 400, motivo: 'consulta_invalida', message: 'hasta: futura' })).toMatch(/no aceptó el rango: hasta: futura/)
    expect(mensajeErrorConsumo({ message: 'boom' })).toMatch(/boom/)
  })

  it('filtrarConsumo: por nombre, sin tildes ni mayúsculas', () => {
    const lista = [{ nombre: 'Arepa de chócolo' }, { nombre: 'Queso cheddar' }]
    expect(filtrarConsumo(lista, 'CHOCOLO').map((i) => i.nombre)).toEqual(['Arepa de chócolo'])
    expect(filtrarConsumo(lista, '  ')).toHaveLength(2)
  })

  it('fechaCorta: el día pedido, sin correrse por el huso', () => {
    expect(fechaCorta('2026-11-02')).toMatch(/2/)
    expect(fechaCorta('2026-11-02')).toMatch(/nov/i)
    expect(fechaCorta('no-es')).toBe('no-es')
  })

  it('conSigno: los ajustes llevan su signo', () => {
    const f = (n) => `${n} g`
    expect(conSigno(50, f)).toBe('+50 g')
    expect(conSigno(-20, f)).toBe('−20 g')
    expect(conSigno(0, f)).toBe('0 g')
  })
})
