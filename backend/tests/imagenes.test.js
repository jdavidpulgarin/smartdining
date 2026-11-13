const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { crearLimitadorImagenes } = require('../src/middleware/limites.middleware');
const { servirImagenesLocales } = require('../src/middleware/imagenes-estaticas');
const imagenesService = require('../src/services/imagenes.service');
const { PATRON_RUTA_IMAGEN } = require('../src/utils/url-imagen');
const { MAX_BYTES_POR_DEFECTO } = require('../src/config/imagenes');
const app = require('../server');

// D-23: POST /api/imagenes. No hay binarios en el repo: cada imagen se genera
// aquí con sharp. Cada prueba usa un IMAGENES_DIR temporal propio y lo borra.

const RUTA = '/api/imagenes';
const ADMIN = 1;

/** IMAGENES_DIR temporal y la base falsa (requireAuth mira si el usuario sigue activo). */
function escenario() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-imagenes-'));
  const previo = process.env.IMAGENES_DIR;
  process.env.IMAGENES_DIR = dir;
  const db = instalarFakeDb(() => ({ rows: [] }));
  return {
    dir,
    archivos: () => fs.readdirSync(dir),
    restaurar() {
      db.restaurar();
      if (previo === undefined) delete process.env.IMAGENES_DIR;
      else process.env.IMAGENES_DIR = previo;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const conToken = (req, token = tokenStaff(ADMIN, 'admin')) => req.set('Authorization', `Bearer ${token}`);

/** Sube `buffer` en el campo "imagen" (o el que se diga), con nombre y tipo a elección. */
function subir(buffer, { campo = 'imagen', nombre = 'foto.png', tipo = 'image/png', token } = {}) {
  return conToken(request(app).post(RUTA), token).attach(campo, buffer, { filename: nombre, contentType: tipo });
}

const lienzo = (width, height) => sharp({ create: { width, height, channels: 3, background: '#d2691e' } });

/** La ruta de la respuesta -> el archivo en el IMAGENES_DIR de la prueba. */
const archivoDe = (e, ruta) => path.join(e.dir, path.basename(ruta));

/**
 * Metadatos de un archivo guardado. Se lee a memoria primero: `sharp(ruta)`
 * deja el archivo abierto en la caché de libvips y en Windows eso impide
 * borrar la carpeta temporal al final de la prueba.
 */
const metaDe = (archivo) => sharp(fs.readFileSync(archivo)).metadata();

// --- Subidas válidas ------------------------------------------------------------

for (const [tipo, generar, mime] of [
  ['PNG', () => lienzo(2400, 1200).png().toBuffer(), 'image/png'],
  ['JPEG', () => lienzo(1600, 2000).jpeg().toBuffer(), 'image/jpeg'],
  ['WebP', () => lienzo(800, 600).webp().toBuffer(), 'image/webp'],
]) {
  test(`imagenes: admin sube un ${tipo} -> 201, WebP de máx. 1200 px guardado con nombre del servidor`, async () => {
    const e = escenario();
    try {
      const res = await subir(await generar(), { tipo: mime, nombre: `original.${tipo.toLowerCase()}` });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.deepStrictEqual(Object.keys(res.body), ['ruta']);
      assert.match(res.body.ruta, PATRON_RUTA_IMAGEN);

      const archivo = archivoDe(e, res.body.ruta);
      assert.ok(fs.existsSync(archivo), 'el archivo existe');
      const meta = await metaDe(archivo);
      assert.strictEqual(meta.format, 'webp');
      assert.ok(Math.max(meta.width, meta.height) <= 1200, `${meta.width}x${meta.height}`);
      assert.deepStrictEqual(e.archivos(), [path.basename(res.body.ruta)], 'ni temporales ni otros archivos');
      if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(archivo).mode & 0o777, 0o644, 'permisos 0644');
      }
    } finally {
      e.restaurar();
    }
  });
}

test('imagenes: una imagen pequeña no se agranda', async () => {
  const e = escenario();
  try {
    const res = await subir(await lienzo(300, 200).png().toBuffer());
    assert.strictEqual(res.status, 201);
    const meta = await metaDe(archivoDe(e, res.body.ruta));
    assert.deepStrictEqual([meta.width, meta.height], [300, 200]);
  } finally {
    e.restaurar();
  }
});

