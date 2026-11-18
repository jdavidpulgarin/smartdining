const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeClientes, DIA_MS } = require('./helpers/fake-clientes');
const { SQL } = require('../src/services/sesiones-cliente.service');
const { hashDeRefresh } = require('../src/utils/refresh-token');
const app = require('../server');

// D-19 parte B: POST /api/v1/auth/clientes/refresh, rama por rama, en el orden
// del contrato (docs/api-spec.md, "La ventana de gracia del refresh"). El
// reloj es el del doble (estado.ahora): la base real mide con now(), y eso lo
// prueba tests/integracion/clientes-sql.test.js.

const BASE = '/api/v1/auth/clientes';
const CLAVE = 'una-clave-buena';
const SEG = 1000;

const refrescar = (token) => request(app).post(`${BASE}/refresh`).send({ refresh_token: token });

/** Doble puesto + un cliente registrado. `fn({ estado, db, inicial })`. */
async function escenario(fn, { env = {} } = {}) {
  const previas = {};
  for (const [k, v] of Object.entries(env)) {
    previas[k] = process.env[k];
    process.env[k] = v;
  }
  const fake = instalarFakeClientes();
  try {
    const r = await request(app).post(`${BASE}/registro`).send({ nombre: 'Ana', email: 'ana@mail.com', password: CLAVE });
    assert.strictEqual(r.status, 201);
    return await fn({ ...fake, inicial: r.body.refresh_token });
  } finally {
    fake.restaurar();
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const filaDe = (estado, token) => estado.tokens.find((t) => t.hash === hashDeRefresh(token));
const vigentesDe = (estado, familia) =>
  estado.tokens.filter((t) => t.familia === familia && t.revocado_en === null && t.reemplazado_por === null);

test('refresh vigente: 200 { token, refresh_token, expira_en } y rotación normal en la misma familia', () =>
  escenario(async ({ estado, inicial }) => {
    estado.ahora += 60 * SEG;
    const res = await refrescar(inicial);

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(Object.keys(res.body).sort(), ['expira_en', 'refresh_token', 'token']);
    assert.notStrictEqual(res.body.refresh_token, inicial, 'siempre rota');
    assert.match(res.body.refresh_token, /^[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(jwt.decode(res.body.token).sub, '1');
    assert.strictEqual(jwt.decode(res.body.token).rol, 'cliente');

    const viejo = filaDe(estado, inicial);
    const nuevo = filaDe(estado, res.body.refresh_token);
    assert.strictEqual(viejo.reemplazado_por, nuevo.id);
    assert.strictEqual(viejo.rotado_en, estado.ahora, 'rotado_en = now()');
    assert.strictEqual(viejo.revocado_en, null, 'la rotación normal NO revoca');
    assert.strictEqual(nuevo.familia, viejo.familia);
    assert.strictEqual(nuevo.id_cliente, viejo.id_cliente);
    assert.strictEqual(nuevo.expira_en - nuevo.creado_en, 30 * DIA_MS, 'vida completa');
  }));

test('refresh vigente: en UNA transacción, SELECT FOR UPDATE primero, INSERT del nuevo ANTES del UPDATE del viejo', () =>
  escenario(async ({ db, inicial }) => {
    const desde = db.ejecutadas.length;
    await refrescar(inicial);
    const orden = db.ejecutadas.slice(desde).map((q) => q.sql);

    const i = (sql) => orden.indexOf(sql);
    assert.ok(i('BEGIN') >= 0 && i('COMMIT') > i('BEGIN'));
    assert.ok(i(SQL.buscarPorHash) > i('BEGIN'));
    assert.ok(i(SQL.insertar) > i(SQL.buscarPorHash));
    assert.ok(i(SQL.rotar) > i(SQL.insertar), 'primero el nuevo: el trigger exige que el reemplazo exista');
    assert.ok(i('COMMIT') > i(SQL.rotar));
    assert.strictEqual(i('ROLLBACK'), -1);
    assert.match(SQL.buscarPorHash, /FOR UPDATE OF r/);
    // Tipos explícitos en cada parámetro.
    for (const sql of Object.values(SQL)) {
      for (const [, n] of sql.matchAll(/\$(\d+)(?!::)/g)) assert.fail(`$${n} sin tipo en: ${sql}`);
    }
  }));

test('refresh: un token que no existe -> 401 refresh_invalido y no cambia nada', () =>
  escenario(async ({ estado }) => {
    const antes = JSON.stringify(estado.tokens);
    const res = await refrescar('Z'.repeat(43));
    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, {
      error: 'La sesión no es válida o ya venció: inicia sesión de nuevo',
      motivo: 'refresh_invalido',
    });
    assert.strictEqual(JSON.stringify(estado.tokens), antes);
  }));

test('refresh: un token vencido -> 401 refresh_invalido, SIN revocar la familia', () =>
  escenario(async ({ estado, inicial }) => {
    estado.ahora += 30 * DIA_MS; // expira_en <= now()
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'refresh_invalido');
    assert.ok(estado.tokens.every((t) => t.revocado_en === null), 'un vencido no revoca nada');
  }));

test('refresh: REFRESH_CLIENTE_DIAS cambia la vida del token', () =>
  escenario(
    async ({ estado, inicial }) => {
      const fila = filaDe(estado, inicial);
      assert.strictEqual(fila.expira_en - fila.creado_en, 2 * DIA_MS);
      estado.ahora += 2 * DIA_MS - SEG;
      assert.strictEqual((await refrescar(inicial)).status, 200, 'un segundo antes, vale');
    },
    { env: { REFRESH_CLIENTE_DIAS: '2' } }
  ));

test('refresh: cliente inactivo -> 401 refresh_invalido, sin revocar nada', () =>
  escenario(async ({ estado, inicial }) => {
    estado.clientes[0].activo = false;
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'refresh_invalido');
    assert.ok(estado.tokens.every((t) => t.revocado_en === null));
  }));

test('refresh: un token revocado (logout) -> revoca TODA la familia y 401 sesion_revocada, con COMMIT', () =>
  escenario(async ({ estado, db, inicial }) => {
    const segundo = (await refrescar(inicial)).body.refresh_token;
    const tercero = (await refrescar(segundo)).body.refresh_token;
    await request(app).post(`${BASE}/logout`).send({ refresh_token: segundo });
    estado.ahora += 5 * SEG;

    const desde = db.ejecutadas.length;
    const res = await refrescar(segundo);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
    assert.notStrictEqual(filaDe(estado, tercero).revocado_en, null, 'también el vigente de la familia');
    const sqls = db.ejecutadas.slice(desde).map((q) => q.sql);
    assert.ok(sqls.includes(SQL.revocarFamilia));
    assert.ok(sqls.includes('COMMIT') && !sqls.includes('ROLLBACK'), 'la revocación se guarda');
  }));

test('refresh: la familia revocada ya no sirve con ningún token (tampoco el que era vigente)', () =>
  escenario(async ({ estado, inicial }) => {
    const vigente = (await refrescar(inicial)).body.refresh_token;
    estado.ahora += 60 * SEG; // fuera de la gracia
    assert.strictEqual((await refrescar(inicial)).body.motivo, 'sesion_revocada');
    assert.strictEqual((await refrescar(vigente)).body.motivo, 'sesion_revocada');
  }));

// --- La ventana de gracia ----------------------------------------------------

test('gracia: reenviar el viejo a los 10 s, con el reemplazo sin usar -> 200 y par nuevo; el reemplazo queda revocado', () =>
  escenario(async ({ estado, db, inicial }) => {
    const perdido = (await refrescar(inicial)).body.refresh_token; // la respuesta "se perdió"
    const rotadoEn = filaDe(estado, inicial).rotado_en;
    estado.ahora += 10 * SEG;

    const desde = db.ejecutadas.length;
    const res = await refrescar(inicial);

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.notStrictEqual(res.body.refresh_token, perdido, 'no se puede reenviar el perdido: solo hay hash');
    const viejo = filaDe(estado, inicial);
    const anulado = filaDe(estado, perdido);
    const nuevo = filaDe(estado, res.body.refresh_token);
    assert.notStrictEqual(anulado.revocado_en, null, '1. el reemplazo que no llegó queda revocado');
    assert.strictEqual(nuevo.familia, viejo.familia, '2. misma familia');
    assert.strictEqual(nuevo.expira_en - nuevo.creado_en, 30 * DIA_MS, '2. vida completa');
    assert.strictEqual(viejo.reemplazado_por, nuevo.id, '3. el viejo apunta al nuevo');
    assert.strictEqual(viejo.rotado_en, rotadoEn, '3. rotado_en NO se toca');
    assert.deepStrictEqual(vigentesDe(estado, viejo.familia).map((t) => t.id), [nuevo.id], 'una sola rama viva');

    // Orden de bloqueo: viejo y después su reemplazo.
    const sqls = db.ejecutadas.slice(desde).map((q) => q.sql);
    assert.ok(sqls.indexOf(SQL.bloquearReemplazo) > sqls.indexOf(SQL.buscarPorHash));
    assert.ok(sqls.indexOf(SQL.reapuntar) > sqls.indexOf(SQL.insertar));
    assert.ok(!sqls.includes(SQL.rotar), 'la gracia no vuelve a poner rotado_en');

    // Y el par nuevo funciona.
    assert.strictEqual((await refrescar(res.body.refresh_token)).status, 200);
  }));

test('gracia: el borde exacto (30 s) todavía entra; a los 31 s ya es reuso y revoca la familia', async () => {
  await escenario(async ({ estado, inicial }) => {
    await refrescar(inicial);
    estado.ahora += 30 * SEG;
    assert.strictEqual((await refrescar(inicial)).status, 200, '<= 30 s');
  });
  await escenario(async ({ estado, inicial }) => {
    const reemplazo = (await refrescar(inicial)).body.refresh_token;
    estado.ahora += 31 * SEG;
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
    assert.notStrictEqual(filaDe(estado, reemplazo).revocado_en, null, 'toda la familia');
  });
});

test('gracia: la ventana se cuenta desde la PRIMERA rotación; reintentar no la alarga', () =>
  escenario(async ({ estado, inicial }) => {
    await refrescar(inicial);
    estado.ahora += 20 * SEG;
    assert.strictEqual((await refrescar(inicial)).status, 200, 'primer reintento, a los 20 s');
    estado.ahora += 9 * SEG;
    assert.strictEqual((await refrescar(inicial)).status, 200, 'segundo reintento, a los 29 s: el reemplazo de la gracia tampoco se usó');
    estado.ahora += 2 * SEG;
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401, 'a los 31 s de la primera rotación, aunque el último reintento fue hace 2 s');
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
  }));

