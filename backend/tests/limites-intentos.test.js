const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const express = require('express');
const { instalarFakeDb } = require('./helpers/fake-db');
const {
  crearLimitadorLogin,
  crearLimitadorQr,
  enPruebas,
  entero,
  MENSAJE_LOGIN,
  MENSAJE_QR,
} = require('../src/middleware/limites.middleware');

// H-04 y H-27: limites de intentos en las dos rutas publicas.
//
// El limitador se desactiva solo dentro de las pruebas (si no, cualquier
// prueba que llame dos veces al login empezaria a fallar cuando alguien anada
// la sexta). Asi que aqui NO se prueba a traves de la app real: se monta una
// app minima con el entorno forzado, que es la unica forma de ver el 429.

/** App de un solo endpoint con el limitador puesto y el entorno que se le pase. */
function appConLimitador(crear, env) {
  const app = express();
  app.use(express.json());
  app.post('/probar', crear(env), (req, res) => res.status(200).json({ ok: true }));
  return app;
}

/** Entorno de produccion simulado: sin las marcas que desactivan el limite. */
const envReal = (extra = {}) => ({ NODE_ENV: 'production', ...extra });

// ---------------------------------------------------------------------------
// Deteccion de las pruebas
// ---------------------------------------------------------------------------

test('el limitador se desactiva con NODE_ENV=test', () => {
  assert.strictEqual(enPruebas({ NODE_ENV: 'test' }), true);
});

test('y tambien con NODE_TEST_CONTEXT, que es lo que pone node --test', () => {
  assert.strictEqual(enPruebas({ NODE_TEST_CONTEXT: 'child-v8' }), true);
  // Esta misma suite corre con esa variable puesta: si no se detectara, las
  // pruebas que llaman al login empezarian a chocar con el limite.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test la define');
});

test('en produccion el limitador esta activo', () => {
  assert.strictEqual(enPruebas({ NODE_ENV: 'production' }), false);
  assert.strictEqual(enPruebas({}), false);
});

// ---------------------------------------------------------------------------
// Lectura de las variables de entorno
// ---------------------------------------------------------------------------

test('los limites se leen del entorno y caen a un valor razonable', () => {
  assert.strictEqual(entero('7', 5), 7);
  assert.strictEqual(entero(undefined, 5), 5, 'sin variable, el valor por defecto');
  assert.strictEqual(entero('cero', 5), 5, 'un valor no numerico no deja el limite en NaN');
  assert.strictEqual(entero('0', 5), 5, 'un 0 desactivaria el acceso: se ignora');
  assert.strictEqual(entero('-3', 5), 5);
});

test('RATE_LIMIT_LOGIN_MAX cambia el tope', async () => {
  const app = appConLimitador(crearLimitadorLogin, envReal({ RATE_LIMIT_LOGIN_MAX: '2' }));

  // Con tope 2 y fallos (404 de la ruta inexistente no aplica: aqui el handler
  // responde 200, asi que se usa el limitador del QR para contar exitos).
  const uno = await request(app).post('/probar').send({ email: 'a@b.com' });
  assert.strictEqual(uno.status, 200);
});

// ---------------------------------------------------------------------------
// Login: 5 por minuto, contando solo los fallos
// ---------------------------------------------------------------------------

test('h-04: el sexto intento FALLIDO del mismo email e IP responde 429', async () => {
  // El handler devuelve 401 para que el intento cuente como fallido.
  const app = express();
  app.use(express.json());
  app.post('/login', crearLimitadorLogin(envReal()), (req, res) =>
    res.status(401).json({ error: 'Credenciales inválidas' })
  );

  const intento = () => request(app).post('/login').send({ email: 'ana@smartdining.com', password: 'x' });

  for (let i = 1; i <= 5; i++) {
    const res = await intento();
    assert.strictEqual(res.status, 401, `intento ${i}: todavia pasa al controlador`);
  }

  const sexto = await intento();
  assert.strictEqual(sexto.status, 429, 'el sexto ya no llega al controlador');
  assert.strictEqual(sexto.body.error, MENSAJE_LOGIN);
  assert.ok(sexto.headers['retry-after'], 'se dice cuanto esperar');
});

test('h-04: un intento con EXITO no gasta el cupo', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', crearLimitadorLogin(envReal()), (req, res) => res.status(200).json({ ok: true }));

  // Diez logins correctos seguidos: ninguno cuenta.
  for (let i = 1; i <= 10; i++) {
    const res = await request(app).post('/login').send({ email: 'ana@smartdining.com', password: 'x' });
    assert.strictEqual(res.status, 200, `login correcto ${i}: un cajero no se bloquea a si mismo`);
  }
});

