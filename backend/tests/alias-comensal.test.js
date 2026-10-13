const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { instalarFakeDb, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis, redisCaido } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const app = require('../server');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado: 'ocupada' };

/** Mesa 5 ocupada con ese token_qr vigente y un socket-server que lo valida. */
function escenario(tokenQr, idMesa = 5) {
  const db = instalarFakeDb(
    (sql) => (sql.includes('FROM mesas WHERE id_mesa') ? { rows: [{ ...MESA, id_mesa: idMesa, token_qr: tokenQr }] } : { rows: [] }),
    { tokenQrDeMesa: tokenQr }
  );
  const socket = instalarFakeSocket((ruta, cuerpo) => {
    if (ruta === '/qr/validar') {
      return cuerpo.token === tokenQr
        ? { valido: true, id_mesa: idMesa, expira_en: Date.now() + 3600000 }
        : { __status: 401, valido: false, motivo: 'firma' };
    }
    return { ok: true };
  });
  const abrir = (comensal, token = tokenQr) => request(app)
    .post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`)
    .send(comensal === undefined ? {} : { comensal });
  return {
    abrir,
    restaurar() { db.restaurar(); socket.restaurar(); },
  };
}

// Cada prueba usa una mesa distinta: la reserva en memoria dura todo el proceso.
let siguienteMesa = 100;
const mesaNueva = () => (siguienteMesa += 1);

// ---------------------------------------------------------------------------
// Validación y normalización
// ---------------------------------------------------------------------------

test('alias: se recortan y colapsan espacios; 2–40 caracteres', () => {
  assert.deepStrictEqual(alias.normalizarAlias('  Ana   María '), { alias: 'Ana María', clave: 'anamaria' });
  assert.ok(alias.normalizarAlias('Al').alias);
  assert.ok(alias.normalizarAlias('a'.repeat(40)).alias);
  for (const malo of [undefined, null, 5, '', ' ', 'A', 'a'.repeat(41), '   B   ']) {
    assert.ok(alias.normalizarAlias(malo).error, String(malo));
  }
});

test('alias: solo caracteres seguros (sin HTML, barras, comillas dobles ni emojis)', () => {
  for (const bueno of ['Ñoño', 'José-Luis', "D'Arcy", 'ana_23', 'Mesa 4.1']) {
    assert.ok(alias.normalizarAlias(bueno).alias, bueno);
  }
  for (const malo of ['<script>', 'Ana"', 'a/b', 'a\\b', 'Ana 🍕', 'Ana\u0000', '...', '--']) {
    assert.ok(alias.normalizarAlias(malo).error, malo);
  }
});

test('alias: "Ana", "ana", "ÁNA" y "A.na" son el mismo para la unicidad', () => {
  const claves = ['Ana', 'ana', 'ÁNA', ' A.na ', 'a-na'].map((a) => alias.normalizarAlias(a).clave);
  assert.deepStrictEqual(new Set(claves), new Set(['ana']));
});

test('vigencia del JWT a segundos', () => {
  assert.deepStrictEqual(['3h', '90m', '45s', '1d', '600', 'raro'].map(alias.segundos), [10800, 5400, 45, 86400, 600, 10800]);
});

// ---------------------------------------------------------------------------
// POST /api/mesas/qr/:token/sesion
// ---------------------------------------------------------------------------

test('sesión: el alias va FIRMADO en el JWT y en la respuesta', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    const res = await e.abrir('  Ana  ');
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.comensal, 'Ana');
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.deepStrictEqual([payload.rol, payload.id_mesa, payload.comensal], ['comensal', id, 'Ana']);
  } finally {
    e.restaurar();
  }
});

test('sesión sin alias o con uno inválido: 400 y sin JWT', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    for (const malo of [undefined, 'A', '<b>Ana</b>', 42]) {
      const res = await e.abrir(malo);
      assert.strictEqual(res.status, 400, String(malo));
      assert.strictEqual(res.body.campo, 'comensal');
      assert.strictEqual(res.body.token, undefined);
    }
  } finally {
    e.restaurar();
  }
});

test('suplantación: un segundo comensal no puede tomar el mismo alias (ni con otra grafía) → 409', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    assert.strictEqual((await e.abrir('Ana')).status, 201);
    for (const copia of ['Ana', 'ana', 'ÁNA', 'A.na']) {
      const res = await e.abrir(copia);
      assert.strictEqual(res.status, 409, copia);
      assert.strictEqual(res.body.motivo, 'alias_en_uso');
      assert.strictEqual(res.body.token, undefined);
    }
    assert.strictEqual((await e.abrir('Beto')).status, 201, 'otro alias sí entra');
  } finally {
    e.restaurar();
  }
});

test('el mismo alias en OTRA mesa no choca', async () => {
  const a = mesaNueva();
  const b = mesaNueva();
  const qrA = construirTokenQr(a).token;
  const qrB = construirTokenQr(b).token;
  const ea = escenario(qrA, a);
  try {
    assert.strictEqual((await ea.abrir('Caro')).status, 201);
  } finally {
    ea.restaurar();
  }
  const eb = escenario(qrB, b);
  try {
    assert.strictEqual((await eb.abrir('Caro')).status, 201);
  } finally {
    eb.restaurar();
  }
});

test('un QR inválido no gasta el alias', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    assert.strictEqual((await e.abrir('Dani', 'qr-falso')).status, 401);
    assert.strictEqual((await e.abrir('Dani')).status, 201);
  } finally {
    e.restaurar();
  }
});

test('al liberar la mesa (o abrir sesión nueva) los alias quedan libres', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    assert.strictEqual((await e.abrir('Eva')).status, 201);
    assert.strictEqual((await e.abrir('Eva')).status, 409);
    await alias.olvidarMesa(id);
    assert.strictEqual((await e.abrir('Eva')).status, 201);
  } finally {
    e.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Con Redis (doble): reserva atómica, TTL y fallo cerrado
// ---------------------------------------------------------------------------

test('Redis: HSETNX en sd:mesa:{id}:alias con el TTL del JWT; liberar borra la llave', async () => {
  const redis = instalarFakeRedis();
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  try {
    assert.strictEqual((await e.abrir('Fer')).status, 201);
    assert.strictEqual((await e.abrir('fer')).status, 409);
    const llave = `sd:mesa:${id}:alias`;
    assert.deepStrictEqual(redis.todas('hSetNX').map((o) => [o.clave, o.campo]), [[llave, 'fer'], [llave, 'fer']]);
    assert.strictEqual(redis.ttlDe(llave), 3 * 60 * 60);
    assert.strictEqual(redis.valorDe(llave).fer && JSON.parse(redis.valorDe(llave).fer).alias, 'Fer');
    await alias.olvidarMesa(id);
    assert.strictEqual(redis.tiene(llave), false);
  } finally {
    e.restaurar();
    redis.restaurar();
  }
});

test('Redis caído o que falla al reservar: 503 y sin JWT (falla cerrado)', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  for (const instalar of [redisCaido, () => instalarFakeRedis({ falloEn: ['hSetNX'] })]) {
    const redis = instalar();
    const e = escenario(token, id);
    try {
      const res = await e.abrir('Gabi');
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.motivo, 'alias_no_disponible');
      assert.strictEqual(res.body.token, undefined);
    } finally {
      e.restaurar();
      redis.restaurar();
    }
  }
});

test('producción sin REDIS_URL: no hay respaldo en memoria → 503', async () => {
  const id = mesaNueva();
  const { token } = construirTokenQr(id);
  const e = escenario(token, id);
  const previo = { entorno: process.env.NODE_ENV, url: process.env.REDIS_URL };
  process.env.NODE_ENV = 'production';
  delete process.env.REDIS_URL;
  try {
    const res = await e.abrir('Hugo');
    assert.strictEqual(res.status, 503);
  } finally {
    process.env.NODE_ENV = previo.entorno;
    if (previo.url === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previo.url;
    e.restaurar();
  }
});