test('imagenes: un JPEG con EXIF y GPS sale SIN metadatos', async () => {
  const e = escenario();
  try {
    const conGps = await lienzo(640, 480)
      .jpeg()
      .withExif({
        IFD0: { Copyright: 'dueño de la foto', Artist: 'Ana' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '10/1 28/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '73/1 15/1 0/1' },
      })
      .toBuffer();
    const entrada = await sharp(conGps).metadata();
    assert.ok(entrada.exif && entrada.exif.length > 0, 'la entrada SÍ trae EXIF');
    assert.ok(entrada.exif.includes(Buffer.from('Ana')), 'con los datos puestos');

    const res = await subir(conGps, { tipo: 'image/jpeg', nombre: 'gps.jpg' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const archivo = archivoDe(e, res.body.ruta);
    const salida = await metaDe(archivo);
    assert.strictEqual(salida.exif, undefined, 'sin EXIF');
    assert.strictEqual(salida.icc, undefined, 'sin perfil ICC');
    assert.strictEqual(salida.xmp, undefined, 'sin XMP');
    const bytes = fs.readFileSync(archivo);
    assert.ok(!bytes.includes(Buffer.from('Ana')) && !bytes.includes(Buffer.from('EXIF')), 'ni rastro en los bytes');
  } finally {
    e.restaurar();
  }
});

test('imagenes: aplica la orientación EXIF (.rotate()) antes de quitar los metadatos', async () => {
  const e = escenario();
  try {
    // 400x200 con orientación 6 (girar 90°): se ve vertical, 200x400.
    const girada = await lienzo(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const res = await subir(girada, { tipo: 'image/jpeg', nombre: 'girada.jpg' });
    assert.strictEqual(res.status, 201);
    const meta = await metaDe(archivoDe(e, res.body.ruta));
    assert.deepStrictEqual([meta.width, meta.height], [200, 400]);
    assert.strictEqual(meta.orientation, undefined);
  } finally {
    e.restaurar();
  }
});

test('imagenes: el nombre del usuario no aparece en la ruta ni en el disco', async () => {
  const e = escenario();
  try {
    const res = await subir(await lienzo(50, 50).png().toBuffer(), { nombre: 'mi-foto-secreta.png' });
    assert.strictEqual(res.status, 201);
    assert.ok(!res.body.ruta.includes('secreta'));
    assert.ok(!e.archivos().some((a) => a.includes('secreta') || a.includes('mi-foto')));
  } finally {
    e.restaurar();
  }
});

// --- Tipo por los primeros bytes ---------------------------------------------------

for (const [caso, contenido, nombre, tipo] of [
  ['un texto con Content-Type image/png', Buffer.from('hola, no soy una imagen'), 'foto.png', 'image/png'],
  ['un .exe disfrazado de .png', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]), 'foto.png', 'image/png'],
  ['un GIF de verdad', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'), 'foto.gif', 'image/gif'],
  ['un SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'foto.svg', 'image/svg+xml'],
]) {
  test(`imagenes: ${caso} -> 415 tipo_no_permitido y no se guarda nada`, async () => {
    const e = escenario();
    try {
      const res = await subir(contenido, { nombre, tipo });
      assert.strictEqual(res.status, 415);
      assert.strictEqual(res.body.motivo, 'tipo_no_permitido');
      assert.ok(res.body.error);
      assert.deepStrictEqual(e.archivos(), []);
    } finally {
      e.restaurar();
    }
  });
}

test('imagenes: una imagen real con Content-Type y extensión falsos se acepta (manda el contenido)', async () => {
  const e = escenario();
  try {
    const res = await subir(await lienzo(60, 60).png().toBuffer(), { nombre: 'documento.txt', tipo: 'text/plain' });
    assert.strictEqual(res.status, 201);
  } finally {
    e.restaurar();
  }
});

test('imagenes: cabecera PNG válida y cuerpo corrupto -> 422 imagen_invalida', async () => {
  const e = escenario();
  try {
    const png = await lienzo(100, 100).png().toBuffer();
    const corrupto = Buffer.concat([png.subarray(0, 8), Buffer.alloc(500, 0x41)]);
    const res = await subir(corrupto);
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.motivo, 'imagen_invalida');
    assert.deepStrictEqual(e.archivos(), []);
  } finally {
    e.restaurar();
  }
});

test('imagenes: un PNG truncado -> 422', async () => {
  const e = escenario();
  try {
    const png = await lienzo(300, 300).png().toBuffer();
    const res = await subir(png.subarray(0, Math.floor(png.length / 2)));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.motivo, 'imagen_invalida');
  } finally {
    e.restaurar();
  }
});

test('imagenes: por encima del tope de píxeles de entrada (bomba de descompresión) -> 422', async () => {
  // El tope real es de 40 M; aquí se baja para no generar una imagen enorme en
  // la prueba, y se comprueba que recodificar respeta un límite de sharp.
  assert.strictEqual(imagenesService.LIMITE_PIXELES_ENTRADA, 40_000_000);
  const grande = await lienzo(7000, 6000).png({ compressionLevel: 9 }).toBuffer(); // 42 M píxeles
  await assert.rejects(() => imagenesService.recodificar(grande), /pixel limit|exceeds/i);
});

// --- Tamaño ------------------------------------------------------------------------

test('imagenes: más de 2 MB -> 413 archivo_muy_grande (no 500)', async () => {
  const e = escenario();
  try {
    assert.strictEqual(MAX_BYTES_POR_DEFECTO, 2097152);
    const cabecera = await lienzo(10, 10).png().toBuffer();
    const enorme = Buffer.concat([cabecera, Buffer.alloc(MAX_BYTES_POR_DEFECTO + 1 - cabecera.length, 0)]);
    assert.strictEqual(enorme.length, MAX_BYTES_POR_DEFECTO + 1);
    const res = await subir(enorme);
    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.body.motivo, 'archivo_muy_grande');
    assert.ok(res.body.error);
    assert.deepStrictEqual(e.archivos(), []);
  } finally {
    e.restaurar();
  }
});

test('imagenes: IMAGENES_MAX_BYTES cambia el máximo', async () => {
  const e = escenario();
  const previo = process.env.IMAGENES_MAX_BYTES;
  process.env.IMAGENES_MAX_BYTES = '1000';
  try {
    const res = await subir(await lienzo(400, 400).png().toBuffer());
    assert.strictEqual(res.status, 413);
  } finally {
    if (previo === undefined) delete process.env.IMAGENES_MAX_BYTES;
    else process.env.IMAGENES_MAX_BYTES = previo;
    e.restaurar();
  }
});

// --- Forma del multipart -------------------------------------------------------------

test('imagenes: sin archivo (cuerpo JSON vacío) -> 400 sin_archivo', async () => {
  const e = escenario();
  try {
    const res = await conToken(request(app).post(RUTA)).send({});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'sin_archivo');
  } finally {
    e.restaurar();
  }
});