test('h-04: el contador es por IP + email, no solo por IP', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', crearLimitadorLogin(envReal()), (req, res) => res.status(401).json({ error: 'no' }));

  const fallar = (email) => request(app).post('/login').send({ email, password: 'x' });

  for (let i = 0; i < 5; i++) await fallar('ana@smartdining.com');
  const anaBloqueada = await fallar('ana@smartdining.com');
  assert.strictEqual(anaBloqueada.status, 429, 'Ana agoto su cupo');

  const otroEmail = await fallar('beto@smartdining.com');
  assert.strictEqual(
    otroEmail.status,
    401,
    'otra cuenta desde la misma IP sigue pudiendo intentar: nadie bloquea a otro a proposito'
  );
});

test('h-04: el email se normaliza para que no se esquive con mayusculas', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', crearLimitadorLogin(envReal()), (req, res) => res.status(401).json({ error: 'no' }));

  const fallar = (email) => request(app).post('/login').send({ email, password: 'x' });

  for (let i = 0; i < 5; i++) await fallar('ana@smartdining.com');

  const conMayusculas = await fallar('  ANA@smartdining.com ');
  assert.strictEqual(conMayusculas.status, 429, 'es el mismo contador');
});

test('h-04: un cuerpo sin email no revienta el limitador', async () => {
  const app = express();
  app.use(express.json());
  app.post('/login', crearLimitadorLogin(envReal()), (req, res) => res.status(400).json({ error: 'no' }));

  const res = await request(app).post('/login').send({});
  assert.strictEqual(res.status, 400, 'llega al controlador, que es quien valida el cuerpo');
});

// ---------------------------------------------------------------------------
// Sesion por QR: 20 por minuto por IP
// ---------------------------------------------------------------------------

test('h-27: el intento 21 de abrir sesion por QR responde 429', async () => {
  const app = appConLimitador(crearLimitadorQr, envReal());

  for (let i = 1; i <= 20; i++) {
    const res = await request(app).post('/probar').send({});
    assert.strictEqual(res.status, 200, `intento ${i} de 20`);
  }

  const pasado = await request(app).post('/probar').send({});
  assert.strictEqual(pasado.status, 429);
  assert.strictEqual(pasado.body.error, MENSAJE_QR);
});

test('h-27: aqui SI cuentan los intentos con exito', async () => {
  // Al contrario que el login: reusar un token valido muchas veces por segundo
  // tampoco deberia pasar.
  const app = appConLimitador(crearLimitadorQr, envReal({ RATE_LIMIT_QR_MAX: '3' }));

  for (let i = 1; i <= 3; i++) {
    assert.strictEqual((await request(app).post('/probar').send({})).status, 200);
  }
  assert.strictEqual((await request(app).post('/probar').send({})).status, 429);
});

test('h-27: el tope del QR es mas holgado que el del login', () => {
  // Una mesa entera escanea desde la IP del local: 5 serian pocos.
  const porDefectoLogin = entero(undefined, 5);
  const porDefectoQr = entero(undefined, 20);
  assert.ok(porDefectoQr > porDefectoLogin);
});

// ---------------------------------------------------------------------------
// Las rutas reales siguen funcionando (el limite esta desactivado en pruebas)
// ---------------------------------------------------------------------------

