import { describe, it, expect } from 'vitest'
import {
  DIAS,
  formDesdeConfig,
  validarConfig,
  cambiosDeConfig,
  cruzaMedianoche,
} from '../configuracionRestaurante'

// Forma real de GET /configuracion/completa (api-spec, D-16 parte B).
const config = {
  id: 1,
  nombre: 'SmartDining',
  telefono: '3001234567',
  direccion: 'Calle 1 #2-3',
  url_logo: null,
  horario: { lunes: { abre: '11:00', cierra: '22:00' }, sabado: { abre: '11:00', cierra: '23:00' } },
  propina_sugerida_pct: 10,
  moneda: 'COP',
  actualizado_en: '2026-11-08T12:00:00.000Z',
  actualizado_por: 1,
}

const formValido = () => formDesdeConfig(config)

describe('configuracionRestaurante', () => {
  it('formDesdeConfig: los 7 días, los ausentes cerrados, y null como texto vacío', () => {
    const form = formDesdeConfig(config)
    expect(Object.keys(form.horario)).toEqual(DIAS.map((d) => d.clave))
    expect(form.horario.lunes).toEqual({ abierto: true, abre: '11:00', cierra: '22:00' })
    expect(form.horario.martes).toEqual({ abierto: false, abre: '', cierra: '' })
    expect(form.url_logo).toBe('')
    expect(form.propina_sugerida_pct).toBe('10')
  })

  it('validarConfig: devuelve los 7 campos del contrato, con null en los opcionales vacíos', () => {
    const form = { ...formValido(), telefono: '  ', propina_sugerida_pct: '12,5', moneda: 'usd' }
    expect(validarConfig(form)).toEqual({
      datos: {
        nombre: 'SmartDining',
        telefono: null,
        direccion: 'Calle 1 #2-3',
        url_logo: null,
        horario: { lunes: { abre: '11:00', cierra: '22:00' }, sabado: { abre: '11:00', cierra: '23:00' } },
        propina_sugerida_pct: 12.5,
        moneda: 'USD',
      },
    })
  })

  it('validarConfig: rechaza lo que el backend rechazaría, con un mensaje claro', () => {
    const casos = [
      [{ nombre: '   ' }, /nombre .* obligatorio/],
      [{ nombre: 'x'.repeat(121) }, /120/],
      [{ telefono: '1'.repeat(31) }, /30/],
      [{ propina_sugerida_pct: '' }, /obligatoria/],
      [{ propina_sugerida_pct: '31' }, /0 a 30/],
      [{ propina_sugerida_pct: '10.555' }, /2 decimales/],
      [{ propina_sugerida_pct: '-1' }, /2 decimales/],
      [{ moneda: 'CO' }, /3 letras/],
    ]
    for (const [cambio, mensaje] of casos) {
      expect(validarConfig({ ...formValido(), ...cambio }).error).toMatch(mensaje)
    }
  })

  it('validarConfig: un día abierto necesita apertura y cierre distintos en HH:MM', () => {
    const form = formValido()
    form.horario.martes = { abierto: true, abre: '11:00', cierra: '' }
    expect(validarConfig(form).error).toMatch(/^Martes: .*HH:MM/)
    form.horario.martes = { abierto: true, abre: '11:00', cierra: '11:00' }
    expect(validarConfig(form).error).toMatch(/^Martes: .*misma hora/)
    // Cerrar después de medianoche es válido y se avisa en pantalla.
    form.horario.martes = { abierto: true, abre: '18:00', cierra: '02:00' }
    expect(validarConfig(form).datos.horario.martes).toEqual({ abre: '18:00', cierra: '02:00' })
    expect(cruzaMedianoche(form.horario.martes)).toBe(true)
  })

  it('validarConfig: un día desmarcado no viaja (ausente = cerrado), aunque tenga horas escritas', () => {
    const form = formValido()
    form.horario.lunes = { abierto: false, abre: '11:00', cierra: '22:00' }
    expect(validarConfig(form).datos.horario).toEqual({ sabado: { abre: '11:00', cierra: '23:00' } })
  })

  it('cambiosDeConfig: solo lo que cambió, sin campos de auditoría', () => {
    const sinCambios = validarConfig(formValido()).datos
    expect(cambiosDeConfig(config, sinCambios)).toEqual({})

    const form = { ...formValido(), telefono: '', propina_sugerida_pct: '12.5' }
    form.horario.domingo = { abierto: true, abre: '12:00', cierra: '21:00' }
    const cambios = cambiosDeConfig(config, validarConfig(form).datos)
    expect(cambios).toEqual({
      telefono: null,
      propina_sugerida_pct: 12.5,
      horario: {
        lunes: { abre: '11:00', cierra: '22:00' },
        sabado: { abre: '11:00', cierra: '23:00' },
        domingo: { abre: '12:00', cierra: '21:00' },
      },
    })
    expect(cambios).not.toHaveProperty('actualizado_en')
    expect(cambios).not.toHaveProperty('id')
  })

  it('cambiosDeConfig: el mismo horario en otro orden de claves no cuenta como cambio', () => {
    const reordenado = { ...config, horario: { sabado: config.horario.sabado, lunes: config.horario.lunes } }
    expect(cambiosDeConfig(reordenado, validarConfig(formValido()).datos)).toEqual({})
  })
})
