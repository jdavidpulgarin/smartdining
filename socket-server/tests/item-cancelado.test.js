const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, esperar, tokenComensal, tokenPantalla, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

// POST /internal/item-cancelado → item:cancelado a room:kds, room:admin y
// room:mesa-N (EVENTS.md §5.6). Lo llama el backend del #180.

const RUTA = '/internal/item-cancelado';
const EVENTO = 'item:cancelado';
const CAMPOS_EVENTO = [
  'codigo_pedido', 'comensal', 'emitidoEn', 'estado_pedido', 'eventId',
  'id_detalle', 'id_mesa', 'id_pedido', 'nombre', 'total',
];

const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${RUTA}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
// Lo que manda notificarItemCancelado del #180.
const aviso = (extra = {}) => ({
  id_pedido: 42,
  id_mesa: 5,
  codigo_pedido: 'PED-20261111-0042',
  id_detalle: 310,
  id_plato: 1001,
  nombre: 'Bowl Personalizado',
  comensal: 'Ana',
  total: 18000,
  estado_pedido: 'recibido',
  eventId: randomUUID(),
  ...extra,
});

const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({ falso: null, deps: {} }),
  redis: () => {
    const falso = crearRedisFalso();
    return { falso, deps: { redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso }) } };
  },
};

/** Comensal y pantalla de la mesa 5, comensal de la mesa 6, cocina y personal de sala. */
async function escenario(t, almacen) {
  const { falso, deps } = ALMACENES[almacen]();
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  const comensal = await s.conectar(tokenComensal(5));
  await emitir(comensal, 'join:table', {});
  const pantalla = await s.conectar(tokenPantalla(5));
  const otraMesa = await s.conectar(tokenComensal(6, 'Beto'));
  await emitir(otraMesa, 'join:table', {});
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const cajero = await s.conectar(tokenPersonal('cajero'));
  return { s, falso, comensal, pantalla, otraMesa, cocina, admin, mesero, cajero };
}

/** Hace fallar UNA vez el emit de item:cancelado. */
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

/** Cuenta cuántas veces le llega el evento a un socket. */
function contar(socket) {
  const recibidos = [];
  socket.on(EVENTO, (ev) => recibidos.push(ev));
  return recibidos;
}
const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] válido: 200 y llega a cocina, sala y la mesa 5 (comensal y pantalla), no a la mesa 6`, async (t) => {
    const e = await escenario(t, almacen);
    const llegan = [e.cocina, e.admin, e.mesero, e.cajero, e.comensal, e.pantalla].map((c) => esperar(c, EVENTO, 1000));
    const nada = esperar(e.otraMesa, EVENTO, 400);
    const cuerpo = aviso();
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
    for (const ev of await Promise.all(llegan)) {
      assert.ok(ev, 'cocina, sala y la mesa 5 deben recibirlo');
      assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS_EVENTO);
      const { emitidoEn, ...resto } = ev;
      const { id_plato, ...esperado } = cuerpo;
      assert.deepStrictEqual(resto, esperado);
      assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
    }
    assert.strictEqual(await nada, null, 'la mesa 6 no lo recibe');
  });

  test(`[${almacen}] el admin (en room:kds y room:admin) lo recibe una sola vez`, async (t) => {
    const e = await escenario(t, almacen);
    const recibidos = contar(e.admin);
    assert.strictEqual((await avisar(e.s, aviso())).status, 200);
    await pausa(300);
    assert.strictEqual(recibidos.length, 1);
  });

  test(`[${almacen}] última línea: total 0, estado_pedido 'cancelado' y comensal / codigo_pedido null`, async (t) => {
    const e = await escenario(t, almacen);
    const llega = esperar(e.cajero, EVENTO, 1000);
    const r = await avisar(e.s, aviso({ total: 0, estado_pedido: 'cancelado', comensal: null, codigo_pedido: null }));
    assert.strictEqual(r.status, 200);
    const ev = await llega;
    assert.deepStrictEqual([ev.total, ev.estado_pedido, ev.comensal, ev.codigo_pedido], [0, 'cancelado', null, null]);
  });

  test(`[${almacen}] total con decimales y en el máximo de DECIMAL(10,2)`, async (t) => {
    const e = await escenario(t, almacen);
    for (const total of [18000.5, 99999999.99]) {
      const llega = esperar(e.admin, EVENTO, 1000);
      assert.strictEqual((await avisar(e.s, aviso({ total }))).status, 200);
      assert.strictEqual((await llega).total, total);
    }
  });

  test(`[${almacen}] duplicado: el mismo eventId responde duplicado:true y no se reemite`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = aviso();
    const recibidos = contar(e.cocina);
    assert.deepStrictEqual(await (await avisar(e.s, cuerpo)).json(), { ok: true, duplicado: false });
    const r = await avisar(e.s, { ...cuerpo, total: 0 });
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: true }]);
    await pausa(300);
    assert.strictEqual(recibidos.length, 1);
    if (e.falso) assert.ok(e.falso.llaves().includes(`sd:idem:backend:item-cancelado:${cuerpo.eventId}`));
  });

  test(`[${almacen}] la clave es propia: el mismo eventId en otra ruta interna no la bloquea`, async (t) => {
    const e = await escenario(t, almacen);
    const eventId = randomUUID();
    const r1 = await fetch(`${e.s.url}/internal/order-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
      body: JSON.stringify({ id_pedido: 42, id_mesa: 5, estado: 'cancelado', eventId }),
    });
    assert.strictEqual(r1.status, 200);
    const llega = esperar(e.cocina, EVENTO, 1000);
    const r2 = await avisar(e.s, aviso({ eventId }));
    assert.deepStrictEqual(await r2.json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });

  test(`[${almacen}] si la emisión falla: 500 ERROR_INTERNO, se libera el eventId y el reintento sale`, async (t) => {
    const e = await escenario(t, almacen);
    fallarEmisionUnaVez(t, e.s);
    const cuerpo = aviso();
    const r1 = await avisar(e.s, cuerpo);
    assert.strictEqual(r1.status, 500);
    assert.strictEqual((await r1.json()).codigo, 'ERROR_INTERNO');
    if (e.falso) assert.ok(!e.falso.llaves().includes(`sd:idem:backend:item-cancelado:${cuerpo.eventId}`));
    const llega = esperar(e.cocina, EVENTO, 1000);
    const r2 = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r2.status, await r2.json()], [200, { ok: true, duplicado: false }]);
    assert.ok(await llega, 'el reintento con el mismo eventId debe emitir');
  });

  test(`[${almacen}] un 400 no consume el eventId: el mismo eventId corregido sí sale`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = aviso();
    const r1 = await avisar(e.s, { ...cuerpo, total: '18000.00' });
    assert.strictEqual(r1.status, 400);
    if (e.falso) assert.ok(!e.falso.llaves().includes(`sd:idem:backend:item-cancelado:${cuerpo.eventId}`));
    const llega = esperar(e.cocina, EVENTO, 1000);
    const r2 = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r2.status, await r2.json()], [200, { ok: true, duplicado: false }]);
    assert.ok(await llega);
  });
}

