const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const express = require('express');
const {
  crearLimitadorGlobal,
  crearLimitadorLogin,
  crearLimitadorQr,
  entero,
  rutaExenta,
  MENSAJE_GLOBAL,
  MENSAJE_LOGIN,
  MENSAJE_QR,
} = require('../src/middleware/limites.middleware');

// D-21: techo GLOBAL de peticiones por IP.
//
// Igual que limites-intentos.test.js: el limitador se desactiva solo dentro de
// las pruebas, asi que aqui NO se prueba a traves de la app real (si no, toda
// esta suite y las demas empezarian a chocar con el techo). Se monta una app
// minima con el entorno forzado, que es la unica forma de ver el 429.

/** Entorno de produccion simulado: sin las marcas que desactivan el limite. */
const envReal = (extra = {}) => ({ NODE_ENV: 'production', ...extra });

/**
 * App con el limitador global puesto donde lo pone server.js: antes de las
 * rutas. Responde 200 en cualquier ruta, para poder probar la exencion por
 * ruta sin montar la API entera.
 */
function appGlobal(env, extra = {}) {
  const app = express();
  app.use(crearLimitadorGlobal({ ...envReal(), ...env }));
  app.use(express.json());
  app.all(/.*/, (req, res) => res.status(200).json({ ok: true, ...extra }));
  return app;
}

// ---------------------------------------------------------------------------
// Que rutas quedan fuera del limite
// ---------------------------------------------------------------------------

test('la ruta de salud y el canal interno estan exentos; el resto, no', () => {
  assert.strictEqual(rutaExenta('/api/health'), true);
  assert.strictEqual(rutaExenta('/api/transacciones/internal'), true);
  // En espanol: la ruta de la cuenta interna de la mesa se escribe asi.
  assert.strictEqual(rutaExenta('/api/mesas/3/cuenta/interno'), true);

  assert.strictEqual(rutaExenta('/api/pedidos'), false);
  assert.strictEqual(rutaExenta('/api/auth/login'), false);
  assert.strictEqual(rutaExenta('/api/menu'), false);
  assert.strictEqual(rutaExenta('/'), false);
});

test('rutaExenta no revienta con una ruta ausente o rara', () => {
  assert.strictEqual(rutaExenta(undefined), false);
  assert.strictEqual(rutaExenta(null), false);
  assert.strictEqual(rutaExenta(''), false);
});

test('la exencion no depende de las mayusculas', () => {
  assert.strictEqual(rutaExenta('/api/HEALTH'), true);
  assert.strictEqual(rutaExenta('/api/transacciones/INTERNAL'), true);
});

test('una ruta que solo CONTIENE la palabra no queda exenta', () => {
  // El segmento completo tiene que ser la palabra: si no, cualquier ruta que
  // llevara "health" dentro de otro nombre se escaparia del limite.
  assert.strictEqual(rutaExenta('/api/healthcheck'), false);
  assert.strictEqual(rutaExenta('/api/internalizar'), false);
});

// ---------------------------------------------------------------------------
// Bajo el limite pasa; al excederlo, 429
// ---------------------------------------------------------------------------

test('d-21: por debajo del limite todas las peticiones pasan', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '3' });

  for (let i = 1; i <= 3; i += 1) {
    const res = await request(app).get('/api/menu');
    assert.strictEqual(res.status, 200, `la peticion ${i} deberia pasar`);
  }
});

test('d-21: al pasarse del limite responde 429 con el error de siempre', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '2' });

  await request(app).get('/api/menu');
  await request(app).get('/api/menu');
  const res = await request(app).get('/api/menu');

  assert.strictEqual(res.status, 429);
  assert.deepStrictEqual(res.body, { error: MENSAJE_GLOBAL });
});

test('d-21: el 429 trae Retry-After, para que el cliente sepa cuanto esperar', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '1', RATE_LIMIT_GLOBAL_VENTANA_MS: '60000' });

  await request(app).get('/api/menu');
  const res = await request(app).get('/api/menu');

  assert.strictEqual(res.status, 429);
  assert.ok(res.headers['retry-after'], 'falta la cabecera Retry-After');
  assert.strictEqual(Number(res.headers['retry-after']), 60);
});

