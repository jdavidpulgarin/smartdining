const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { opcionesCors, origenesPermitidos, ORIGENES_LOCALES } = require('../src/config/cors');

// H-10: cabeceras de seguridad y CORS con lista blanca.
//
// Antes: cors() sin argumentos (Access-Control-Allow-Origin: *), sin helmet y
// con x-powered-by: Express anunciado en cada respuesta.

// ---------------------------------------------------------------------------
// Cabeceras
// ---------------------------------------------------------------------------

test('h-10: ya no se anuncia x-powered-by', async () => {
  const res = await request(app).get('/api/health');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(
    res.headers['x-powered-by'],
    undefined,
    'decirle a quien sondea que es Express le ahorra el primer paso'
  );
});

test('h-10: helmet pone las cabeceras basicas', async () => {
  const res = await request(app).get('/api/health');

  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.headers['x-frame-options'] || res.headers['content-security-policy']);
  assert.ok(res.headers['referrer-policy'], 'no se filtra la URL completa al salir del sitio');
});

test('h-10: las cabeceras tambien estan en una respuesta de error', async () => {
  const res = await request(app).get('/api/ruta-que-no-existe');

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.headers['x-powered-by'], undefined);
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
});

// ---------------------------------------------------------------------------
// Lista de origenes
// ---------------------------------------------------------------------------

test('h-10: en produccion sin CORS_ORIGINS no se permite ningun origen', () => {
  assert.deepStrictEqual(
    origenesPermitidos({ NODE_ENV: 'production' }),
    [],
    'un despliegue sin configurar debe quedarse corto, no abierto'
  );
});

test('h-10: en desarrollo valen los tres puertos locales', () => {
  assert.deepStrictEqual(origenesPermitidos({ NODE_ENV: 'development' }), ORIGENES_LOCALES);
  assert.strictEqual(ORIGENES_LOCALES.length, 3, 'cliente, restaurante y KDS');
});

test('h-10: CORS_ORIGINS manda en cualquier entorno', () => {
  const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://sala.smartdining.co, https://kds.smartdining.co' };

  assert.deepStrictEqual(origenesPermitidos(env), [
    'https://sala.smartdining.co',
    'https://kds.smartdining.co',
  ]);
});

test('h-10: una lista con comas sueltas o espacios no deja entradas vacias', () => {
  const env = { CORS_ORIGINS: ' https://a.co ,, https://b.co , ' };
  assert.deepStrictEqual(origenesPermitidos(env), ['https://a.co', 'https://b.co']);
});

// ---------------------------------------------------------------------------
// La funcion origin del middleware
// ---------------------------------------------------------------------------

/** Ejecuta la decision de CORS para un origen dado. */
function decidir(origen, env) {
  return new Promise((resolve, reject) => {
    opcionesCors(env).origin(origen, (err, permitido) =>
      err ? reject(err) : resolve(permitido)
    );
  });
}

test('h-10: un origen de la lista se permite', async () => {
  const env = { CORS_ORIGINS: 'https://sala.smartdining.co' };
  assert.strictEqual(await decidir('https://sala.smartdining.co', env), true);
});

test('h-10: un origen fuera de la lista no se permite', async () => {
  const env = { CORS_ORIGINS: 'https://sala.smartdining.co' };
  assert.strictEqual(await decidir('https://sitio-cualquiera.com', env), false);
});

test('h-10: una peticion SIN origen se deja pasar', async () => {
  // curl, el socket-server o una prueba no son un navegador: ahi lo que decide
  // el acceso es el JWT o la clave interna, no esta lista.
  assert.strictEqual(await decidir(undefined, { CORS_ORIGINS: 'https://sala.smartdining.co' }), true);
});

test('h-10: en produccion sin configurar, ni siquiera localhost pasa', async () => {
  assert.strictEqual(await decidir('http://localhost:5173', { NODE_ENV: 'production' }), false);
});

test('h-10: se permite la cabecera x-internal-key del canal interno', () => {
  assert.ok(opcionesCors({}).allowedHeaders.includes('x-internal-key'));
  assert.ok(opcionesCors({}).allowedHeaders.includes('Authorization'));
});

test('h-10: no se habilitan credenciales', () => {
  // El backend autentica con Authorization: Bearer, no con cookies.
  assert.strictEqual(opcionesCors({}).credentials, undefined);
});

// ---------------------------------------------------------------------------
// Respuesta real del servidor
// ---------------------------------------------------------------------------

test('h-10: la respuesta no lleva Allow-Origin para un origen no permitido', async () => {
  const res = await request(app)
    .get('/api/health')
    .set('Origin', 'https://sitio-cualquiera.com');

  assert.strictEqual(res.status, 200, 'CORS lo bloquea el navegador, no el servidor');
  assert.notStrictEqual(
    res.headers['access-control-allow-origin'],
    '*',
    'nunca mas un comodin'
  );
  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
});

test('h-10: un origen local si recibe su Allow-Origin en desarrollo', async () => {
  const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5175');

  assert.strictEqual(res.headers['access-control-allow-origin'], 'http://localhost:5175');
});