test('gracia: si el reemplazo YA se usó (rotó a su vez), reenviar el viejo es reuso aunque esté dentro de los 30 s', () =>
  escenario(async ({ estado, inicial }) => {
    const segundo = (await refrescar(inicial)).body.refresh_token;
    const tercero = (await refrescar(segundo)).body.refresh_token;
    estado.ahora += 5 * SEG;
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
    assert.notStrictEqual(filaDe(estado, tercero).revocado_en, null);
  }));

test('gracia: si el reemplazo fue revocado (logout), reenviar el viejo es reuso', () =>
  escenario(async ({ estado, inicial }) => {
    const segundo = (await refrescar(inicial)).body.refresh_token;
    await request(app).post(`${BASE}/logout`).send({ refresh_token: segundo });
    estado.ahora += 5 * SEG;
    const res = await refrescar(inicial);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
  }));

test('gracia: el reemplazo anulado por una gracia anterior, si llega, es reuso (revoca la familia)', () =>
  escenario(async ({ estado, inicial }) => {
    const perdido = (await refrescar(inicial)).body.refresh_token;
    estado.ahora += 5 * SEG;
    const bueno = (await refrescar(inicial)).body.refresh_token; // gracia: anula `perdido`
    const res = await refrescar(perdido);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
    assert.notStrictEqual(filaDe(estado, bueno).revocado_en, null);
  }));