test('el cuerpo del 429 tiene la MISMA forma que el de los otros limitadores', async () => {
  // Un cliente que ya sabe leer un 429 del login no tiene que aprender otro
  // formato para el global: los tres son { error: "..." }.
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '1' });
  await request(app).get('/api/menu');
  const res = await request(app).get('/api/menu');

  assert.deepStrictEqual(Object.keys(res.body), ['error']);
  assert.strictEqual(typeof res.body.error, 'string');
  assert.notStrictEqual(res.body.error, MENSAJE_LOGIN, 'el mensaje es el suyo, no el del login');
  assert.notStrictEqual(res.body.error, MENSAJE_QR);
});

test('el limite cuenta TODAS las rutas juntas, no una por una', async () => {
  // Es un techo global: raspar la API cambiando de ruta no lo esquiva.
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '2' });

  assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  assert.strictEqual((await request(app).get('/api/platos')).status, 200);
  assert.strictEqual((await request(app).get('/api/categorias')).status, 429);
});

// ---------------------------------------------------------------------------
// Las rutas exentas no gastan cupo
// ---------------------------------------------------------------------------

test('d-21: /health no cuenta, ni siquiera con el cupo ya agotado', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '1' });

  await request(app).get('/api/menu');
  assert.strictEqual((await request(app).get('/api/menu')).status, 429, 'el cupo esta agotado');

  // La sonda de Docker sigue respondiendo: si no, el contenedor se declararia
  // enfermo y se reiniciaria solo por culpa del limite.
  for (let i = 0; i < 10; i += 1) {
    assert.strictEqual((await request(app).get('/api/health')).status, 200);
  }
});

test('d-21: /health no gasta cupo del resto', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '2' });

  // Seis sondas (lo que manda Docker en un minuto con interval: 10s).
  for (let i = 0; i < 6; i += 1) await request(app).get('/api/health');

  assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  assert.strictEqual((await request(app).get('/api/menu')).status, 429, 'el cupo era de 2');
});

test('d-21: el canal interno no cuenta, en ninguna de sus dos grafias', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '1' });

  await request(app).get('/api/menu');
  assert.strictEqual((await request(app).get('/api/menu')).status, 429);

  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual((await request(app).post('/api/transacciones/internal')).status, 200);
    assert.strictEqual((await request(app).get('/api/mesas/3/cuenta/interno')).status, 200);
  }
});

// ---------------------------------------------------------------------------
// Convivencia con los limitadores de login y QR
// ---------------------------------------------------------------------------

test('el global no se come el cupo del login: son contadores distintos', async () => {
  // Global holgado, login de 1: el que corta es el del login, con SU mensaje.
  const app = express();
  app.use(crearLimitadorGlobal(envReal({ RATE_LIMIT_GLOBAL_MAX: '100' })));
  app.use(express.json());
  app.post(
    '/api/auth/login',
    crearLimitadorLogin(envReal({ RATE_LIMIT_LOGIN_MAX: '1' })),
    (req, res) => res.status(401).json({ error: 'Credenciales invalidas' })
  );

  const uno = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
  assert.strictEqual(uno.status, 401);

  const dos = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
  assert.strictEqual(dos.status, 429);
  assert.strictEqual(dos.body.error, MENSAJE_LOGIN, 'corta el del login, no el global');
});

test('agotar el global no desactiva el del login, ni al contrario', async () => {
  const app = express();
  app.use(crearLimitadorGlobal(envReal({ RATE_LIMIT_GLOBAL_MAX: '2' })));
  app.use(express.json());
  app.post(
    '/api/auth/login',
    crearLimitadorQr(envReal({ RATE_LIMIT_QR_MAX: '50' })),
    (req, res) => res.status(200).json({ ok: true })
  );

  assert.strictEqual((await request(app).post('/api/auth/login').send({})).status, 200);
  assert.strictEqual((await request(app).post('/api/auth/login').send({})).status, 200);

  // La tercera la corta el GLOBAL, aunque al de QR le queden 48.
  const tres = await request(app).post('/api/auth/login').send({});
  assert.strictEqual(tres.status, 429);
  assert.strictEqual(tres.body.error, MENSAJE_GLOBAL);
});

