const multer = require('multer');
const { maxBytesImagen } = require('../config/imagenes');
const imagenesService = require('../services/imagenes.service');

/**
 * POST /api/imagenes (D-23). Solo admin. Errores SIEMPRE { error, motivo }.
 *
 * Nunca se registra el contenido del archivo ni su nombre original: en los
 * logs solo aparece el código del error.
 */

const MOTIVOS = Object.freeze({
  sinArchivo: 'sin_archivo',
  muyGrande: 'archivo_muy_grande',
  tipo: 'tipo_no_permitido',
  invalida: 'imagen_invalida',
  interno: 'error_interno',
});

const CAMPO = 'imagen';

const MENSAJE_SIN_ARCHIVO =
  `Manda UN archivo en el campo "${CAMPO}" (multipart/form-data), sin otros campos`;

/**
 * multer en MEMORIA (memoryStorage): nada toca el disco hasta que la imagen se
 * haya validado y re-codificado. Límites:
 *   - fileSize: IMAGENES_MAX_BYTES (2 MB por defecto) -> 413;
 *   - files 1 y fields 0: un archivo y nada más -> 400;
 *   - parts 2: el archivo y, como mucho, una parte que de todas formas se
 *     rechaza; corta un cuerpo con miles de partes antes de leerlas;
 *   - fieldNameSize y headerPairs acotados.
 * Se crea en cada petición para leer el tamaño del entorno en ese momento
 * (las pruebas lo cambian); es un objeto barato.
 */
function recibirArchivo(req, res, next) {
  const subida = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytesImagen(),
      files: 1,
      fields: 0,
      parts: 2,
      fieldNameSize: 100,
      headerPairs: 20,
    },
  }).single(CAMPO);

  subida(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `El archivo supera el máximo de ${maxBytesImagen()} bytes`,
        motivo: MOTIVOS.muyGrande,
      });
    }
    // Cualquier otro problema del multipart es culpa del cuerpo: otro nombre de
    // campo, dos archivos, campos de texto, demasiadas partes o un cuerpo mal
    // formado. Nunca un 500.
    return res.status(400).json({ error: MENSAJE_SIN_ARCHIVO, motivo: MOTIVOS.sinArchivo });
  });
}

async function subir(req, res) {
  const archivo = req.file;
  if (!archivo || !archivo.buffer || archivo.buffer.length === 0) {
    return res.status(400).json({ error: MENSAJE_SIN_ARCHIVO, motivo: MOTIVOS.sinArchivo });
  }

  // El tipo por los primeros bytes; el Content-Type y la extensión no cuentan.
  if (!imagenesService.detectarTipo(archivo.buffer)) {
    return res.status(415).json({
      error: 'Solo se aceptan imágenes JPEG, PNG o WebP',
      motivo: MOTIVOS.tipo,
    });
  }

  let webp;
  try {
    webp = await imagenesService.recodificar(archivo.buffer);
  } catch {
    // No se registra el error de sharp: puede citar trozos del archivo.
    return res.status(422).json({
      error: 'La imagen está dañada o no se puede procesar',
      motivo: MOTIVOS.invalida,
    });
  }

  try {
    const { ruta } = await imagenesService.guardar(webp);
    return res.status(201).json({ ruta });
  } catch (err) {
    console.error(`[imagenes] no se pudo guardar la imagen (${err && err.code})`);
    return res.status(500).json({ error: 'No se pudo guardar la imagen', motivo: MOTIVOS.interno });
  }
}

module.exports = {
  recibirArchivo,
  subir,
  MOTIVOS,
  CAMPO,
};