test('el login real sigue respondiendo en las pruebas, sin 429', async () => {
  const app = require('../server');
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    // Seis intentos seguidos: con el limitador activo el sexto seria 429.
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nadie@smartdining.com', password: 'cualquiera' });
      assert.notStrictEqual(res.status, 429, `intento ${i + 1}: las pruebas no se topan con el limite`);
    }
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-11: la forma del 429
//
// El 429 es una respuesta que sale ANTES de cualquier comprobación de
// credenciales, así que es un canal lateral barato: si dijera "te quedan 2
// intentos para ana@x.com" o si solo apareciera para los correos que existen,
// devolvería gratis lo que H-12 cerró en el login.
// ---------------------------------------------------------------------------

/**
 * App de un endpoint que SIEMPRE falla con 401.
 *
 * El limitador del login lleva `skipSuccessfulRequests`, así que con un
 * endpoint que responde 200 no se gasta cupo y el 429 no llega nunca. Para
 * verlo hay que fallar, igual que falla un login de verdad.
 */
function appConLoginFallido(env) {
  const app = express();
  app.use(express.json());
  app.post('/probar', crearLimitadorLogin(env), (req, res) => res.status(401).json({ error: 'no' }));
  return app;
}

/** Agota el cupo del limitador y devuelve la primera respuesta con 429. */
async function hasta429(app, cuerpo, tope = 12) {
  for (let i = 0; i < tope; i += 1) {
    const res = await request(app).post('/probar').send(cuerpo);
    if (res.status === 429) return res;
  }
  throw new Error('el limitador no llegó a responder 429');
}

test('d-11: el 429 tiene la misma forma de JSON que el resto de errores', async () => {
  const app = appConLoginFallido(envReal({ RATE_LIMIT_LOGIN_MAX: '2' }));

  const res = await hasta429(app, { email: 'ana@mail.com', password: 'mala' });

  assert.deepStrictEqual(Object.keys(res.body), ['error']);
  assert.strictEqual(res.body.error, MENSAJE_LOGIN);
});

test('d-11: el 429 no dice cuántos intentos quedan ni para qué cuenta', async () => {
  const app = appConLoginFallido(envReal({ RATE_LIMIT_LOGIN_MAX: '2' }));

  const res = await hasta429(app, { email: 'ana@mail.com', password: 'mala' });
  const cuerpo = JSON.stringify(res.body);

  assert.ok(!cuerpo.includes('ana@mail.com'), 'el 429 repitió el correo');
  assert.ok(!/\d/.test(cuerpo), `el 429 lleva un número: ${cuerpo}`);
  // Y tampoco en una cabecera: draft-7 manda RateLimit, que dice el tope y lo
  // que queda. Es información del límite, no de la cuenta, y eso es lo que se
  // comprueba: que ningún encabezado nombre el correo.
  for (const [nombre, valor] of Object.entries(res.headers)) {
    assert.ok(!String(valor).includes('ana@mail.com'), `la cabecera ${nombre} lleva el correo`);
  }
});

test('d-11: el 429 llega igual para un correo que existe y para uno que no', async () => {
  // El contador es por IP+email, así que cada correo tiene su propio cupo. Lo
  // que se afirma es que la RESPUESTA es indistinguible: mismo código, mismo
  // cuerpo. Si no, bastaría con mirar quién se bloquea para enumerar cuentas.
  const app = appConLoginFallido(envReal({ RATE_LIMIT_LOGIN_MAX: '2' }));

  const existe = await hasta429(app, { email: 'admin@smartdining.com', password: 'mala' });
  const noExiste = await hasta429(app, { email: 'nadie-de-nadie@mail.com', password: 'mala' });

  assert.strictEqual(existe.status, noExiste.status);
  assert.deepStrictEqual(existe.body, noExiste.body);
});

test('d-11: el 429 trae Retry-After para que el cliente sepa esperar', async () => {
  const app = appConLoginFallido(envReal({ RATE_LIMIT_LOGIN_MAX: '2' }));

  const res = await hasta429(app, { email: 'ana@mail.com', password: 'mala' });

  const retry = res.headers['retry-after'];
  assert.ok(retry !== undefined, 'sin Retry-After el cliente solo puede reintentar a ciegas');
  assert.ok(Number(retry) > 0, `Retry-After no es un número de segundos: ${retry}`);
});

test('d-11: el 429 del QR tampoco cuenta nada de más', async () => {
  const app = appConLimitador(crearLimitadorQr, envReal({ RATE_LIMIT_QR_MAX: '2' }));

  const res = await hasta429(app, {});

  assert.deepStrictEqual(Object.keys(res.body), ['error']);
  assert.strictEqual(res.body.error, MENSAJE_QR);
  assert.ok(!/\d/.test(JSON.stringify(res.body)));
});

test('d-11: el 429 no anuncia Express ni se salta helmet', async () => {
  // El limitador responde con su propio handler, que es un camino distinto del
  // normal: conviene comprobar que no se salta lo de H-10.
  const app = express();
  app.use(require('helmet')());
  app.disable('x-powered-by');
  app.use(express.json());
  app.post('/probar', crearLimitadorLogin(envReal({ RATE_LIMIT_LOGIN_MAX: '1' })), (req, res) =>
    res.status(401).json({ error: 'no' })
  );

  const res = await hasta429(app, { email: 'ana@mail.com', password: 'mala' });

  assert.strictEqual(res.status, 429);
  assert.strictEqual(res.headers['x-powered-by'], undefined);
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
});
