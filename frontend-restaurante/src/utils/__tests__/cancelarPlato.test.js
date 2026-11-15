import { describe, it, expect } from 'vitest'
import {
  puedeCancelarPlato,
  lineaCancelable,
  validarMotivo,
  mensajeErrorCancelarPlato,
} from '../cancelarPlato'

describe('utils/cancelarPlato (D-13)', () => {
  it('puedeCancelarPlato: solo admin y mesero', () => {
    expect(['admin', 'mesero', 'cajero', 'cocina', undefined].map(puedeCancelarPlato))
      .toEqual([true, true, false, false, false])
  })

  it('lineaCancelable: pedido recibido, en preparación o listo y línea viva sin servir', () => {
    for (const p of ['recibido', 'en_preparacion', 'listo']) {
      for (const l of ['pendiente', 'cocinando', 'listo']) expect(lineaCancelable(p, l)).toBe(true)
      expect(lineaCancelable(p, 'servido')).toBe(false)
      expect(lineaCancelable(p, 'cancelado')).toBe(false)
    }
    for (const p of ['entregado', 'pagado', 'cancelado', 'por_pagar']) expect(lineaCancelable(p, 'pendiente')).toBe(false)
  })

  it('validarMotivo: recortado, obligatorio y hasta 200 caracteres', () => {
    expect(validarMotivo('  Se fueron  ')).toEqual({ motivo: 'Se fueron' })
    expect(validarMotivo('   ').error).toMatch(/Escribe el motivo/)
    expect(validarMotivo(undefined).error).toMatch(/Escribe el motivo/)
    expect(validarMotivo('a'.repeat(200))).toEqual({ motivo: 'a'.repeat(200) })
    expect(validarMotivo('a'.repeat(201)).error).toMatch(/200/)
  })

  it('mensajeErrorCancelarPlato: un mensaje por motivo del contrato', () => {
    expect(mensajeErrorCancelarPlato({ motivo: 'pago_registrado' })).toMatch(/reembolsar/)
    expect(mensajeErrorCancelarPlato({ motivo: 'item_no_cancelable' })).toMatch(/ya no se puede cancelar/)
    expect(mensajeErrorCancelarPlato({ motivo: 'item_ya_cancelado' })).toMatch(/ya estaba cancelado/)
    expect(mensajeErrorCancelarPlato({ motivo: 'motivo_requerido' })).toMatch(/motivo/)
    expect(mensajeErrorCancelarPlato({ status: 403 })).toMatch(/solo admin y mesero/)
    expect(mensajeErrorCancelarPlato({ sinConexion: true })).toMatch(/Sin conexión/)
    expect(mensajeErrorCancelarPlato({ message: 'boom' })).toMatch(/boom/)
  })
})

describe('T4: textos de los 409 al cancelar un plato', () => {
  it('pago_en_curso: alguien está pagando en línea (no el genérico)', () => {
    const m = mensajeErrorCancelarPlato({ status: 409, motivo: 'pago_en_curso', data: { motivo: 'pago_en_curso' }, message: 'Hay un pago en curso en esta mesa.' })
    expect(m).toMatch(/pagando en línea/)
    expect(m).not.toMatch(/^No se pudo cancelar el plato/)
  })

  it('pago_en_curso con detalle sin_verificar: no se pudo comprobar', () => {
    const m = mensajeErrorCancelarPlato({ status: 409, motivo: 'pago_en_curso', data: { motivo: 'pago_en_curso', detalle: 'sin_verificar' } })
    expect(m).toMatch(/No se pudo comprobar/)
  })

  it('pago_registrado porque el dueño de la línea ya pagó (#259): lo dice así', () => {
    const m = mensajeErrorCancelarPlato({ status: 409, motivo: 'pago_registrado', message: 'Ese comensal ya pagó: reembolsa antes de cancelar su plato' })
    expect(m).toMatch(/ya pagó su parte/)
  })

  it('pago_registrado porque lo pagado supera el total nuevo: el texto de siempre', () => {
    const m = mensajeErrorCancelarPlato({ status: 409, motivo: 'pago_registrado', message: 'Error 409' })
    expect(m).toMatch(/supera el total/)
  })
})
