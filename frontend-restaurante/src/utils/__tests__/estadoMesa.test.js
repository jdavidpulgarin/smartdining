import { describe, it, expect } from 'vitest'
import { estadoTarjetaMesa, detalleMesa } from '../estadoMesa'

describe('utils/estadoMesa: la tarjeta de la mesa', () => {
  it('reservada y mantenimiento tienen su propia etiqueta (antes salían como DISPONIBLE)', () => {
    expect(estadoTarjetaMesa({ estado: 'reservada' })).toEqual({ visual: 'reservada', etiqueta: 'RESERVADA' })
    expect(estadoTarjetaMesa({ estado: 'Mantenimiento' })).toEqual({ visual: 'mantenimiento', etiqueta: 'EN MANTENIMIENTO' })
  })

  it('disponible y ocupada como siempre; con la sesión abierta cuenta como ocupada', () => {
    expect(estadoTarjetaMesa({ estado: 'Disponible' })).toEqual({ visual: 'disponible', etiqueta: 'DISPONIBLE' })
    expect(estadoTarjetaMesa({ estado: 'ocupada' }).etiqueta).toBe('OCUPADA')
    expect(estadoTarjetaMesa({ estado: 'disponible', activa: true }).etiqueta).toBe('OCUPADA')
    expect(estadoTarjetaMesa({}).etiqueta).toBe('DISPONIBLE')
  })

  it('los avisos van encima del estado: llamado > cuenta > listo', () => {
    expect(estadoTarjetaMesa({ estado: 'reservada', alerta: 'llamado' }).etiqueta).toBe('LLAMA AL MESERO')
    expect(estadoTarjetaMesa({ estado: 'ocupada', alerta: 'cuenta' }).etiqueta).toBe('PIDE LA CUENTA')
    expect(estadoTarjetaMesa({ estado: 'pedido_listo' }).etiqueta).toBe('PEDIDO LISTO')
    expect(estadoTarjetaMesa({ estado: 'cuenta_pedida' }).visual).toBe('cuenta')
  })

  it('detalleMesa: mantenimiento ya no dice «Reservada»', () => {
    expect(detalleMesa('mantenimiento')).toBe('En mantenimiento: no se asigna')
    expect(detalleMesa('reservada')).toBe('Reservada')
    expect(detalleMesa('ocupada', true)).toBe('Sesión activa · QR generado')
    expect(detalleMesa('ocupada', false)).toBe('Ocupada')
    expect(detalleMesa('disponible')).toBe('Lista para asignar')
  })
})
