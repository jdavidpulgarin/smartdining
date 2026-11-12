const test = require('node:test');
const assert = require('node:assert');
const { esperar, CLAVE_INTERNA } = require('./helpers');
const {
  EVENTO, avisar, aviso, ALMACENES, escenario, fallarEmisionUnaVez,
} = require('./sala-inventario-helpers');

// POST /internal/inventario-alerta → inventario:alerta solo a room:admin (EVENTS.md §5.5).
// Errores: JSON, clave, emisión fallida, sin configurar, Redis caído y el evento desde un cliente.

for (const almacen of Object.keys(ALMACENES)) {
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
