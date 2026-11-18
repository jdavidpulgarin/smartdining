const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { directorioImagenes } = require('../config/imagenes');

/**
 * D-23: subida de imágenes del menú. Tres pasos, sin tocar la base:
 *
 *   1. detectarTipo: el tipo se decide por los PRIMEROS BYTES del archivo
 *      (magic numbers), nunca por el Content-Type ni por la extensión, que
 *      los pone quien sube y pueden mentir.
 *   2. recodificar: SIEMPRE se re-codifica con sharp. Lo que se guarda nunca
 *      es el archivo original: así no sobrevive nada escondido en él
 *      (metadatos, EXIF con GPS, bytes de más detrás de la imagen).
 *   3. guardar: nombre generado por el servidor (uuid), escritura atómica.
 */

/** Tipos aceptados, por sus primeros bytes. */
const FIRMA_JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lado máximo de la imagen guardada. */
const LADO_MAXIMO = 1200;
const CALIDAD_WEBP = 80;

/**
 * Tope de píxeles de ENTRADA contra las "bombas de descompresión": un PNG de
 * pocos KB que declara 50 000 × 50 000 píxeles pediría gigas de memoria al
 * decodificarlo. 40 millones cubre de sobra una foto de móvil (12 a 24 MP).
 */
const LIMITE_PIXELES_ENTRADA = 40_000_000;

/** 'jpeg' | 'png' | 'webp' | null, mirando solo los primeros bytes. */
function detectarTipo(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= FIRMA_JPEG.length && buffer.subarray(0, 3).equals(FIRMA_JPEG)) return 'jpeg';
  if (buffer.length >= FIRMA_PNG.length && buffer.subarray(0, 8).equals(FIRMA_PNG)) return 'png';
  // RIFF <tamaño de 4 bytes> WEBP
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('latin1') === 'RIFF'
    && buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * Re-codifica a WebP: aplica la orientación EXIF (.rotate()), reduce a como
 * mucho 1200 px de lado sin agrandar, y sale SIN metadatos (sharp los quita
 * salvo que se pida withMetadata, que aquí no se usa a propósito).
 *
 * Lanza si sharp no puede leer la imagen (corrupta, truncada o por encima del
 * tope de píxeles); quien llama lo traduce a 422.
 */
async function recodificar(buffer) {
  return sharp(buffer, { limitInputPixels: LIMITE_PIXELES_ENTRADA, failOn: 'error' })
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: CALIDAD_WEBP })
    .toBuffer();
}

/**
 * Guarda el WebP con un nombre que genera el servidor y devuelve la ruta
 * pública relativa (`/imagenes/<uuid>.webp`). El nombre que traía el archivo
 * no se usa nunca.
 *
 * Escritura ATÓMICA: primero un temporal en la MISMA carpeta (rename solo es
 * atómico dentro del mismo sistema de archivos) y después rename. Quien sirva
 * la carpeta (nginx en producción) nunca ve un archivo a medio escribir.
 * Permisos 0644: el backend escribe, nginx solo lee.
 *
 * La carpeta se crea al primer uso (mkdir recursive), no al arrancar: si el
 * volumen viniera mal montado, falla la subida y no el arranque de la API.
 */
async function guardar(webp, env = process.env) {
  const dir = directorioImagenes(env);
  await fs.mkdir(dir, { recursive: true });

  const nombre = `${crypto.randomUUID()}.webp`;
  const destino = path.join(dir, nombre);
  const temporal = path.join(dir, `.${nombre}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporal, webp, { mode: 0o644, flag: 'wx' });
    await fs.chmod(temporal, 0o644);
    await fs.rename(temporal, destino);
  } catch (err) {
    await fs.rm(temporal, { force: true }).catch(() => {});
    throw err;
  }
  return { nombre, ruta: `/imagenes/${nombre}`, archivo: destino };
}

module.exports = {
  detectarTipo,
  recodificar,
  guardar,
  LADO_MAXIMO,
  CALIDAD_WEBP,
  LIMITE_PIXELES_ENTRADA,
};
