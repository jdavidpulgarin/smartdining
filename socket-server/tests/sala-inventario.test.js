const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, esperar, tokenComensal, tokenPantalla, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

// POST /internal/inventario-alerta → inventario:alerta solo a room:admin (EVENTS.md §5.5).

const RUTA = '/internal/inventario-alerta';
const EVENTO = 'inventario:alerta';
const CAMPOS = ['agotado', 'emitidoEn', 'eventId', 'id_insumo', 'nombre', 'stock_actual', 'stock_minimo', 'unidad'];

// Un cuerpo de tipo string se manda tal cual (para probar JSON malformado).
const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${RUTA}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const aviso = (extra = {}) => ({
  id_insumo: 12, nombre: 'Queso costeño', unidad: 'g', stock_actual: 450, stock_minimo: 500, eventId: randomUUID(), ...extra,
});

// Cada prueba corre con el registro de idempotencia en memoria y con el doble de Redis.
const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({ falso: null, deps: {} }),
  redis: () => {
    const falso = crearRedisFalso();
    return { falso, deps: { redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso }) } };
  },
};

/** Personal de sala (admin, mesero, cajero), cocina, un comensal en su mesa y la pantalla de esa mesa. */
async function escenario(t, almacen, env = {}) {
  const { falso, deps } = ALMACENES[almacen]();
  const s = await levantar(env, deps);
  t.after(() => s.cerrar());
  const comensal = await s.conectar(tokenComensal(5));
  await emitir(comensal, 'join:table', {});
  const pantalla = await s.conectar(tokenPantalla(5));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const cajero = await s.conectar(tokenPersonal('cajero'));
  return { s, falso, comensal, pantalla, cocina, admin, mesero, cajero };
}

