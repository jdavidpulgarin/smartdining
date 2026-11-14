import { describe, it, expect } from 'vitest'
import { urlImagen, urlImagenGuardable } from '../imagenes'
import { API_URL } from '../../services/api'

const RUTA = '/imagenes/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b.webp'

describe('urlImagen (pintar en el panel)', () => {
  it('sin apiBase usa el origen de API_URL del panel', () => {
    expect(urlImagen(RUTA)).toBe(`${new URL(API_URL).origin}${RUTA}`)
  })

  it('con apiBase explícita usa ese origen', () => {
    expect(urlImagen(RUTA, 'https://api.staging.smartdining.com.co/api')).toBe(`https://api.staging.smartdining.com.co${RUTA}`)
  })

  it.each([['http://fotos.co/a.png'], ['javascript:alert(1)'], [null]])('%s → null', (v) => {
    expect(urlImagen(v)).toBeNull()
  })
})

describe('urlImagenGuardable (lo que acepta el backend, #209)', () => {
  it.each([[''], ['   '], [null], [undefined], [RUTA], [`  ${RUTA}  `], ['https://images.unsplash.com/photo-1?w=500']])(
    '%s → se puede guardar', (v) => {
      expect(urlImagenGuardable(v)).toBe(true)
    }
  )

  it.each([
    ['http://fotos.co/a.png'], ['HTTP://fotos.co/a.png'], ['javascript:alert(1)'], ['data:image/png;base64,AA'],
    ['//evil.com/a.png'], ['../x.webp'], ['/imagenes/../x.webp'], ['/imagenes/x.png'], ['imagenes/x.webp'],
    [`https://api.staging.smartdining.com.co${RUTA}`.replace('https', 'http')], ['https://fotos.co/a b.png'],
  ])('%s → no', (v) => {
    expect(urlImagenGuardable(v)).toBe(false)
  })
})