test('imagenes: multipart solo con un campo de texto -> 400 sin_archivo', async () => {
  const e = escenario();
  try {
    const res = await conToken(request(app).post(RUTA)).field('nombre', 'x');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'sin_archivo');
  } finally {
    e.restaurar();
  }
});

test('imagenes: el archivo en un campo con otro nombre -> 400 sin_archivo', async () => {
  const e = escenario();
  try {
    const res = await subir(await lienzo(20, 20).png().toBuffer(), { campo: 'foto' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'sin_archivo');
    assert.deepStrictEqual(e.archivos(), []);
  } finally {
    e.restaurar();
  }
});

test('imagenes: dos archivos -> 400 sin_archivo y no se guarda ninguno', async () => {
  const e = escenario();
  try {
    const png = await lienzo(20, 20).png().toBuffer();
    const res = await conToken(request(app).post(RUTA))
      .attach('imagen', png, { filename: 'a.png', contentType: 'image/png' })
      .attach('imagen', png, { filename: 'b.png', contentType: 'image/png' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'sin_archivo');
    assert.deepStrictEqual(e.archivos(), []);
  } finally {
    e.restaurar();
  }
});

test('imagenes: el archivo y además un campo de texto -> 400 (nada más que la imagen)', async () => {
  const e = escenario();
  try {
    const res = await conToken(request(app).post(RUTA))
      .field('id_plato', '7')
      .attach('imagen', await lienzo(20, 20).png().toBuffer(), { filename: 'a.png', contentType: 'image/png' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'sin_archivo');
  } finally {
    e.restaurar();
  }
});

// --- Quién -----------------------------------------------------------------------------

test('imagenes: sin token -> 401', async () => {
  const e = escenario();
  try {
    const res = await request(app).post(RUTA).attach('imagen', await lienzo(20, 20).png().toBuffer(), 'a.png');
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(e.archivos(), []);
  } finally {
    e.restaurar();
  }
});

for (const [rol, token] of [
  ['mesero', () => tokenStaff(2, 'mesero')],
  ['cajero', () => tokenStaff(3, 'cajero')],
  ['cocina', () => tokenStaff(4, 'cocina')],
  ['comensal', () => tokenComensal(5)],
]) {
  test(`imagenes: ${rol} -> 403 y no se guarda nada`, async () => {
    const e = escenario();
    try {
      const res = await subir(await lienzo(20, 20).png().toBuffer(), { token: token() });
      assert.strictEqual(res.status, 403);
      assert.deepStrictEqual(e.archivos(), []);
    } finally {
      e.restaurar();
    }
  });
}

// --- Límite por usuario ------------------------------------------------------------------
// El limitador se apaga solo dentro de las pruebas; aquí se monta en una app
// mínima con un entorno de producción simulado, como en limites-intentos.test.js.

test('imagenes: tras el máximo por usuario -> 429 demasiadas_peticiones con Retry-After; otro usuario sigue', async () => {
  const appLimitada = express();
  appLimitada.use((req, res, next) => {
    req.user = { id_usuario: Number(req.get('x-usuario')), rol: 'admin' };
    next();
  });
  appLimitada.post(
    '/subir',
    crearLimitadorImagenes({ NODE_ENV: 'production', RATE_LIMIT_IMAGENES_MAX: '3', RATE_LIMIT_IMAGENES_VENTANA_MS: '60000' }),
    (req, res) => res.status(201).json({ ok: true })
  );

  for (let i = 0; i < 3; i++) {
    assert.strictEqual((await request(appLimitada).post('/subir').set('x-usuario', '1')).status, 201);
  }
  const res = await request(appLimitada).post('/subir').set('x-usuario', '1');
  assert.strictEqual(res.status, 429);
  assert.strictEqual(res.body.motivo, 'demasiadas_peticiones');
  assert.ok(res.body.error);
  assert.ok(res.headers['retry-after'], 'Retry-After');
  assert.strictEqual((await request(appLimitada).post('/subir').set('x-usuario', '2')).status, 201, 'cuenta por usuario, no por IP');
});

test('imagenes: el límite por defecto es 30 cada 10 minutos', async () => {
  const appLimitada = express();
  appLimitada.use((req, res, next) => { req.user = { id_usuario: 9 }; next(); });
  appLimitada.post('/subir', crearLimitadorImagenes({ NODE_ENV: 'production' }), (req, res) => res.sendStatus(201));
  const res = await request(appLimitada).post('/subir');
  assert.strictEqual(res.headers['ratelimit-policy'], '30;w=600');
});

// --- Servir en local -------------------------------------------------------------------

test('imagenes: en desarrollo GET /imagenes/<uuid>.webp sirve el archivo con nosniff', async () => {
  const e = escenario();
  try {
    const subida = await subir(await lienzo(40, 40).png().toBuffer());
    assert.strictEqual(subida.status, 201);
    const res = await request(app).get(subida.body.ruta);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'image/webp');
    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
  } finally {
    e.restaurar();
  }
});

test('imagenes: GET /imagenes no lista ni sirve nada fuera del patrón', async () => {
  const e = escenario();
  try {
    fs.writeFileSync(path.join(e.dir, 'notas.txt'), 'privado');
    fs.writeFileSync(path.join(e.dir, '.oculto.webp.tmp'), 'tmp');
    for (const url of [
      '/imagenes/',
      '/imagenes',
      '/imagenes/notas.txt',
      '/imagenes/.oculto.webp.tmp',
      '/imagenes/%2e%2e/server.js',
      '/imagenes/../server.js',
      '/imagenes/00000000-0000-0000-0000-000000000000.png',
      '/imagenes/00000000-0000-0000-0000-000000000000.webp', // no existe
    ]) {
      const res = await request(app).get(url);
      assert.strictEqual(res.status, 404, `${url} -> ${res.status}`);
      assert.ok(!String(res.text).includes('privado'));
    }
  } finally {
    e.restaurar();
  }
});

test('imagenes: en producción el backend NO monta /imagenes (lo sirve nginx)', () => {
  assert.strictEqual(servirImagenesLocales({ NODE_ENV: 'production' }), null);
  assert.ok(servirImagenesLocales({ NODE_ENV: 'development' }));
  assert.ok(servirImagenesLocales({}));
});

// --- detectarTipo ------------------------------------------------------------------------

test('imagenes: detectarTipo mira solo los primeros bytes', () => {
  assert.strictEqual(imagenesService.detectarTipo(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.strictEqual(imagenesService.detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.strictEqual(imagenesService.detectarTipo(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1')), 'webp');
  assert.strictEqual(imagenesService.detectarTipo(Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt ', 'latin1')), null, 'un WAV también es RIFF');
  assert.strictEqual(imagenesService.detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null, 'PNG a medias');
  assert.strictEqual(imagenesService.detectarTipo(Buffer.alloc(0)), null);
  assert.strictEqual(imagenesService.detectarTipo('no es un buffer'), null);
});
