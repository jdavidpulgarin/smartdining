const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');
const { MENSAJE_CUENTA_INACTIVA } = require('../src/middleware/auth.middleware');
const usuarioActivo = require('../src/services/usuario-activo');
const redis = require('../src/config/redis');

// H-09: un JWT valido no basta. El token vive 8 horas y no se puede retirar, asi
// que tras desactivar a alguien su token seguia abriendo la API hasta que
// caducaba (la auditoria lo midio: GET /api/mesas seguia en 200).

const SQL_USUARIO = 'FROM usuarios WHERE id_usuario';

// ---------------------------------------------------------------------------
// El middleware
// ---------------------------------------------------------------------------

test('h-09: un usuario activo entra con normalidad', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200);
    assert.ok(db.buscar(SQL_USUARIO), 'se comprueba la cuenta en cada peticion');
  } finally {
    db.restaurar();
  }
});

test('h-09: un usuario desactivado recibe 401 aunque su JWT sea valido', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioInactivo: true });
  try {
    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 401, 'antes seguia en 200 hasta que el token caducaba');
    assert.strictEqual(res.body.error, MENSAJE_CUENTA_INACTIVA);
  } finally {
    db.restaurar();
  }
});

test('h-09: un usuario que ya no existe tampoco entra', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioSinRegistro: true });
  try {
    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(99, 'admin')}`);

    assert.strictEqual(res.status, 401, 'un usuario borrado cuenta como inactivo');
  } finally {
    db.restaurar();
  }
});

test('h-09: la comprobacion va ANTES del rol', async () => {
  // Un desactivado con rol insuficiente recibe 401, no 403: la cuenta se
  // comprueba primero, y asi un 403 no confirma que la cuenta siga viva.
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioInactivo: true });
  try {
    const res = await request(app)
      .get('/api/kds/comandas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 401);
  } finally {
    db.restaurar();
  }
});

test('h-09: si la base falla no se deja pasar a ciegas', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioConsultaFalla: true });
  try {
    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 500, 'falla cerrada, como la sesion del comensal');
    assert.notStrictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// A quien NO afecta
// ---------------------------------------------------------------------------

test('h-09: el token del comensal no pasa por esta comprobacion', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/pedidos/mesa')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      db.buscar(SQL_USUARIO),
      undefined,
      'el rol comensal no existe en la tabla usuarios: no hay nada que comprobar'
    );
  } finally {
    db.restaurar();
  }
});

test('h-09: el canal interno (x-internal-key) no pasa por esta comprobacion', async () => {
  const previo = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = CLAVE_FALSA;
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT 1 FROM mesas WHERE id_mesa')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) {
      return { rows: [{ total_centavos: '0', saldo_centavos: '0', por_comensal: [] }] };
    }
    return { rows: [] };
  }, { usuarioInactivo: true });
  try {
    const res = await request(app)
      .get('/api/mesas/5/cuenta/interno')
      .set('x-internal-key', CLAVE_FALSA);

    assert.strictEqual(res.status, 200, 'no hay usuario detras: es un servicio');
    assert.strictEqual(db.buscar(SQL_USUARIO), undefined);
  } finally {
    db.restaurar();
    if (previo === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = previo;
  }
});

test('h-09: el login no pasa por esta comprobacion', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioInactivo: true });
  try {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@smartdining.com', password: 'cualquiera' });

    assert.strictEqual(res.status, 401, 'credenciales invalidas, no cuenta inactiva');
    assert.notStrictEqual(
      res.body.error,
      MENSAJE_CUENTA_INACTIVA,
      'el login no lleva JWT: la comprobacion es del middleware, no de aqui'
    );
    assert.strictEqual(db.buscar(SQL_USUARIO), undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La cache (se salta en pruebas, asi que aqui se prueba con entorno forzado)
// ---------------------------------------------------------------------------

/** Cliente de Redis de mentira, con su propio almacen. */
function clienteFalso({ fallaAl } = {}) {
  const datos = new Map();
  return {
    datos,
    async get(k) {
      if (fallaAl === 'leer') throw new Error('redis caido');
      return datos.has(k) ? datos.get(k) : null;
    },
    async set(k, v, opciones) {
      if (fallaAl === 'escribir') throw new Error('redis caido');
      datos.set(k, v);
      datos.set(`${k}:ttl`, opciones?.EX);
    },
    async del(k) {
      datos.delete(k);
      return 1;
    },
  };
}

/** Sustituye connectRedis por un doble y lo restaura. */
function conRedisFalso(cliente) {
  const original = redis.connectRedis;
  redis.connectRedis = async () => cliente;
  return { restaurar: () => { redis.connectRedis = original; } };
}

const ENV_REAL = { NODE_ENV: 'production' };

test('h-09: la cache esta desactivada dentro de las pruebas', () => {
  assert.strictEqual(
    usuarioActivo.cacheActiva({ NODE_TEST_CONTEXT: 'child-v8' }),
    false,
    'una cache compartida con TTL filtraria estado de una prueba a la siguiente'
  );
  assert.strictEqual(usuarioActivo.cacheActiva(ENV_REAL), true);
});

test('h-09: la segunda consulta sale de la cache, sin tocar la base', async () => {
  const cliente = clienteFalso();
  const falso = conRedisFalso(cliente);
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(3, { env: ENV_REAL }), true);
    const consultasTrasLaPrimera = db.todas(SQL_USUARIO).length;

    assert.strictEqual(await usuarioActivo.estaActivo(3, { env: ENV_REAL }), true);
    assert.strictEqual(
      db.todas(SQL_USUARIO).length,
      consultasTrasLaPrimera,
      'la segunda no vuelve a preguntarle a PostgreSQL'
    );
  } finally {
    db.restaurar();
    falso.restaurar();
  }
});

test('h-09: la cache guarda el resultado con su TTL', async () => {
  const cliente = clienteFalso();
  const falso = conRedisFalso(cliente);
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    await usuarioActivo.estaActivo(7, { env: ENV_REAL });

    assert.strictEqual(cliente.datos.get(usuarioActivo.llave(7)), '1');
    assert.strictEqual(
      cliente.datos.get(`${usuarioActivo.llave(7)}:ttl`),
      usuarioActivo.TTL_POR_DEFECTO_SEG
    );
  } finally {
    db.restaurar();
    falso.restaurar();
  }
});

test('h-09: tambien se cachea el "no" para no repetir la consulta', async () => {
  const cliente = clienteFalso();
  const falso = conRedisFalso(cliente);
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioInactivo: true });
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(8, { env: ENV_REAL }), false);
    assert.strictEqual(cliente.datos.get(usuarioActivo.llave(8)), '0');
    assert.strictEqual(await usuarioActivo.estaActivo(8, { env: ENV_REAL }), false);
  } finally {
    db.restaurar();
    falso.restaurar();
  }
});

test('h-09: el TTL se puede configurar', () => {
  assert.strictEqual(usuarioActivo.ttlSegundos({ CACHE_USUARIO_TTL_SEG: '15' }), 15);
  assert.strictEqual(usuarioActivo.ttlSegundos({}), usuarioActivo.TTL_POR_DEFECTO_SEG);
  assert.strictEqual(usuarioActivo.ttlSegundos({ CACHE_USUARIO_TTL_SEG: 'nada' }), 60);
  assert.strictEqual(usuarioActivo.ttlSegundos({ CACHE_USUARIO_TTL_SEG: '0' }), 60);
});

// ---------------------------------------------------------------------------
// Redis nunca puede tumbar una peticion
// ---------------------------------------------------------------------------

test('h-09: si Redis falla al LEER, se consulta la base y se sigue', async () => {
  const falso = conRedisFalso(clienteFalso({ fallaAl: 'leer' }));
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(3, { env: ENV_REAL }), true);
    assert.ok(db.buscar(SQL_USUARIO), 'se cae a PostgreSQL, que es quien decide');
  } finally {
    db.restaurar();
    falso.restaurar();
  }
});

test('h-09: si Redis falla al ESCRIBIR, la peticion sigue adelante', async () => {
  const falso = conRedisFalso(clienteFalso({ fallaAl: 'escribir' }));
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(3, { env: ENV_REAL }), true);
  } finally {
    db.restaurar();
    falso.restaurar();
  }
});

test('h-09: si no hay Redis en absoluto, tampoco se rompe nada', async () => {
  const original = redis.connectRedis;
  redis.connectRedis = async () => {
    throw new Error('sin redis');
  };
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(3, { env: ENV_REAL }), true);
  } finally {
    db.restaurar();
    redis.connectRedis = original;
  }
});

test('h-09: olvidar la cache no lanza si Redis esta caido', async () => {
  const original = redis.connectRedis;
  redis.connectRedis = async () => {
    throw new Error('sin redis');
  };
  try {
    assert.strictEqual(await usuarioActivo.olvidar(3), false, 'devuelve false, no lanza');
  } finally {
    redis.connectRedis = original;
  }
});

test('h-09: un id vacio no se consulta ni se cachea', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await usuarioActivo.estaActivo(undefined, { env: ENV_REAL }), false);
    assert.strictEqual(await usuarioActivo.estaActivo(null, { env: ENV_REAL }), false);
    assert.strictEqual(db.buscar(SQL_USUARIO), undefined);
  } finally {
    db.restaurar();
  }
});