test('sin x-internal-key o con una clave incorrecta: 401 y no emite', async (t) => {
  const e = await escenario(t, 'memoria');
  const nada = esperar(e.cocina, EVENTO, 400);
  for (const clave of [null, 'otra-clave', `${CLAVE_INTERNA}x`, CLAVE_INTERNA.slice(0, -1)]) {
    const r = await avisar(e.s, aviso(), clave);
    assert.strictEqual(r.status, 401, `clave ${clave}`);
    assert.strictEqual((await r.json()).codigo, 'NO_AUTORIZADO');
  }
  assert.strictEqual(await nada, null);
});

test('401 antes que 400: con clave incorrecta no se valida el cuerpo', async (t) => {
  const e = await escenario(t, 'memoria');
  const r = await avisar(e.s, '{roto', 'otra-clave');
  assert.strictEqual(r.status, 401);
});

// Cada caso cambia UN campo de un cuerpo válido.
const SIN = Symbol('sin el campo');
const INVALIDOS = {
  id_pedido: [SIN, null, 0, -1, 1.5, '42', 2147483648],
  id_mesa: [SIN, null, 0, -5, 5.5, '5', 2147483648],
  id_detalle: [SIN, null, 0, 1.2, '310', 2147483648],
  id_plato: [SIN, null, 0, 3.3, '1001', 2147483648],
  codigo_pedido: [SIN, '', '   ', 42, 'x'.repeat(41)],
  nombre: [SIN, null, '', '   ', 7, 'n'.repeat(121)],
  comensal: [SIN, '', '  ', 5, 'c'.repeat(41)],
  total: [SIN, null, '18000', '18000.00', -1, 100000000, Number.NaN],
  estado_pedido: [SIN, null, '', 'pagado', 'en_preparacion', 'RECIBIDO'],
  eventId: [SIN, null, '', 'no-es-uuid', 123],
};

test('400 PAYLOAD_INVALIDO por cada campo inválido o ausente, y no emite', async (t) => {
  const e = await escenario(t, 'memoria');
  const recibidos = contar(e.cocina);
  for (const [campo, valores] of Object.entries(INVALIDOS)) {
    for (const valor of valores) {
      const cuerpo = aviso();
      if (valor === SIN) delete cuerpo[campo];
      else cuerpo[campo] = valor;
      const r = await avisar(e.s, cuerpo);
      const b = await r.json();
      const caso = `${campo} = ${valor === SIN ? '(ausente)' : JSON.stringify(valor)}`;
      assert.strictEqual(r.status, 400, caso);
      assert.strictEqual(b.codigo, 'PAYLOAD_INVALIDO', caso);
      if (valor !== SIN || campo !== 'eventId') assert.match(b.mensaje, new RegExp(campo), caso);
    }
  }
  await pausa(200);
  assert.strictEqual(recibidos.length, 0);
});

test('nombre de 120 caracteres con tildes y emoji es válido (se cuentan caracteres, no UTF-16)', async (t) => {
  const e = await escenario(t, 'memoria');
  const nombre = `${'á'.repeat(118)}🍔🍔`;
  assert.strictEqual([...nombre].length, 120);
  const llega = esperar(e.cocina, EVENTO, 1000);
  assert.strictEqual((await avisar(e.s, aviso({ nombre }))).status, 200);
  assert.strictEqual((await llega).nombre, nombre);
});

test('campos de más: 400 con el nombre del campo (no se descartan en silencio)', async (t) => {
  const e = await escenario(t, 'memoria');
  for (const extra of [{ emitidoEn: '2000-01-01T00:00:00.000Z' }, { html: '<script>' }, { estado: 'cancelado' }]) {
    const r = await avisar(e.s, aviso(extra));
    const b = await r.json();
    assert.strictEqual(r.status, 400);
    assert.strictEqual(b.codigo, 'PAYLOAD_INVALIDO');
    assert.match(b.mensaje, new RegExp(Object.keys(extra)[0]));
  }
});

test('cuerpo que no es un objeto o JSON malformado: 400', async (t) => {
  const e = await escenario(t, 'memoria');
  for (const cuerpo of ['[]', 'null', '"texto"', '42', '{roto']) {
    const r = await avisar(e.s, cuerpo);
    assert.strictEqual(r.status, 400, cuerpo);
  }
});