test('el global corta ANTES de parsear el cuerpo', async () => {
  // Esta montado antes de express.json() a proposito: a una peticion que se va
  // a rechazar no hace falta parsearle el cuerpo.
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '1' });
  await request(app).post('/api/pedidos').send({ algo: 1 });

  const res = await request(app)
    .post('/api/pedidos')
    .set('Content-Type', 'application/json')
    .send('{ esto no es json valido');

  assert.strictEqual(res.status, 429, 'un cuerpo roto no cambia nada: ni se mira');
  assert.strictEqual(res.body.error, MENSAJE_GLOBAL);
});

// ---------------------------------------------------------------------------
// Configuracion por entorno y desactivacion en pruebas
// ---------------------------------------------------------------------------

test('el maximo y la ventana se leen del entorno, con respaldo', () => {
  // Misma funcion que usan los otros dos limitadores.
  assert.strictEqual(entero('2000', 2000), 2000);
  assert.strictEqual(entero(undefined, 2000), 2000, 'sin variable, el valor por defecto');
  assert.strictEqual(entero('muchas', 2000), 2000, 'un valor no numerico no deja el limite en NaN');
  assert.strictEqual(entero('0', 2000), 2000, 'un 0 cerraria la API entera: se ignora');
  assert.strictEqual(entero('-5', 2000), 2000);
});

test('RATE_LIMIT_GLOBAL_MAX cambia el tope de verdad', async () => {
  const app = appGlobal({ RATE_LIMIT_GLOBAL_MAX: '4' });

  for (let i = 0; i < 4; i += 1) {
    assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  }
  assert.strictEqual((await request(app).get('/api/menu')).status, 429);
});

test('el valor por defecto deja trabajar a un local entero', async () => {
  // Sin variables, el tope son 2000 por minuto: 80 telefonos a 20 peticiones
  // cada uno caben de sobra. Aqui se comprueba que el defecto NO es un numero
  // pequeno que bloquearia a los comensales, que comparten la IP del wifi.
  const app = appGlobal({});

  for (let i = 0; i < 50; i += 1) {
    assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  }
});

test('dentro de las pruebas el limite global no cuenta nada', async () => {
  // La convencion de los otros dos: NODE_ENV=test o NODE_TEST_CONTEXT lo
  // desactivan. Sin esto, las suites existentes empezarian a ver 429 segun
  // creciera el numero de llamadas.
  const app = express();
  app.use(crearLimitadorGlobal({ NODE_ENV: 'test', RATE_LIMIT_GLOBAL_MAX: '1' }));
  app.get('/api/menu', (req, res) => res.status(200).json({ ok: true }));

  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  }
});

test('y tampoco con NODE_TEST_CONTEXT, que es lo que pone node --test', async () => {
  const app = express();
  app.use(crearLimitadorGlobal({ NODE_TEST_CONTEXT: 'child-v8', RATE_LIMIT_GLOBAL_MAX: '1' }));
  app.get('/api/menu', (req, res) => res.status(200).json({ ok: true }));

  for (let i = 0; i < 5; i += 1) {
    assert.strictEqual((await request(app).get('/api/menu')).status, 200);
  }
});

test('la app real no limita nada mientras corren las pruebas', async () => {
  // Comprobacion de que lo montado en server.js esta desactivado aqui: si no,
  // esta misma linea empezaria a fallar en cuanto la suite creciera.
  const app = require('../server');

  for (let i = 0; i < 30; i += 1) {
    assert.strictEqual((await request(app).get('/api/health')).status, 200);
  }
  const res = await request(app).get('/api/health');
  assert.deepStrictEqual(res.body, { status: 'ok' });
});
