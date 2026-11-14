import { describe, it, expect } from 'vitest'
import { tipoPorContenido, revisarArchivoImagen, mensajeErrorSubida, MAX_BYTES_IMAGEN } from '../subidaImagen'

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const archivo = (bytes, nombre, type, relleno = 0) =>
  new File([new Uint8Array([...bytes, ...new Array(relleno).fill(0)])], nombre, { type })

describe('tipoPorContenido: por los primeros bytes, como el backend', () => {
  it.each([[JPEG, 'jpeg'], [PNG, 'png'], [WEBP, 'webp']])('%#: %s', (bytes, tipo) => {
    expect(tipoPorContenido(new Uint8Array(bytes))).toBe(tipo)
  })

  it.each([
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]],
    ['RIFF que no es WebP (WAV)', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]],
    ['texto', [...new TextEncoder().encode('hola mundo!!')]],
    ['PNG cortado', [0x89, 0x50, 0x4e, 0x47]],
    ['vacío', []],
  ])('%s → null', (_, bytes) => {
    expect(tipoPorContenido(new Uint8Array(bytes))).toBeNull()
  })
})

describe('revisarArchivoImagen: los mismos límites del backend, antes de subir', () => {
  it('JPEG, PNG y WebP pequeños se pueden subir', async () => {
    for (const b of [JPEG, PNG, WEBP]) expect(await revisarArchivoImagen(archivo(b, 'x', 'image/png'))).toBeNull()
  })

  it('decide por el CONTENIDO: un PNG real con nombre .txt y type text/plain se acepta', async () => {
    expect(await revisarArchivoImagen(archivo(PNG, 'documento.txt', 'text/plain'))).toBeNull()
  })

  it('y un texto con nombre .png y type image/png se rechaza', async () => {
    expect(await revisarArchivoImagen(archivo([...new TextEncoder().encode('no soy imagen')], 'foto.png', 'image/png')))
      .toMatch(/JPEG, PNG o WebP/)
  })

  it('exactamente 2 MB pasa; un byte más, no (IMAGENES_MAX_BYTES = 2097152)', async () => {
    expect(MAX_BYTES_IMAGEN).toBe(2097152)
    expect(await revisarArchivoImagen(archivo(JPEG, 'a.jpg', 'image/jpeg', MAX_BYTES_IMAGEN - JPEG.length))).toBeNull()
    expect(await revisarArchivoImagen(archivo(JPEG, 'a.jpg', 'image/jpeg', MAX_BYTES_IMAGEN - JPEG.length + 1))).toMatch(/máximo es 2 MB/)
  })

  it('sin archivo o vacío → motivo', async () => {
    expect(await revisarArchivoImagen(null)).toMatch(/Elige/)
    expect(await revisarArchivoImagen(new File([], 'v.png'))).toMatch(/vacío/)
  })
})

describe('mensajeErrorSubida: el motivo del backend en palabras', () => {
  it.each([
    [{ motivo: 'archivo_muy_grande', status: 413 }, /supera el máximo/],
    [{ motivo: 'tipo_no_permitido', status: 415 }, /JPEG, PNG o WebP/],
    [{ motivo: 'imagen_invalida', status: 422 }, /dañada/],
    [{ motivo: 'sin_archivo', status: 400 }, /No llegó/],
    [{ motivo: 'demasiadas_peticiones', status: 429, retryAfter: 125 }, /Espera 3 min/],
    // 429 de nginx (limit_req): cuerpo HTML, sin motivo → el mismo mensaje (revisión de Roberto en #230)
    [{ status: 429, message: 'Error 429' }, /Subiste muchas imágenes seguidas. Espera 1 min/],
    [{ status: 403, message: 'Prohibido' }, /administrador/],
    [{ sinConexion: true }, /Sin conexión/],
    [{ status: 500, message: 'Error interno' }, /no se subió: Error interno/],
  ])('%o', (err, esperado) => {
    expect(mensajeErrorSubida(err)).toMatch(esperado)
  })
})
