import { describe, it, expect } from 'vitest'
import { estadoTarjetaMesa, detalleMesa, avisoAbrirMesa, puedeAbrirMesa } from '../estadoMesa'

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

describe('abrir o tomar pedido en una mesa reservada o en mantenimiento (revisión de Roberto, #282)', () => {
  // `confirmar` anota lo que se preguntó y responde lo que diga la prueba.
  const confirmador = (respuesta) => {
    const preguntas = []
    const confirmar = (m) => { preguntas.push(m); return respuesta }
    return { confirmar, preguntas }
  }

  it('reservada: pregunta «La mesa 5 está reservada. ¿Abrirla igual?»; cancelar no abre, aceptar sí', () => {
    const no = confirmador(false)
    expect(puedeAbrirMesa({ estado: 'reservada', numero: 5 }, no.confirmar)).toBe(false)
    expect(no.preguntas).toEqual(['La mesa 5 está reservada. ¿Abrirla igual?'])
    const si = confirmador(true)
    expect(puedeAbrirMesa({ estado: 'Reservada', numero: 5 }, si.confirmar)).toBe(true)
    expect(si.preguntas).toHaveLength(1)
  })

  it('mantenimiento: pregunta «La mesa 5 está en mantenimiento. ¿Abrirla igual?»; cancelar no abre, aceptar sí', () => {
    const no = confirmador(false)
    expect(puedeAbrirMesa({ estado: 'mantenimiento', numero: 5 }, no.confirmar)).toBe(false)
    expect(no.preguntas).toEqual(['La mesa 5 está en mantenimiento. ¿Abrirla igual?'])
    expect(puedeAbrirMesa({ estado: 'mantenimiento', numero: 5 }, confirmador(true).confirmar)).toBe(true)
  })

  it('disponible u ocupada: no pregunta nada y deja seguir', () => {
    for (const estado of ['disponible', 'ocupada', 'Ocupada', undefined]) {
      const c = confirmador(false)
      expect(puedeAbrirMesa({ estado, numero: 5 }, c.confirmar)).toBe(true)
      expect(c.preguntas).toHaveLength(0)
    }
    expect(avisoAbrirMesa({ estado: 'reservada' })).toBe('La mesa está reservada. ¿Abrirla igual?')
  })
})
