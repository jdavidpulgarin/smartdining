const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const ctrl = require('../src/controllers/mesas.controller');
const app = require('../server');

// POST /api/mesas/:id/token-qr/interno: la rotación AUTOMÁTICA del QR que pide
// el socket-server cada 3 minutos con la mesa abierta y vacía
// (socket-server/docs/rotacion-qr.md). Canal interno: x-internal-key, sin JWT.
// El comportamiento contra PostgreSQL de verdad está en
// tests/integracion/mesas-rotacion-sql.test.js.

/** Tokens con la FORMA del socket-server (la firma no se valida aquí). */
const VIEJO = 'v1.eyJtIjo1LCJzaWQiOiJ2aWVqbyJ9.ZmlybWEtdmllamE';
const NUEVO = 'v1.eyJtIjo1LCJzaWQiOiJudWV2byJ9.ZmlybWEtbnVldmE';
const OTRO = 'v1.eyJtIjo1LCJzaWQiOiJvdHJvIn0.ZmlybWEtb3RyYQ';

let siguienteMesa = 700;

/**
 * Doble de la base. La mesa existe con `estado` y `token_qr`; `conPedidos`
 * simula pedidos de la sesión actual.
 */
function fakeMesa({ existe = true, estado = 'ocupada', token = VIEJO, conPedidos = false } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1::int FOR UPDATE')) {
      return existe ? { rows: [{ id_mesa: 5, estado, token_qr: token, sesion_iniciada_en: null }] } : { rows: [] };
    }
    if (sql.includes('FROM pedidos p')) return { rows: [{ hay: conPedidos }] };
    return { rows: [] };
  });
}

const rotar = (idMesa, cuerpo, clave = CLAVE_FALSA) => {
  const req = request(app).post(`/api/mesas/${idMesa}/token-qr/interno`).send(cuerpo);
  return clave === null ? req : req.set('x-internal-key', clave);
};

const CUERPO = { token_qr: NUEVO, token_anterior: VIEJO };

/** Instala socket, redis y base; devuelve lo necesario para restaurar. */
function escenario(opcionesDb = {}, opcionesRedis = {}) {
  const avisos = [];
  const socket = instalarFakeSocket((ruta) => { avisos.push(ruta); return { ok: true }; });
  const redis = instalarFakeRedis(opcionesRedis);
  const db = fakeMesa(opcionesDb);
  return {
    db, avisos,
    restaurar() { db.restaurar(); redis.restaurar(); socket.restaurar(); },
  };
}

// ---------------------------------------------------------------------------
// Clave interna
// ---------------------------------------------------------------------------

