const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { esperar } = require('./helpers');
const {
  EVENTO, avisar, mesa, ALMACENES, escenario,
} = require('./mesa-actualizada-helpers');

// mesa:actualizada (EVENTS.md §5.7): sesion_abierta y el borrado de una mesa
// (motivo 'eliminada'), pedidos para el panel.

const eliminada = (extra = {}) => ({ eventId: randomUUID(), id_mesa: 5, motivo: 'eliminada', activa: false, ...extra });

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] sesion_abierta true/false viaja tal cual; si no viene, no aparece`, async (t) => {
    const e = await escenario(t, almacen);
    for (const valor of [true, false]) {
      const llega = esperar(e.admin, EVENTO, 1000);
      const cuerpo = mesa({ sesion_abierta: valor, motivo: valor ? 'abierta' : 'liberada', estado: valor ? 'ocupada' : 'disponible' });
      assert.strictEqual((await avisar(e.s, cuerpo)).status, 200);
      assert.strictEqual((await llega).sesion_abierta, valor);
    }
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.strictEqual((await avisar(e.s, mesa())).status, 200);
    assert.ok(!('sesion_abierta' in (await llega)));
  });

  test(`[${almacen}] eliminada: basta id_mesa con activa false; sin token_qr ni campos de más`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = [e.comensal, e.pantalla, e.cocina].map((c) => esperar(c, EVENTO, 400));
    const llega = esperar(e.admin, EVENTO, 1000);
    const cuerpo = eliminada();
    const r = await avisar(e.s, { ...cuerpo, token_qr: 'TOKEN-QR-SECRETO', otro: 1 });
    assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
    const { emitidoEn, ...resto } = await llega;
    assert.deepStrictEqual(resto, cuerpo);
    assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
    assert.deepStrictEqual(await Promise.all(nada), [null, null, null]);
  });

  test(`[${almacen}] eliminada con los datos de la mesa: van y se validan igual`, async (t) => {
    const e = await escenario(t, almacen);
    const llega = esperar(e.admin, EVENTO, 1000);
    const cuerpo = mesa({ motivo: 'eliminada', activa: false, sesion_abierta: false, estado: 'disponible' });
    assert.strictEqual((await avisar(e.s, cuerpo)).status, 200);
    const { emitidoEn, ...resto } = await llega;
    assert.deepStrictEqual(resto, cuerpo);
    for (const malo of [{ numero: 0 }, { estado: 'libre' }, { ubicacion: '  ' }, { capacidad: '4' }]) {
      const r = await avisar(e.s, eliminada(malo));
      assert.strictEqual(r.status, 400, JSON.stringify(malo));
    }
  });

  test(`[${almacen}] 400 por incoherencias, sin emitir ni consumir el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const nada = esperar(e.admin, EVENTO, 400);
    const casos = [
      [mesa({ sesion_abierta: null }), /sesion_abierta/],
      [mesa({ sesion_abierta: 'true' }), /sesion_abierta/],
      [mesa({ sesion_abierta: 1 }), /sesion_abierta/],
      [eliminada({ activa: true }), /activa/],
      [eliminada({ activa: undefined }), /activa/],
      [eliminada({ sesion_abierta: true }), /sesion_abierta/],
      [mesa({ motivo: 'liberada', sesion_abierta: true }), /sesion_abierta/],
      [mesa({ motivo: 'abierta', sesion_abierta: false }), /sesion_abierta/],
      [{ eventId: randomUUID(), motivo: 'eliminada', activa: false }, /id_mesa/],
      [{ ...mesa(), numero: undefined }, /numero/],
    ];
    for (const [cuerpo, campo] of casos) {
      const r = await avisar(e.s, cuerpo);
      assert.strictEqual(r.status, 400, JSON.stringify(cuerpo));
      const json = await r.json();
      assert.strictEqual(json.codigo, 'PAYLOAD_INVALIDO');
      assert.match(json.mensaje, campo, JSON.stringify(cuerpo));
    }
    assert.strictEqual(await nada, null);
    const [primero] = casos[3];
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.strictEqual((await avisar(e.s, { ...primero, activa: false })).status, 200, 'el 400 no consumió el eventId');
    assert.ok(await llega);
  });
}
