const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { esperar, CLAVE_INTERNA } = require('./helpers');
const {
  EVENTO, CAMPOS, avisar, mesa, ALMACENES, escenario,
} = require('./mesa-actualizada-helpers');

// POST /internal/mesa-actualizada → mesa:actualizada solo a room:admin (EVENTS.md §5.7).
// Casos válidos, campos descartados, idempotencia y JSON malformado. Los errores van en mesa-actualizada-errores.test.js.

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] válido: 200 y llega solo a room:admin (admin, mesero, cajero), no a mesas, pantalla ni cocina`, async (t) => {
    const e = await escenario(t, almacen);
    const llegan = [e.admin, e.mesero, e.cajero].map((c) => esperar(c, EVENTO, 1000));
    const nada = [e.comensal, e.pantalla, e.cocina].map((c) => esperar(c, EVENTO, 400));
    const cuerpo = mesa();
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
    for (const ev of await Promise.all(llegan)) {
      assert.ok(ev, 'el personal de sala debe recibirlo');
      assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS);
      const { emitidoEn, ...resto } = ev;
      assert.deepStrictEqual(resto, cuerpo);
      assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
    }
    assert.deepStrictEqual(await Promise.all(nada), [null, null, null], 'mesas, pantalla y cocina no lo reciben');
  });

  test(`[${almacen}] seguridad: token_qr, datos de comensales y campos extra se descartan; emitidoEn lo pone el servidor`, async (t) => {
    const e = await escenario(t, almacen);
    const llega = esperar(e.admin, EVENTO, 1000);
    const r = await avisar(e.s, mesa({
      token_qr: 'TOKEN-QR-SECRETO',
      sesion_iniciada_en: '2026-11-13T10:00:00.000Z',
      comensales: [{ alias: 'Ana' }],
      version_control: 7,
      emitidoEn: '2000-01-01T00:00:00.000Z',
      html: '<script>',
    }));
    assert.strictEqual(r.status, 200);
    const ev = await llega;
    assert.deepStrictEqual(Object.keys(ev).sort(), CAMPOS);
    assert.ok(!JSON.stringify(ev).includes('TOKEN-QR-SECRETO'), 'el token QR nunca viaja');
    assert.ok(!JSON.stringify(ev).includes('Ana'), 'ningún dato de comensales');
    assert.notStrictEqual(ev.emitidoEn, '2000-01-01T00:00:00.000Z');
  });

  test(`[${almacen}] opcionales: activa, motivo e id_mesero viajan solo si vienen (id_mesero admite null)`, async (t) => {
    const e = await escenario(t, almacen);
    for (const extra of [
      { activa: false, motivo: 'estado' },
      { motivo: 'mesero', id_mesero: 9 },
      { motivo: 'mesero', id_mesero: null },
      { activa: true, motivo: 'abierta' },
      { motivo: 'creada' },
      { motivo: 'datos', estado: 'mantenimiento' },
    ]) {
      const llega = esperar(e.admin, EVENTO, 1000);
      const cuerpo = mesa(extra);
      assert.strictEqual((await avisar(e.s, cuerpo)).status, 200, JSON.stringify(extra));
      const { emitidoEn, ...resto } = await llega;
      assert.deepStrictEqual(resto, cuerpo, JSON.stringify(extra));
    }
  });

  test(`[${almacen}] duplicado: el mismo eventId responde duplicado:true y no se reemite`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = mesa();
    const primero = esperar(e.admin, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, cuerpo)).json(), { ok: true, duplicado: false });
    assert.ok(await primero);
    const segundo = esperar(e.admin, EVENTO, 400);
    const r = await avisar(e.s, { ...cuerpo, estado: 'disponible' });
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: true }]);
    assert.strictEqual(await segundo, null);
    if (e.falso) assert.ok(e.falso.llaves().includes(`sd:idem:backend:mesa-actualizada:${cuerpo.eventId}`));
  });

  test(`[${almacen}] la clave de idempotencia es propia: el mismo eventId en plato-disponibilidad no la bloquea`, async (t) => {
    const e = await escenario(t, almacen);
    const eventId = randomUUID();
    const plato = await fetch(`${e.s.url}/internal/plato-disponibilidad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
      body: JSON.stringify({ id_plato: 3, disponible: false, eventId }),
    });
    assert.strictEqual(plato.status, 200);
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, mesa({ eventId }))).json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });

  test(`[${almacen}] JSON malformado o que no es objeto: 400 JSON_INVALIDO sin emitir`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = esperar(e.admin, EVENTO, 400);
    for (const cuerpo of ['{"id_mesa": 1,', '[1,2]', '"texto"', 'null', '12']) {
      const r = await avisar(e.s, cuerpo);
      assert.strictEqual(r.status, 400, cuerpo);
      assert.strictEqual((await r.json()).codigo, 'JSON_INVALIDO', cuerpo);
    }
    assert.strictEqual(await nada, null);
  });
}
