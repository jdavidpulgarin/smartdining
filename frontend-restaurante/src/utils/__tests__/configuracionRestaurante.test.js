import { describe, it, expect } from 'vitest'
import {
  DIAS,
  REDES,
  normalizarWhatsapp,
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

  it('validarConfig: devuelve los 9 campos del contrato, con null en los opcionales vacíos', () => {
    const form = { ...formValido(), telefono: '  ', propina_sugerida_pct: '12,5', moneda: 'usd' }
    expect(validarConfig(form)).toEqual({
      datos: {
        nombre: 'SmartDining',
        telefono: null,
        correo: null,
        direccion: 'Calle 1 #2-3',
        url_logo: null,
        redes: {},
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

  // --- correo y redes (script 29, P-21) ---

  const conContacto = {
    ...config,
    correo: 'contacto@smartdining.com.co',
    redes: { instagram: 'https://instagram.com/smartdining', whatsapp: '+573001234567' },
  }

  it('formDesdeConfig: correo y las cuatro redes como texto; las que no están, vacías', () => {
    const form = formDesdeConfig(conContacto)
    expect(form.correo).toBe('contacto@smartdining.com.co')
    expect(form.redes).toEqual({ instagram: 'https://instagram.com/smartdining', facebook: '', tiktok: '', whatsapp: '+573001234567' })
    // Una fila sin las columnas (backend aún sin el script 29) da todo vacío.
    expect(formDesdeConfig(config).correo).toBe('')
    expect(formDesdeConfig(config).redes).toEqual({ instagram: '', facebook: '', tiktok: '', whatsapp: '' })
    expect(REDES.map((r) => r.clave)).toEqual(['instagram', 'facebook', 'tiktok', 'whatsapp'])
  })

  it('validarConfig: las redes vacías no viajan y WhatsApp se guarda sin espacios', () => {
    const form = formValido()
    form.correo = '  reservas@local.co '
    form.redes = { instagram: ' https://www.instagram.com/smart ', facebook: '', tiktok: 'https://tiktok.com/@smart', whatsapp: '+57 (300) 123-4567' }
    const { datos } = validarConfig(form)
    expect(datos.correo).toBe('reservas@local.co')
    expect(datos.redes).toEqual({ instagram: 'https://www.instagram.com/smart', tiktok: 'https://tiktok.com/@smart', whatsapp: '+573001234567' })
    expect(normalizarWhatsapp('+57 300.123 45-67')).toBe('+573001234567')
  })

  it('validarConfig: correo y redes con las mismas reglas que los CHECK de la base', () => {
    const conRed = (clave, valor) => ({ ...formValido(), redes: { instagram: '', facebook: '', tiktok: '', whatsapp: '', [clave]: valor } })
    const casos = [
      [{ ...formValido(), correo: 'sin-arroba.com' }, /correo/],
      [{ ...formValido(), correo: 'dos@@local.co' }, /correo/],
      [{ ...formValido(), correo: 'con espacio@local.co' }, /correo/],
      [{ ...formValido(), correo: 'sin@dominio' }, /correo/],
      [{ ...formValido(), correo: `${'x'.repeat(250)}@a.co` }, /254/],
      [conRed('instagram', 'instagram.com/smart'), /^Instagram/],
      [conRed('instagram', 'http://instagram.com/smart'), /^Instagram/],
      [conRed('instagram', 'https://instagram.com.evil.co/smart'), /^Instagram/],
      [conRed('facebook', 'https://youtube.com/smart'), /^Facebook/],
      [conRed('tiktok', 'https://tiktok.com/'), /^TikTok/],
      [conRed('whatsapp', '3001234567'), /^WhatsApp/],
      [conRed('whatsapp', '+0573001234567'), /^WhatsApp/],
      [conRed('whatsapp', '+12345'), /^WhatsApp/],
      [conRed('facebook', `https://facebook.com/${'x'.repeat(190)}`), /^Facebook/],
    ]
    for (const [form, mensaje] of casos) {
      expect(validarConfig(form).error).toMatch(mensaje)
    }
    expect(validarConfig(conRed('facebook', 'https://fb.com/smart')).datos.redes).toEqual({ facebook: 'https://fb.com/smart' })
  })

  it('cambiosDeConfig: correo y redes solo viajan si cambiaron', () => {
    // Fila sin las columnas y formulario vacío: no hay cambio (guardar lo demás no da 400).
    expect(cambiosDeConfig(config, validarConfig(formValido()).datos)).toEqual({})

    const sinCambios = validarConfig(formDesdeConfig(conContacto)).datos
    expect(cambiosDeConfig(conContacto, sinCambios)).toEqual({})
    // Las mismas redes en otro orden de claves tampoco.
    const reordenado = { ...conContacto, redes: { whatsapp: '+573001234567', instagram: 'https://instagram.com/smartdining' } }
    expect(cambiosDeConfig(reordenado, sinCambios)).toEqual({})

    const form = formDesdeConfig(conContacto)
    form.correo = ''
    form.redes.instagram = ''
    form.redes.facebook = 'https://facebook.com/smartdining'
    expect(cambiosDeConfig(conContacto, validarConfig(form).datos)).toEqual({
      correo: null,
      redes: { facebook: 'https://facebook.com/smartdining', whatsapp: '+573001234567' },
    })
  })
})