/** Hace fallar UNA vez el emit de inventario:alerta (socket.io no exporta BroadcastOperator). */
function fallarEmisionUnaVez(t, s) {
  const proto = Object.getPrototypeOf(s.io.to('room:ninguna'));
  const original = proto.emit;
  let pendiente = true;
  proto.emit = function emit(evento, ...args) {
    if (evento === EVENTO && pendiente) {
      pendiente = false;
      throw new Error('falla simulada al emitir');
    }
    return original.call(this, evento, ...args);
  };
  t.after(() => { proto.emit = original; });
}

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] válido: 200 y llega solo a room:admin (admin, mesero, cajero), no a mesas, pantalla ni cocina`, async (t) => {
    const e = await escenario(t, almacen);
    const llegan = [e.admin, e.mesero, e.cajero].map((c) => esperar(c, EVENTO, 1000));
    const nada = [e.comensal, e.pantalla, e.cocina].map((c) => esperar(c, EVENTO, 400));
    const cuerpo = aviso();
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
    for (const ev of await Promise.all(llegan)) {
      assert.ok(ev, 'el personal de sala debe recibirlo');
      assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS);
      const { emitidoEn, ...resto } = ev;
      assert.deepStrictEqual(resto, { ...cuerpo, agotado: false });
      assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
    }
    assert.deepStrictEqual(await Promise.all(nada), [null, null, null], 'mesas, pantalla y cocina no lo reciben');
  });

  test(`[${almacen}] agotado: true con stock_actual 0, false con > 0 (decimales incluidos)`, async (t) => {
    const e = await escenario(t, almacen);
    for (const [stock_actual, agotado] of [[0, true], [0.5, false], [500, false]]) {
      const llega = esperar(e.admin, EVENTO, 1000);
      assert.strictEqual((await avisar(e.s, aviso({ stock_actual, stock_minimo: 1.25 }))).status, 200);
      const ev = await llega;
      assert.deepStrictEqual([ev.stock_actual, ev.stock_minimo, ev.agotado], [stock_actual, 1.25, agotado]);
    }
  });

  test(`[${almacen}] los campos extra del cuerpo se descartan (no pueden pisar agotado ni emitidoEn)`, async (t) => {
    const e = await escenario(t, almacen);
    const llega = esperar(e.admin, EVENTO, 1000);
    const r = await avisar(e.s, aviso({
      stock_actual: 10, agotado: true, emitidoEn: '2000-01-01T00:00:00.000Z', id_mesa: 5, html: '<script>', proveedor: 'X',
    }));
    assert.strictEqual(r.status, 200);
    const ev = await llega;
    assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS);
    assert.strictEqual(ev.agotado, false);
    assert.notStrictEqual(ev.emitidoEn, '2000-01-01T00:00:00.000Z');
  });

  test(`[${almacen}] duplicado: el mismo eventId responde duplicado:true y no se reemite`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = aviso();
    const primero = esperar(e.admin, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, cuerpo)).json(), { ok: true, duplicado: false });
    assert.ok(await primero);
    const segundo = esperar(e.admin, EVENTO, 400);
    const r = await avisar(e.s, { ...cuerpo, stock_actual: 0 });
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: true }]);
    assert.strictEqual(await segundo, null);
    if (e.falso) assert.ok(e.falso.llaves().includes(`sd:idem:backend:inventario-alerta:${cuerpo.eventId}`));
  });

  test(`[${almacen}] la clave de idempotencia es propia: el mismo eventId en plato-disponibilidad no la bloquea`, async (t) => {
    const e = await escenario(t, almacen);
    const eventId = randomUUID();
    const plato = await fetch(`${e.s.url}/internal/plato-disponibilidad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
      body: JSON.stringify({ id_plato: 3, disponible: false, eventId }),
    });
    assert.strictEqual((await plato.json()).duplicado, false);
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.strictEqual((await (await avisar(e.s, aviso({ eventId }))).json()).duplicado, false);
    assert.ok(await llega);
  });

  test(`[${almacen}] payload inválido: 400 PAYLOAD_INVALIDO, no emite y no consume el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const eventId = randomUUID();
    const nada = esperar(e.admin, EVENTO, 400);
    const sin = (campo) => { const c = aviso({ eventId }); delete c[campo]; return c; };
    const con = (cambio) => aviso({ eventId, ...cambio });
    const malos = [
      // id_insumo
      con({ id_insumo: '12' }), con({ id_insumo: 0 }), con({ id_insumo: -3 }), con({ id_insumo: 1.5 }),
      con({ id_insumo: 2 ** 53 }), con({ id_insumo: null }), sin('id_insumo'),
      // nombre (1–80) y unidad (1–15)
      con({ nombre: '' }), con({ nombre: 'x'.repeat(81) }), con({ nombre: 12 }), con({ nombre: null }),
      con({ nombre: ['Queso'] }), sin('nombre'),
      con({ unidad: '' }), con({ unidad: 'x'.repeat(16) }), con({ unidad: 1 }), sin('unidad'),
      // stock: números JSON finitos ≥ 0; el texto (NUMERIC de pg sin convertir) también es 400
      con({ stock_actual: '450.00' }), con({ stock_actual: '0' }), con({ stock_actual: -1 }), con({ stock_actual: -0.01 }),
      con({ stock_actual: null }), con({ stock_actual: true }), sin('stock_actual'),
      con({ stock_minimo: '500' }), con({ stock_minimo: -5 }), con({ stock_minimo: {} }), sin('stock_minimo'),
      // eventId obligatorio y UUID (estos no usan el eventId que se comprueba al final)
      sin('eventId'), aviso({ eventId: 'x' }), aviso({ eventId: null }), aviso({ eventId: 123 }),
    ];
    for (const cuerpo of malos) {
      const r = await avisar(e.s, cuerpo);
      assert.strictEqual(r.status, 400, JSON.stringify(cuerpo));
      assert.strictEqual((await r.json()).codigo, 'PAYLOAD_INVALIDO', JSON.stringify(cuerpo));
    }
    // 1e400 es Infinity al parsearse: no es un número finito.
    const infinito = await avisar(e.s, `{"id_insumo":1,"nombre":"Sal","unidad":"g","stock_actual":1e400,"stock_minimo":1,"eventId":"${eventId}"}`);
    assert.strictEqual(infinito.status, 400);
    assert.strictEqual(await nada, null);
    // Ningún 4xx consumió el eventId: el primer aviso válido con él se emite.
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, aviso({ eventId }))).json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });

  test(`[${almacen}] límites aceptados: nombre de 80 caracteres (con tildes y emoji), unidad de 15, stock 0/0`, async (t) => {
    const e = await escenario(t, almacen);
    const nombre = `${'ñ'.repeat(78)}🧀🧀`; // 80 caracteres, 82 unidades UTF-16
    assert.strictEqual([...nombre].length, 80);
    const llega = esperar(e.admin, EVENTO, 1000);
    const r = await avisar(e.s, aviso({ nombre, unidad: 'u'.repeat(15), stock_actual: 0, stock_minimo: 0 }));
    assert.strictEqual(r.status, 200);
    const ev = await llega;
    assert.deepStrictEqual([ev.nombre, ev.agotado], [nombre, true]);
  });

  test(`[${almacen}] JSON malformado o que no es objeto: 400 JSON_INVALIDO sin emitir`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = esperar(e.admin, EVENTO, 400);
    for (const cuerpo of ['{"id_insumo": 1,', '[1,2]', '"texto"', 'null', '12']) {
      const r = await avisar(e.s, cuerpo);
      assert.strictEqual(r.status, 400, cuerpo);
      assert.strictEqual((await r.json()).codigo, 'JSON_INVALIDO', cuerpo);
    }
    assert.strictEqual(await nada, null);
  });

  test(`[${almacen}] sin clave o con clave errónea: 401 NO_AUTORIZADO, sin emitir ni consumir el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = aviso();
    const nada = esperar(e.admin, EVENTO, 400);
    for (const clave of [null, 'otra', `${CLAVE_INTERNA}x`]) {
      const r = await avisar(e.s, cuerpo, clave);
      assert.strictEqual(r.status, 401);
      assert.strictEqual((await r.json()).codigo, 'NO_AUTORIZADO');
    }
    assert.strictEqual(await nada, null);
    assert.strictEqual((await (await avisar(e.s, cuerpo)).json()).duplicado, false);
  });

  test(`[${almacen}] emisión que falla: 500 ERROR_INTERNO, se libera la clave y el reintento emite`, async (t) => {
    const e = await escenario(t, almacen);
    fallarEmisionUnaVez(t, e.s);
    const cuerpo = aviso();
    const nada = esperar(e.admin, EVENTO, 300);
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [500, 'ERROR_INTERNO']);
    assert.strictEqual(await nada, null);
    if (e.falso) assert.ok(!e.falso.llaves().includes(`sd:idem:backend:inventario-alerta:${cuerpo.eventId}`), 'la clave se liberó');
    const llega = esperar(e.admin, EVENTO, 1000);
    const reintento = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([reintento.status, await reintento.json()], [200, { ok: true, duplicado: false }]);
    assert.strictEqual((await llega).eventId, cuerpo.eventId);
  });
}