test('gracia apagada (REFRESH_CLIENTE_GRACIA_SEGUNDOS=0): reenviar el viejo en el acto revoca la familia', () =>
  escenario(
    async ({ estado, inicial }) => {
      const segundo = (await refrescar(inicial)).body.refresh_token;
      const res = await refrescar(inicial); // mismo instante del reloj
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.motivo, 'sesion_revocada');
      assert.notStrictEqual(filaDe(estado, segundo).revocado_en, null);
    },
    { env: { REFRESH_CLIENTE_GRACIA_SEGUNDOS: '0' } }
  ));

test('gracia: REFRESH_CLIENTE_GRACIA_SEGUNDOS cambia la ventana', () =>
  escenario(
    async ({ estado, inicial }) => {
      await refrescar(inicial);
      estado.ahora += 6 * SEG;
      assert.strictEqual((await refrescar(inicial)).body.motivo, 'sesion_revocada', 'con 5 s, a los 6 ya no');
    },
    { env: { REFRESH_CLIENTE_GRACIA_SEGUNDOS: '5' } }
  ));

test('refresh: un fallo de la base a mitad deshace todo (ROLLBACK) y responde 500 error_interno', async () => {
  const fake = instalarFakeClientes({
    extra: (sql) => {
      if (sql === SQL.rotar) throw Object.assign(new Error('se cayó la base'), { code: 'XX000' });
      return undefined;
    },
  });
  try {
    const r = await request(app).post(`${BASE}/registro`).send({ nombre: 'Ana', email: 'ana@mail.com', password: CLAVE });
    const res = await refrescar(r.body.refresh_token);
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(res.body, { error: 'Error interno del servidor', motivo: 'error_interno' });
    assert.ok(fake.db.buscar('ROLLBACK'));
  } finally {
    fake.restaurar();
  }
});

for (const [caso, cuerpo] of [
  ['sin cuerpo', undefined],
  ['refresh_token de 42 caracteres', { refresh_token: 'A'.repeat(42) }],
  ['refresh_token con un punto', { refresh_token: `${'A'.repeat(42)}.` }],
  ['un campo de más', { refresh_token: 'A'.repeat(43), id_cliente: 1 }],
]) {
  test(`refresh: ${caso} -> 400 cuerpo_invalido, sin tocar la base`, () =>
    escenario(async ({ db }) => {
      const desde = db.ejecutadas.length;
      const peticion = request(app).post(`${BASE}/refresh`);
      const res = cuerpo === undefined ? await peticion : await peticion.send(cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(db.ejecutadas.length, desde);
    }));
}
