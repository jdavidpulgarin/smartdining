const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  esperar, emitir, tokenComensal, CLAVE_INTERNA,
} = require('./helpers');
const { ALMACENES, escenario } = require('./sala-inventario-helpers');

// POST /internal/menu-actualizado → menu:actualizado a TODAS las mesas y a
// room:admin (EVENTS.md §5.8). Regresión: editar un plato no le llegaba al
// comensal hasta que recargaba la página.

const RUTA = '/internal/menu-actualizado';
const EVENTO = 'menu:actualizado';
const CAMPOS = ['accion', 'emitidoEn', 'eventId', 'id_plato'];

const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${RUTA}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const aviso = (extra = {}) => ({ eventId: randomUUID(), id_plato: 1003, accion: 'plato-editado', ...extra });

/** El escenario de sala + un comensal en OTRA mesa (la 7). */
async function conOtraMesa(t, almacen) {
  const e = await escenario(t, almacen);
  const otra = await e.s.conectar(tokenComensal(7, 'Beto'));
  await emitir(otra, 'join:table', {});
  return { ...e, otra };
}

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] válido: 200 y llega a todas las mesas (comensales y pantalla) y a room:admin, no a la cocina`, async (t) => {
    const e = await conOtraMesa(t, almacen);
    const llegan = [e.comensal, e.otra, e.pantalla, e.admin, e.mesero, e.cajero].map((c) => esperar(c, EVENTO, 1000));
    const nada = esperar(e.cocina, EVENTO, 400);
    const cuerpo = aviso();
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
    for (const ev of await Promise.all(llegan)) {
      assert.ok(ev, 'todas las mesas y el personal de sala deben recibirlo');
      assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS);
      const { emitidoEn, ...resto } = ev;
      assert.deepStrictEqual(resto, cuerpo);
      assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
    }
    assert.strictEqual(await nada, null, 'la cocina no lo recibe');
  });

  test(`[${almacen}] id_plato null (categoría o constructor) y cada acción del contrato`, async (t) => {
    const e = await escenario(t, almacen);
    for (const extra of [
      { accion: 'plato-creado' }, { accion: 'plato-eliminado' },
      { accion: 'categoria-creada', id_plato: null }, { accion: 'categoria-editada', id_plato: null },
      { accion: 'categoria-eliminada', id_plato: null },
      { accion: 'paso-creado' }, { accion: 'paso-editado', id_plato: null }, { accion: 'paso-eliminado', id_plato: null },
      { accion: 'opcion-creada', id_plato: null }, { accion: 'opcion-editada' }, { accion: 'opcion-eliminada', id_plato: null },
    ]) {
      const llega = esperar(e.comensal, EVENTO, 1000);
      const cuerpo = aviso(extra);
      assert.strictEqual((await avisar(e.s, cuerpo)).status, 200, JSON.stringify(extra));
      const { emitidoEn, ...resto } = await llega;
      assert.deepStrictEqual(resto, cuerpo, JSON.stringify(extra));
    }
  });

  test(`[${almacen}] duplicado: el mismo eventId responde duplicado:true y no se reemite`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = aviso();
    const primero = esperar(e.comensal, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, cuerpo)).json(), { ok: true, duplicado: false });
    assert.ok(await primero);
    const segundo = esperar(e.comensal, EVENTO, 400);
    const r = await avisar(e.s, { ...cuerpo, accion: 'plato-eliminado' });
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: true }]);
    assert.strictEqual(await segundo, null);
    if (e.falso) assert.ok(e.falso.llaves().includes(`sd:idem:backend:menu-actualizado:${cuerpo.eventId}`));
  });

  test(`[${almacen}] estricto: 400 PAYLOAD_INVALIDO sin emitir y sin consumir el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = esperar(e.comensal, EVENTO, 500);
    const eventId = randomUUID();
    const malos = [
      [{ eventId: 'no-uuid', id_plato: 1, accion: 'plato-editado' }, /eventId/],
      [{ id_plato: 1, accion: 'plato-editado' }, /eventId/],
      [{ eventId, accion: 'plato-editado' }, /id_plato/],
      [{ eventId, id_plato: 0, accion: 'opcion-editada' }, /id_plato/],
      [{ eventId, id_plato: '1003', accion: 'opcion-editada' }, /id_plato/],
      [{ eventId, id_plato: 2147483648, accion: 'opcion-editada' }, /id_plato/],
      [{ eventId, id_plato: 1.5, accion: 'opcion-editada' }, /id_plato/],
      [{ eventId, id_plato: 1 }, /accion/],
      [{ eventId, id_plato: 1, accion: 'borrado' }, /accion/],
      [{ eventId, id_plato: null, accion: 'plato-editado' }, /id_plato es obligatorio/],
      [{ eventId, id_plato: 3, accion: 'categoria-editada' }, /id_plato debe ser null/],
      [{ eventId, id_plato: 1, accion: 'plato-editado', nombre: 'Arepa' }, /campos no permitidos: nombre/],
      [{ eventId, id_plato: 1, accion: 'plato-editado', emitidoEn: '2000-01-01T00:00:00Z' }, /emitidoEn/],
    ]
    for (const [cuerpo, mensaje] of malos) {
      const r = await avisar(e.s, cuerpo);
      const json = await r.json();
      assert.deepStrictEqual([r.status, json.codigo], [400, 'PAYLOAD_INVALIDO'], JSON.stringify(cuerpo));
      assert.match(json.mensaje, mensaje, JSON.stringify(cuerpo));
    }
    assert.strictEqual(await nada, null, 'ningún 400 emite');
    // Los 4xx no consumieron el eventId: el bueno con el mismo id sale.
    const llega = esperar(e.comensal, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, { eventId, id_plato: 1, accion: 'plato-editado' })).json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });

  test(`[${almacen}] JSON malformado o que no es objeto: 400 JSON_INVALIDO; sin clave o con otra: 401`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = esperar(e.comensal, EVENTO, 400);
    for (const cuerpo of ['{"id_plato": 1,', '[1,2]', '"texto"', 'null', '12']) {
      const r = await avisar(e.s, cuerpo);
      assert.strictEqual(r.status, 400, cuerpo);
      assert.strictEqual((await r.json()).codigo, 'JSON_INVALIDO', cuerpo);
    }
    for (const clave of [null, 'otra-clave']) {
      const r = await avisar(e.s, aviso(), clave);
      assert.deepStrictEqual([r.status, (await r.json()).codigo], [401, 'NO_AUTORIZADO']);
    }
    assert.strictEqual(await nada, null);
  });

  test(`[${almacen}] si la emisión falla: 500 ERROR_INTERNO y el reintento con el mismo eventId sí sale`, async (t) => {
    const e = await escenario(t, almacen);
    const proto = Object.getPrototypeOf(e.s.io.to('room:ninguna'));
    const original = proto.emit;
    let pendiente = true;
    proto.emit = function emit(evento, ...args) {
      if (evento === EVENTO && pendiente) { pendiente = false; throw new Error('falla simulada al emitir'); }
      return original.call(this, evento, ...args);
    };
    t.after(() => { proto.emit = original; });
    const cuerpo = aviso();
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [500, 'ERROR_INTERNO']);
    const llega = esperar(e.comensal, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, cuerpo)).json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });
}

test('sin mesas abiertas llega igual a room:admin', async (t) => {
  const { levantar, tokenPersonal } = require('./helpers');
  const s = await levantar();
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('admin'));
  const llega = esperar(admin, EVENTO, 1000);
  assert.strictEqual((await avisar(s, aviso())).status, 200);
  assert.ok(await llega);
});

test('ningún cliente puede emitirlo por socket', async (t) => {
  const { levantar } = require('./helpers');
  const s = await levantar();
  t.after(() => s.cerrar());
  const a = await s.conectar(tokenComensal(5));
  await emitir(a, 'join:table', {});
  const b = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(b, 'join:table', {});
  const nada = esperar(b, EVENTO, 400);
  a.emit(EVENTO, aviso());
  assert.strictEqual(await nada, null);
});