test('sin INTERNAL_API_KEY configurada: 503 NO_CONFIGURADO y no se emite', async (t) => {
  // El arranque exige la clave (secretos.js): se quita del config ya cargado,
  // que es el mismo objeto que lee la ruta, para cubrir la defensa del endpoint.
  const e = await escenario(t, 'memoria');
  e.s.config.internalApiKey = undefined;
  const nada = esperar(e.admin, EVENTO, 400);
  const r = await avisar(e.s, aviso());
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [503, 'NO_CONFIGURADO']);
  assert.strictEqual(await nada, null);
});

test('con Redis caído: 500 ERROR_INTERNO sin emitir; al volver, el mismo eventId se emite', async (t) => {
  const e = await escenario(t, 'redis');
  const cuerpo = aviso();
  e.falso.caer();
  const nada = esperar(e.admin, EVENTO, 300);
  const r = await avisar(e.s, cuerpo);
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [500, 'ERROR_INTERNO']);
  assert.strictEqual(await nada, null);
  e.falso.levantar();
  const llega = esperar(e.admin, EVENTO, 1000);
  assert.strictEqual((await (await avisar(e.s, cuerpo)).json()).duplicado, false);
  assert.ok(await llega);
});

test('un comensal no puede emitirlo por socket (no existe como evento de cliente)', async (t) => {
  const e = await escenario(t, 'memoria');
  const nada = esperar(e.admin, EVENTO, 300);
  e.comensal.emit(EVENTO, aviso());
  assert.strictEqual(await nada, null);
});
