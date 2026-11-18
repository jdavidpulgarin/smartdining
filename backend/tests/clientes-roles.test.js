const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeClientes } = require('./helpers/fake-clientes');
const { tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { protegidas, pedir } = require('./helpers/catalogo-rutas');
const { crearLimitadoresClientes, MENSAJE_CLIENTES } = require('../src/middleware/limites.middleware');
const { esRutaDeClientes } = require('../src/config/rutas-clientes');
const { manejadorErrores } = require('../src/middleware/errores.middleware');
const app = require('../server');

// D-19 parte B: separación de roles, rutas que existen SOLO en /api/v1,
// motivos en los errores genéricos, límites propios y datos personales fuera
// de los logs.

const V1 = '/api/v1';
const CLAVE = 'una-clave-buena';

/** JWT de cliente firmado como lo firma el backend. */
const tokenCliente = (sub, extra = {}) =>
  jwt.sign({ rol: 'cliente', ...extra }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m', subject: String(sub) });

/** Doble con un cliente registrado; `fn({ ...fake, sesion })`. */
async function conCliente(fn) {
  const fake = instalarFakeClientes();
  try {
    const r = await request(app).post(`${V1}/auth/clientes/registro`).send({ nombre: 'Ana', email: 'ana@mail.com', password: CLAVE });
    assert.strictEqual(r.status, 201);
    return await fn({ ...fake, sesion: r.body });
  } finally {
    fake.restaurar();
  }
}

// ---------------------------------------------------------------------------
// Solo en /api/v1
// ---------------------------------------------------------------------------

for (const [metodo, ruta] of [
  ['post', '/auth/clientes/registro'],
  ['post', '/auth/clientes/login'],
  ['post', '/auth/clientes/refresh'],
  ['post', '/auth/clientes/logout'],
  ['get', '/clientes/yo'],
  ['patch', '/clientes/yo'],
  ['get', '/clientes/yo/direcciones'],
  ['post', '/clientes/yo/direcciones'],
  ['patch', '/clientes/yo/direcciones/1'],
  ['delete', '/clientes/yo/direcciones/1'],
  ['get', '/zonas'],
  ['get', '/zonas/cotizar?id_direccion=1'],
]) {
  test(`solo v1: ${metodo.toUpperCase()} /api${ruta} es 404 no_encontrado (en /api/v1 existe)`, () =>
    conCliente(async ({ sesion }) => {
      const enApi = await request(app)[metodo](`/api${ruta}`).set('Authorization', `Bearer ${sesion.token}`).send({});
      assert.strictEqual(enApi.status, 404);
      assert.deepStrictEqual(enApi.body, { error: 'Ruta no encontrada', motivo: 'no_encontrado' });

      // En v1 la ruta existe: puede dar 404 (la dirección 1 no existe), pero
      // nunca el de "ruta no encontrada".
      const enV1 = await request(app)[metodo](`${V1}${ruta}`).set('Authorization', `Bearer ${sesion.token}`).send({});
      assert.notStrictEqual(enV1.body.error, 'Ruta no encontrada', `en v1 ${ruta} existe (${enV1.status} ${JSON.stringify(enV1.body)})`);
    }));
}

test('solo v1: lo compartido sigue en los dos prefijos (login del personal, categorías)', async () => {
  for (const prefijo of ['/api', V1]) {
    const res = await request(app).post(`${prefijo}/auth/login`).send({});
    assert.strictEqual(res.status, 400, `${prefijo}/auth/login sigue existiendo`);
  }
});

test('solo v1: una ruta inexistente bajo un prefijo de clientes es 404 no_encontrado', async () => {
  const res = await request(app).get(`${V1}/clientes/nada-por-aqui`);
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.body, { error: 'Ruta no encontrada', motivo: 'no_encontrado' });
});

test('esRutaDeClientes: los tres prefijos de v1, con o sin query, y nada más', () => {
  for (const url of ['/api/v1/auth/clientes/login', '/api/v1/clientes/yo', '/api/v1/zonas', '/api/v1/zonas/cotizar?id_direccion=1', '/API/V1/Zonas']) {
    assert.ok(esRutaDeClientes(url), url);
  }
  for (const url of ['/api/auth/clientes/login', '/api/v1/auth/login', '/api/v1/zonasx', '/api/clientes/yo', '/api/v1/pedidos', '', undefined]) {
    assert.ok(!esRutaDeClientes(url), String(url));
  }
});

// ---------------------------------------------------------------------------
// Roles cruzados
// ---------------------------------------------------------------------------

test('roles: un JWT de cliente recibe 403 prohibido en TODAS las rutas protegidas del personal y del comensal', async () => {
  // El doble contesta que el cliente 1 existe y está activo: así el único 403
  // posible es el de requireRole.
  const responder = (sql) =>
    sql.includes('SELECT id_cliente, activo FROM clientes') ? { rows: [{ id_cliente: 1, activo: true }] } : { rows: [] };
  const token = tokenCliente(1);
  for (const fila of protegidas) {
    const res = await pedir(fila, { token, responder });
    assert.strictEqual(res.status, 403, `${fila.metodo} ${fila.url}: ${res.status} ${JSON.stringify(res.body)}`);
    assert.deepStrictEqual(res.body, { error: 'No tienes permisos para esta acción', motivo: 'prohibido' });
  }
  // Y por /api/v1 también, con una muestra.
  for (const fila of protegidas.slice(0, 5)) {
    const res = await pedir(fila, { token, responder, url: fila.url.replace(/^\/api/, V1) });
    assert.strictEqual(res.status, 403, `v1 ${fila.url}`);
  }
});

for (const [rol, token] of [
  ['admin', () => tokenStaff(1, 'admin')],
  ['mesero', () => tokenStaff(1, 'mesero')],
  ['cajero', () => tokenStaff(1, 'cajero')],
  ['cocina', () => tokenStaff(1, 'cocina')],
  ['comensal', () => tokenComensal(5)],
]) {
  test(`roles: un JWT de ${rol} recibe 403 prohibido en las rutas de clientes`, () =>
    conCliente(async () => {
      for (const [metodo, ruta] of [
        ['get', '/clientes/yo'],
        ['patch', '/clientes/yo'],
        ['get', '/clientes/yo/direcciones'],
        ['post', '/clientes/yo/direcciones'],
        ['patch', '/clientes/yo/direcciones/1'],
        ['delete', '/clientes/yo/direcciones/1'],
        ['get', '/zonas/cotizar?id_direccion=1'],
      ]) {
        const res = await request(app)[metodo](`${V1}${ruta}`).set('Authorization', `Bearer ${token()}`).send({ nombre: 'X' });
        assert.strictEqual(res.status, 403, `${rol} ${metodo} ${ruta}: ${res.status}`);
        assert.strictEqual(res.body.motivo, 'prohibido');
      }
    }));
}

test('roles: el JWT de cliente no trae id_usuario y no se confunde con el personal', () =>
  conCliente(async ({ sesion, db }) => {
    const res = await request(app).get(`${V1}/clientes/yo`).set('Authorization', `Bearer ${sesion.token}`);
    assert.strictEqual(res.status, 200);
    assert.ok(!db.buscar('FROM usuarios WHERE id_usuario'), 'no consulta usuarios');
    assert.ok(db.buscar('SELECT id_cliente, activo FROM clientes'), 'consulta clientes');
  }));

// ---------------------------------------------------------------------------
// requireAuth con clientes, y motivo en sus 401
// ---------------------------------------------------------------------------

test('auth: sin token, con token basura o vencido -> 401 no_autenticado', async () => {
  const vencido = jwt.sign({ rol: 'cliente' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -10, subject: '1' });
  for (const cabecera of [undefined, 'Bearer nada', `Bearer ${vencido}`, 'Basic abc']) {
    let r = request(app).get(`${V1}/clientes/yo`);
    if (cabecera) r = r.set('Authorization', cabecera);
    const res = await r;
    assert.strictEqual(res.status, 401, String(cabecera));
    assert.strictEqual(res.body.motivo, 'no_autenticado');
  }
});

test('auth: un cliente desactivado no entra (401 no_autenticado) aunque su JWT siga vigente', () =>
  conCliente(async ({ sesion, estado }) => {
    estado.clientes[0].activo = false;
    const res = await request(app).get(`${V1}/clientes/yo`).set('Authorization', `Bearer ${sesion.token}`);
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'Tu cuenta no está activa', motivo: 'no_autenticado' });
  }));