test('rotación interna: sin x-internal-key responde 401 y no toca la base', async () => {
  const e = escenario();
  try {
    const res = await rotar(5, CUERPO, null);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(e.db.todas('FOR UPDATE').length, 0);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: una clave equivocada responde 401', async () => {
  const e = escenario();
  try {
    const res = await rotar(5, CUERPO, 'otra-clave');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0);
  } finally {
    e.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Cuerpo
// ---------------------------------------------------------------------------

for (const [caso, cuerpo] of [
  ['sin token_qr', { token_anterior: VIEJO }],
  ['sin token_anterior (es obligatorio, aunque pueda ser null)', { token_qr: NUEVO }],
  ['token_qr sin la forma v1.<datos>.<firma>', { token_qr: 'qr-token-mesa-05-q7r8s9t0', token_anterior: VIEJO }],
  ['token_qr v2', { token_qr: 'v2.abc.def', token_anterior: VIEJO }],
  ['token_anterior con otra forma', { token_qr: NUEVO, token_anterior: 'qr-token-mesa-05-q7r8s9t0' }],
  ['token_qr de mas de 255', { token_qr: `v1.${'a'.repeat(250)}.firma`, token_anterior: VIEJO }],
  ['un campo extra', { ...CUERPO, id_mesa: 5 }],
  ['token_qr igual al anterior', { token_qr: VIEJO, token_anterior: VIEJO }],
]) {
  test(`rotación interna: ${caso} -> 400`, async () => {
    const e = escenario();
    try {
      const res = await rotar(5, cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(e.db.todas('FOR UPDATE').length, 0);
    } finally {
      e.restaurar();
    }
  });
}

test('rotación interna: id de mesa no numérico -> 400', async () => {
  const e = escenario();
  try {
    assert.strictEqual((await rotar('abc', CUERPO)).status, 400);
  } finally {
    e.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Las respuestas que lee el rotador
// ---------------------------------------------------------------------------

test('rotación interna: mesa inexistente -> 404', async () => {
  const e = escenario({ existe: false });
  try {
    const res = await rotar(5, CUERPO);
    assert.strictEqual(res.status, 404);
    assert.ok(e.db.buscar('ROLLBACK'));
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: mesa no ocupada -> 409 mesa_no_ocupada', async () => {
  const e = escenario({ estado: 'disponible', token: null });
  try {
    const res = await rotar(5, CUERPO);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.noOcupada);
    assert.strictEqual(res.body.estado, 'disponible');
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: token_anterior distinto del vigente -> 409 (compare-and-swap)', async () => {
  const e = escenario({ token: OTRO });
  try {
    const res = await rotar(5, CUERPO);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.cambioDeToken);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: token_anterior null -> 409, no es un comodín', async () => {
  const e = escenario();
  try {
    const res = await rotar(5, { token_qr: NUEVO, token_anterior: null });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.cambioDeToken);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0, 'nunca un swap a ciegas');
  } finally {
    e.restaurar();
  }
});

test('rotación interna: la sesión ya tiene pedidos -> 409 mesa_con_comensales', async () => {
  const e = escenario({ conPedidos: true });
  try {
    const res = await rotar(5, CUERPO);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.conComensales);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: alguien ya reservó su alias en la mesa -> 409 mesa_con_comensales', async () => {
  const idMesa = siguienteMesa++;
  const e = escenario();
  try {
    await alias.reservar(idMesa, alias.normalizarAlias('Ana'), { vigencia: '3h' });
    const res = await rotar(idMesa, CUERPO);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.conComensales);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0, 'quien ya entró conserva su sesión');
  } finally {
    e.restaurar();
  }
});

test('rotación interna: si Redis no responde NO se rota -> 503 (el rotador reintenta)', async () => {
  const e = escenario({}, { caido: true });
  try {
    const res = await rotar(5, CUERPO);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.reservasNoDisponibles);
    assert.strictEqual(e.db.todas('UPDATE mesas').length, 0, 'el QR anterior sigue valiendo');
    assert.ok(e.db.buscar('ROLLBACK'));
  } finally {
    e.restaurar();
  }
});

test('rotación interna: mesa abierta y vacía -> 200, guarda el nuevo y el anterior en el histórico', async () => {
  const e = escenario();
  try {
    const res = await rotar(siguienteMesa++, CUERPO);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });

    const update = e.db.buscar('UPDATE mesas SET token_qr');
    assert.strictEqual(update.params[0], NUEVO);
    const historico = e.db.buscar('INSERT INTO token_qr_historico');
    assert.strictEqual(historico.params[1], VIEJO, 'el token anterior queda en el histórico');
    assert.ok(e.db.buscar('COMMIT'));

    // El socket-server ya avisa a la tablet al recibir el 200: aquí no se le
    // llama a /internal/qr-rotado (ni a nada).
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(e.avisos, []);
  } finally {
    e.restaurar();
  }
});

test('rotación interna: los logs nunca llevan un token', async () => {
  const lineas = [];
  const originales = { info: console.info, warn: console.warn, error: console.error, log: console.log };
  for (const k of Object.keys(originales)) console[k] = (...a) => lineas.push(a.join(' '));
  const e = escenario({ token: OTRO });
  try {
    await rotar(5, CUERPO);
    await rotar(5, { token_qr: NUEVO, token_anterior: null });
  } finally {
    Object.assign(console, originales);
    e.restaurar();
  }
  assert.ok(lineas.length > 0, 'hubo log');
  for (const l of lineas) {
    for (const t of [VIEJO, NUEVO, OTRO]) {
      assert.ok(!l.includes(t) && !l.includes(t.split('.')[1]), `el log no lleva el token: ${l}`);
    }
  }
});
