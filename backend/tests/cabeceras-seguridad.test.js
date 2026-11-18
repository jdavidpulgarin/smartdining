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

test('h-10: el modo red local NO mete nada en la LISTA de orígenes', () => {
  // La regla de IP privada del modo red local (tests/modo-red-local.test.js) es
  // un predicado dentro de `origin`, no una entrada de la lista: así la lista
  // sigue siendo finita y comparable letra por letra, que es lo que sostiene
  // todo lo demás de este archivo. Si alguien la convirtiera en entradas
  // generadas, esta prueba lo avisa.
  assert.deepStrictEqual(origenesPermitidos({ NODE_ENV: 'development' }), ORIGENES_LOCALES);
  for (const origen of origenesPermitidos({ NODE_ENV: 'development' })) {
    assert.ok(origen.startsWith('http://localhost:'), origen);
  }
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

// ---------------------------------------------------------------------------
// D-11: orígenes que se parecen a los permitidos
//
// La lista blanca se compara con `includes`, o sea cadena exacta. Eso es lo
// correcto, y estas pruebas lo fijan: el fallo clásico de una lista de orígenes
// es compararla con `startsWith` o con una expresión regular mal anclada, y
// entonces `http://localhost:5173.evil.com` pasa por `http://localhost:5173`.
// ---------------------------------------------------------------------------

/** Orígenes que SE PARECEN a uno permitido pero son de otro sitio. */
const ORIGENES_ENGANOSOS = [
  // Sufijo: el permitido es un prefijo de este.
  'http://localhost:5173.evil.com',
  'http://localhost:5173.atacante.io',
  // Prefijo: el permitido es un sufijo de este.
  'http://evil.com/http://localhost:5173',
  'http://atacante.http://localhost:5173',
  // Subdominio del que se parece.
  'http://sub.localhost:5173',
  'http://localhost.evil.com:5173',
  // Mismo host, otro esquema.
  'https://localhost:5173',
  'ftp://localhost:5173',
  // Mismo host, otro puerto.
  'http://localhost:5176',
  'http://localhost:51730',
  'http://localhost:517',
  // Host que no es el mismo aunque resuelva igual.
  'http://127.0.0.1:5173',
  'http://[::1]:5173',
  // Barra final: no es la cadena de la lista.
  'http://localhost:5173/',
  // Usuario en la URL, truco clásico para que el ojo lea mal el host.
  'http://localhost:5173@evil.com',
  'http://evil.com@localhost:5173',
  // Mayúsculas.
  'HTTP://LOCALHOST:5173',
  // Casos del navegador que no son un origen de la lista.
  'null',
  'file://',
];

for (const origen of ORIGENES_ENGANOSOS) {
  test(`d-11: el origen "${origen}" no recibe Allow-Origin`, async () => {
    const res = await request(app).get('/api/health').set('Origin', origen);

    assert.strictEqual(
      res.headers['access-control-allow-origin'],
      undefined,
      `"${origen}" se colo en la lista blanca`
    );
  });
}

test('d-11: la decisión de la lista blanca es de cadena exacta', () => {
  // Lo mismo sin pasar por HTTP, para que el motivo quede a la vista: la
  // función solo dice sí a lo que está en la lista, letra por letra.
  const { origin } = opcionesCors({ NODE_ENV: 'development' });
  const decidir = (valor) =>
    new Promise((resolve) => origin(valor, (_err, permitido) => resolve(permitido)));

  // Los espacios alrededor solo se pueden comprobar aquí: HTTP los recorta al
  // transmitir la cabecera, así que por la ruta llegarían ya limpios.
  const conEspacios = ['http://localhost:5173 ', ' http://localhost:5173'];

  return Promise.all([
    ...[...ORIGENES_ENGANOSOS, ...conEspacios].map(async (o) => {
      assert.strictEqual(await decidir(o), false, `"${o}" fue permitido`);
    }),
    ...ORIGENES_LOCALES.map(async (o) => {
      assert.strictEqual(await decidir(o), true, `"${o}" debería estar permitido`);
    }),
  ]);
});

test('d-11: un CORS_ORIGINS configurado tampoco se deja engañar', async () => {
  const { origin } = opcionesCors({ CORS_ORIGINS: 'https://smartdining.co' });
  const decidir = (valor) =>
    new Promise((resolve) => origin(valor, (_err, permitido) => resolve(permitido)));

  assert.strictEqual(await decidir('https://smartdining.co'), true);
  for (const enganoso of [
    'https://smartdining.co.evil.com',
    'https://smartdining.com',
    'https://sub.smartdining.co',
    'http://smartdining.co',
    'https://smartdining.co/',
    'https://evil.com/https://smartdining.co',
  ]) {
    assert.strictEqual(await decidir(enganoso), false, `"${enganoso}" fue permitido`);
  }
});

test('d-11: el preflight de un origen no permitido no autoriza nada', async () => {
  const res = await request(app)
    .options('/api/reportes')
    .set('Origin', 'http://localhost:5173.evil.com')
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization');

  assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
  assert.strictEqual(res.headers['access-control-allow-credentials'], undefined);
});

// ---------------------------------------------------------------------------
// D-11: tamaño del cuerpo
// ---------------------------------------------------------------------------

test('d-11: un cuerpo enorme se rechaza y no revienta', async () => {
  // express.json() trae un tope de 100 kB de serie. Nadie lo afirmaba, asi que
  // nadie se enteraria si alguien lo subiera o lo quitara. Y lo que llega al
  // cliente tiene que ser un 4xx con su JSON, no la pila del parser.
  const enorme = { nombre: 'A'.repeat(200 * 1024) };

  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(enorme));

  assert.ok(res.status === 413 || res.status === 400, `respondió ${res.status}`);
  assert.ok(!String(res.text || '').includes('    at '), 'filtró una pila');
});

test('d-11: un cuerpo justo por debajo del tope sí entra al esquema', async () => {
  // Control del de arriba: si el tope fuese minúsculo, el rechazo anterior no
  // probaría nada. Con 50 kB la petición llega a zod, que la rechaza por el
  // esquema (400) y no por el tamaño.
  const grande = { email: 'a@b.com', password: 'x'.repeat(50 * 1024) };

  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(grande));

  assert.notStrictEqual(res.status, 413, 'el tope no debería saltar con 50 kB');
});

test('d-11: las cabeceras de helmet están también en un 404 y en un 401', async () => {
  for (const peticion of [
    request(app).get('/api/no-existe'),
    request(app).get('/api/reportes?rango=hoy'),
  ]) {
    const res = await peticion;

    assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', `faltó en ${res.status}`);
    assert.strictEqual(res.headers['x-powered-by'], undefined);
  }
});