test('auth: un JWT de cliente con sub inválido o de un cliente que no existe -> 401', () =>
  conCliente(async () => {
    const malos = [
      tokenCliente(999),
      tokenCliente('abc'),
      tokenCliente('0'),
      tokenCliente('-1'),
      jwt.sign({ rol: 'cliente' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' }),
      jwt.sign({ rol: 'cliente', sub: 1 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' }),
    ];
    for (const t of malos) {
      const res = await request(app).get(`${V1}/clientes/yo`).set('Authorization', `Bearer ${t}`);
      assert.strictEqual(res.status, 401, jwt.decode(t).sub);
      assert.strictEqual(res.body.motivo, 'no_autenticado');
    }
  }));

test('auth: un JWT de cliente con HS512 (mismo secreto) no entra: solo HS256', () =>
  conCliente(async () => {
    const t = jwt.sign({ rol: 'cliente' }, process.env.JWT_SECRET, { algorithm: 'HS512', expiresIn: '15m', subject: '1' });
    const res = await request(app).get(`${V1}/clientes/yo`).set('Authorization', `Bearer ${t}`);
    assert.strictEqual(res.status, 401);
  }));

test('auth: los 401 y 403 del personal también llevan motivo, con el error de siempre', async () => {
  const sin = await request(app).get('/api/pedidos/activos');
  assert.deepStrictEqual(sin.body, { error: 'Token no proporcionado', motivo: 'no_autenticado' });
  const basura = await request(app).get('/api/pedidos/activos').set('Authorization', 'Bearer x');
  assert.deepStrictEqual(basura.body, { error: 'Token inválido o expirado', motivo: 'no_autenticado' });
});

// ---------------------------------------------------------------------------
// Errores genéricos en las rutas de clientes: siempre con motivo y sin datos
// ---------------------------------------------------------------------------

/** Captura console.error mientras corre `fn`. */
async function capturarLog(fn) {
  const original = console.error;
  const lineas = [];
  console.error = (...args) => lineas.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lineas.join('\n');
}

test('errores: un 500 en una ruta de clientes trae motivo y el log NO lleva el email, el mensaje ni el detail', async () => {
  const fake = instalarFakeClientes({
    extra: (sql) => {
      if (sql.includes('FROM clientes WHERE lower(email)')) {
        throw Object.assign(new Error('fallo con privado@mail.com dentro'), { code: 'XX000', detail: 'Key (email)=(privado@mail.com)' });
      }
      return undefined;
    },
  });
  try {
    let res;
    const log = await capturarLog(async () => {
      res = await request(app).post(`${V1}/auth/clientes/login`).send({ email: 'privado@mail.com', password: 'clave-secreta-1' });
    });
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(res.body, { error: 'Error interno del servidor', motivo: 'error_interno' });
    assert.ok(log.length > 0, 'se registra algo');
    for (const dato of ['privado@mail.com', 'clave-secreta-1', 'fallo con']) {
      assert.ok(!log.includes(dato), `el log lleva "${dato}": ${log}`);
    }
    assert.match(log, /XX000/);
    assert.match(log, /POST \/api\/v1\/auth\/clientes\/login/);
  } finally {
    fake.restaurar();
  }
});

test('errores: un CHECK de la base (23514) en una ruta de clientes -> 422 dato_invalido, y el log sin el detail', async () => {
  const fake = instalarFakeClientes({
    extra: (sql) => {
      if (sql.includes('UPDATE clientes SET')) {
        throw Object.assign(new Error('violates check constraint'), { code: '23514', detail: 'Failing row contains (1, Ana, ana@mail.com, 3001234567)' });
      }
      return undefined;
    },
  });
  try {
    const r = await request(app).post(`${V1}/auth/clientes/registro`).send({ nombre: 'Ana', email: 'ana@mail.com', password: CLAVE });
    let res;
    const log = await capturarLog(async () => {
      res = await request(app).patch(`${V1}/clientes/yo`).set('Authorization', `Bearer ${r.body.token}`).send({ nombre: 'Ana' });
    });
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.motivo, 'dato_invalido');
    assert.ok(!log.includes('ana@mail.com') && !log.includes('Failing row'), log);
    assert.match(log, /23514/);
  } finally {
    fake.restaurar();
  }
});

test('errores: fuera de las rutas de clientes el log sigue igual de completo (no se pierde el detalle)', async () => {
  const appMini = express();
  appMini.get('/api/pedidos/x', (req, res, next) => next(Object.assign(new Error('mensaje interno'), { code: '23514', detail: 'detalle' })));
  appMini.use(manejadorErrores);
  let res;
  const log = await capturarLog(async () => {
    res = await request(appMini).get('/api/pedidos/x');
  });
  assert.strictEqual(res.status, 422);
  assert.deepStrictEqual(Object.keys(res.body), ['error'], 'fuera de clientes, el 422 no cambia de forma');
  assert.match(log, /mensaje interno/);
  assert.match(log, /detalle/);
});

test('errores: ninguna respuesta de clientes devuelve password_hash ni hashes de token', () =>
  conCliente(async ({ sesion }) => {
    const auth = { Authorization: `Bearer ${sesion.token}` };
    const respuestas = [
      sesion,
      (await request(app).post(`${V1}/auth/clientes/login`).send({ email: 'ana@mail.com', password: CLAVE })).body,
      (await request(app).post(`${V1}/auth/clientes/refresh`).send({ refresh_token: sesion.refresh_token })).body,
      (await request(app).get(`${V1}/clientes/yo`).set(auth)).body,
      (await request(app).patch(`${V1}/clientes/yo`).set(auth).send({ nombre: 'Ana B' })).body,
    ];
    for (const cuerpo of respuestas) {
      const texto = JSON.stringify(cuerpo);
      assert.ok(!/password|hash|\$2[aby]\$/.test(texto), texto);
      assert.ok(!/[0-9a-f]{64}/.test(texto), `un hash de token: ${texto}`);
    }
  }));

// ---------------------------------------------------------------------------
// Límites de las rutas de clientes
// ---------------------------------------------------------------------------

/** Mini app con un par de limitadores y un manejador que responde `estado`. */
function appConLimites(par, estado = () => 200) {
  const a = express();
  a.use(express.json());
  a.post('/r', ...par, (req, res) => res.status(estado(req)).json({ ok: true }));
  return a;
}

const envReal = (extra = {}) => ({ NODE_ENV: 'production', ...extra });

test('límites: registro cuenta por EMAIL normalizado (5/h): el sexto con el mismo email es 429, otro email pasa', async () => {
  const { registro } = crearLimitadoresClientes(envReal());
  const a = appConLimites(registro);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual((await request(a).post('/r').send({ email: i % 2 ? 'ANA@mail.com ' : 'ana@mail.com' })).status, 200);
  }
  const res = await request(a).post('/r').send({ email: '  Ana@Mail.com' });
  assert.strictEqual(res.status, 429);
  assert.deepStrictEqual(res.body, { error: MENSAJE_CLIENTES, motivo: 'demasiadas_peticiones' });
  assert.ok(Number(res.headers['retry-after']) > 0, 'con Retry-After');
  assert.ok(!JSON.stringify(res.body).includes('ana'), 'no repite el email');
  assert.strictEqual((await request(a).post('/r').send({ email: 'beto@mail.com' })).status, 200);
});

test('límites: registro tiene además un freno por IP (variable propia)', async () => {
  const { registro } = crearLimitadoresClientes(envReal({ RATE_LIMIT_CLIENTES_REGISTRO_IP_MAX: '3' }));
  const a = appConLimites(registro);
  for (let i = 0; i < 3; i++) assert.strictEqual((await request(a).post('/r').send({ email: `c${i}@mail.com` })).status, 200);
  assert.strictEqual((await request(a).post('/r').send({ email: 'otro@mail.com' })).status, 429);
});

test('límites: sin email de texto en el cuerpo solo cuenta el freno por IP', async () => {
  const { registro } = crearLimitadoresClientes(envReal({ RATE_LIMIT_CLIENTES_REGISTRO_EMAIL_MAX: '1' }));
  const a = appConLimites(registro);
  for (let i = 0; i < 4; i++) assert.strictEqual((await request(a).post('/r').send({ email: 5 })).status, 200);
});

test('límites: login cuenta solo los FALLIDOS por email (10 / 15 min)', async () => {
  const { login } = crearLimitadoresClientes(envReal());
  const a = appConLimites(login, (req) => (req.body.password === 'buena' ? 200 : 401));
  for (let i = 0; i < 20; i++) assert.strictEqual((await request(a).post('/r').send({ email: 'ana@mail.com', password: 'buena' })).status, 200);
  for (let i = 0; i < 10; i++) assert.strictEqual((await request(a).post('/r').send({ email: 'ana@mail.com', password: 'mala' })).status, 401);
  assert.strictEqual((await request(a).post('/r').send({ email: 'ANA@mail.com', password: 'mala' })).status, 429);
  assert.strictEqual((await request(a).post('/r').send({ email: 'beto@mail.com', password: 'mala' })).status, 401, 'otra cuenta no');
});

test('límites: refresh y logout COMPARTEN el contador por hash del token (10/min); otro token pasa', async () => {
  const { refresh, logout } = crearLimitadoresClientes(envReal());
  assert.strictEqual(refresh, logout, 'es el mismo par de limitadores');
  const a = express();
  a.use(express.json());
  a.post('/refresh', ...refresh, (req, res) => res.json({ ok: true }));
  a.post('/logout', ...logout, (req, res) => res.status(204).end());
  const token = 'A'.repeat(43);
  for (let i = 0; i < 10; i++) {
    const ruta = i % 2 ? '/logout' : '/refresh';
    assert.ok([200, 204].includes((await request(a).post(ruta).send({ refresh_token: token })).status));
  }
  const res = await request(a).post('/logout').send({ refresh_token: token });
  assert.strictEqual(res.status, 429);
  assert.ok(!JSON.stringify(res.body).includes(token), 'no repite el token');
  assert.strictEqual((await request(a).post('/refresh').send({ refresh_token: 'B'.repeat(43) })).status, 200);
});

test('límites: dentro de las pruebas (sin NODE_ENV de producción) no cuentan', async () => {
  const { login } = crearLimitadoresClientes(process.env);
  const a = appConLimites(login, () => 401);
  for (let i = 0; i < 15; i++) assert.strictEqual((await request(a).post('/r').send({ email: 'a@b.co', password: 'x' })).status, 401);
});
