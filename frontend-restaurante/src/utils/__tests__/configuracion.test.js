import { describe, it, expect } from 'vitest'
import {
  ordenarMesas,
  validarMesa,
  cambiosDeMesa,
  validarNuevoUsuario,
  errorDeClave,
  etiquetaDeRol,
  mensajeDeCarga,
} from '../configuracion'

describe('utils/configuracion (P-21)', () => {
  it('ordenarMesas acepta { mesas } o un arreglo y ordena por número', () => {
    expect(ordenarMesas({ mesas: [{ numero: 3 }, { numero: 1 }] }).map((m) => m.numero)).toEqual([1, 3])
    expect(ordenarMesas([{ numero: 10 }, { numero: 2 }]).map((m) => m.numero)).toEqual([2, 10])
    expect(ordenarMesas(null)).toEqual([])
  })

  it('validarMesa: enteros positivos y ubicación no vacía de hasta 50', () => {
    expect(validarMesa({ numero: '4', capacidad: '2', ubicacion: ' Terraza ' })).toEqual({
      datos: { numero: 4, capacidad: 2, ubicacion: 'Terraza' },
    })
    expect(validarMesa({ numero: '0', capacidad: '2', ubicacion: 'x' }).error).toMatch(/número/)
    expect(validarMesa({ numero: '2.5', capacidad: '2', ubicacion: 'x' }).error).toMatch(/número/)
    expect(validarMesa({ numero: '2', capacidad: '-1', ubicacion: 'x' }).error).toMatch(/capacidad/)
    expect(validarMesa({ numero: '2', capacidad: '2', ubicacion: '   ' }).error).toMatch(/ubicación/)
    expect(validarMesa({ numero: '2', capacidad: '2', ubicacion: 'a'.repeat(51) }).error).toMatch(/50/)
  })

  it('cambiosDeMesa devuelve solo lo que cambió (y {} si nada)', () => {
    const mesa = { numero: 4, capacidad: 2, ubicacion: 'Terraza' }
    expect(cambiosDeMesa(mesa, { numero: 4, capacidad: 2, ubicacion: 'Terraza' })).toEqual({})
    expect(cambiosDeMesa(mesa, { numero: 5, capacidad: 2, ubicacion: 'VIP' })).toEqual({ numero: 5, ubicacion: 'VIP' })
  })

  it('validarNuevoUsuario aplica las reglas del alta', () => {
    const base = { nombre: ' Sara ', email: 'sara@mail.com', password: 'clave-segura', rol: 'cocina' }
    expect(validarNuevoUsuario(base)).toEqual({ datos: { ...base, nombre: 'Sara' } })
    expect(validarNuevoUsuario({ ...base, nombre: 'S' }).error).toMatch(/nombre/)
    expect(validarNuevoUsuario({ ...base, email: 'sara' }).error).toMatch(/email/)
    expect(validarNuevoUsuario({ ...base, password: 'corta' }).error).toMatch(/8 caracteres/)
    expect(validarNuevoUsuario({ ...base, rol: 'comensal' }).error).toMatch(/rol/)
  })

  it('errorDeClave: mínimo 8 caracteres y máximo 72 bytes', () => {
    expect(errorDeClave('12345678')).toBeNull()
    expect(errorDeClave('ñ'.repeat(37))).toMatch(/72 bytes/)
  })

  it('etiquetaDeRol y mensajeDeCarga', () => {
    expect(etiquetaDeRol('cajero')).toBe('Cajero')
    expect(etiquetaDeRol('otro')).toBe('otro')
    expect(mensajeDeCarga({ sinConexion: true }, 'x')).toBe('Sin conexión con el servidor')
    expect(mensajeDeCarga({ message: 'Error 500' }, 'x')).toBe('Error 500')
    expect(mensajeDeCarga(null, 'x')).toBe('x')
  })
})
