// Subida de imágenes del menú desde el panel (D-23, #209).
//
// Antes de subir se revisa lo mismo que revisa el backend y que se puede saber
// sin decodificar la imagen: tamaño (IMAGENES_MAX_BYTES, 2 MB por defecto) y
// tipo POR EL CONTENIDO (los primeros bytes, como el backend; ni la extensión
// ni el type del navegador). Lo demás (imagen corrupta, más de 40 Mpx) lo dice
// el backend y se muestra su motivo. El backend sigue siendo quien decide: esto
// solo evita una subida que va a fallar.

/** Igual que IMAGENES_MAX_BYTES del backend por defecto (2097152). */
export const MAX_BYTES_IMAGEN = 2 * 1024 * 1024

/** Para el input: el selector de archivos ofrece solo estos. */
export const ACEPTA_IMAGEN = 'image/jpeg,image/png,image/webp'

const empiezaCon = (bytes, firma, desde = 0) => firma.every((b, i) => bytes[desde + i] === b)

/**
 * Tipo de imagen por los primeros bytes (magic numbers), como el backend:
 * JPEG FF D8 FF; PNG 89 50 4E 47 0D 0A 1A 0A; WebP "RIFF" .... "WEBP".
 *
 * @param {Uint8Array} bytes al menos los 12 primeros
 * @returns {'jpeg' | 'png' | 'webp' | null}
 */
export function tipoPorContenido(bytes) {
  if (!bytes || bytes.length < 3) return null
  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (bytes.length >= 12 && empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp'
  return null
}

const megas = (n) => `${(n / (1024 * 1024)).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB`

/**
 * Revisa el archivo elegido antes de subirlo.
 *
 * @param {File | Blob | null | undefined} archivo
 * @param {number} [maxBytes]
 * @returns {Promise<string | null>} el motivo para mostrar, o null si se puede subir
 */
export async function revisarArchivoImagen(archivo, maxBytes = MAX_BYTES_IMAGEN) {
  if (!archivo) return 'Elige una imagen.'
  if (archivo.size === 0) return 'El archivo está vacío.'
  if (archivo.size > maxBytes) {
    return `La imagen pesa ${megas(archivo.size)}; el máximo es ${megas(maxBytes)}. Redúcela o elige otra.`
  }
  const cabeza = new Uint8Array(await archivo.slice(0, 12).arrayBuffer())
  if (!tipoPorContenido(cabeza)) return 'Solo se pueden subir imágenes JPEG, PNG o WebP.'
  return null
}

/**
 * Mensaje para un error de POST /imagenes, por su motivo (api-spec, D-23).
 *
 * @param {Error & { motivo?: string, status?: number, retryAfter?: number, sinConexion?: boolean }} err
 * @returns {string}
 */
export function mensajeErrorSubida(err) {
  if (err?.sinConexion) return 'Sin conexión: la imagen no se subió.'
  switch (err?.motivo) {
    case 'archivo_muy_grande':
      return `La imagen supera el máximo de ${megas(MAX_BYTES_IMAGEN)} del servidor.`
    case 'tipo_no_permitido':
      return 'El servidor solo acepta imágenes JPEG, PNG o WebP.'
    case 'imagen_invalida':
      return 'El servidor no pudo leer la imagen: puede estar dañada o ser demasiado grande en píxeles.'
    case 'sin_archivo':
      return 'No llegó ninguna imagen al servidor. Vuelve a elegirla.'
    case 'demasiadas_peticiones': {
      const min = Math.max(1, Math.ceil((err.retryAfter || 60) / 60))
      return `Subiste muchas imágenes seguidas. Espera ${min} min y vuelve a intentarlo.`
    }
    default:
      break
  }
  if (err?.status === 403) return 'Solo un administrador puede subir imágenes.'
  return err?.message ? `La imagen no se subió: ${err.message}` : 'La imagen no se subió.'
}
