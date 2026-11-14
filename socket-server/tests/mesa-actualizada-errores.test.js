const test = require('node:test');
const assert = require('node:assert');
const { esperar, CLAVE_INTERNA } = require('./helpers');
const {
  EVENTO, avisar, mesa, ALMACENES, escenario, fallarEmisionUnaVez,
} = require('./mesa-actualizada-helpers');

// POST /internal/mesa-actualizada → mesa:actualizada solo a room:admin (EVENTS.md §5.7).
// Errores: clave, 400 por campo (sin consumir el eventId), emisión fallida,
// sin configurar, Redis caído y el evento desde un cliente.

// [campo, valores inválidos]. undefined = el campo no viene.
const INVALIDOS = [
  ['eventId', [undefined, null, '', 'no-es-uuid', 12]],
  ['id_mesa', [undefined, null, 0, -1, 1.5, '5', 2147483648]],
  ['numero', [undefined, null, 0, -3, 2.5, '5']],
  ['capacidad', [undefined, null, 0, -4, 4.5, '4']],
  ['estado', [undefined, null, '', 'libre', 'OCUPADA', 1]],
  ['ubicacion', [undefined, null, '', '   ', 'x'.repeat(51), 7]],
  ['activa', [null, 'true', 1, 0]],
  ['motivo', [null, '', 'otro', 'ABIERTA', 3]],
  ['id_mesero', [0, -1, 1.5, '9', false]],
];

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] sin clave o con clave errónea: 401 NO_AUTORIZADO, sin emitir ni consumir el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const cuerpo = mesa();
    const nada = esperar(e.admin, EVENTO, 400);
    for (const clave of [null, 'otra', `${CLAVE_INTERNA}x`, CLAVE_INTERNA.slice(0, -1)]) {
      const r = await avisar(e.s, cuerpo, clave);
      assert.strictEqual(r.status, 401);
      assert.strictEqual((await r.json()).codigo, 'NO_AUTORIZADO');
    }
    assert.strictEqual(await nada, null);
    assert.strictEqual((await (await avisar(e.s, cuerpo)).json()).duplicado, false);
  });

  test(`[${almacen}] 400 PAYLOAD_INVALIDO por campo, sin emitir y sin consumir el eventId`, async (t) => {
    const e = await escenario(t, almacen);
    const base = mesa();
    const nada = esperar(e.admin, EVENTO, 400);
    for (const [campo, valores] of INVALIDOS) {
      for (const valor of valores) {
        const cuerpo = { ...base, [campo]: valor };
        if (valor === undefined) delete cuerpo[campo];
        const r = await avisar(e.s, cuerpo);
        const etiqueta = `${campo}=${JSON.stringify(valor)}`;
        assert.strictEqual(r.status, 400, etiqueta);
        const json = await r.json();
        assert.strictEqual(json.codigo, 'PAYLOAD_INVALIDO', etiqueta);
        assert.match(json.mensaje, new RegExp(campo), etiqueta);
      }
    }
    assert.strictEqual(await nada, null);
    // Ningún 400 consumió el eventId: el cuerpo válido sigue emitiéndose.
    const llega = esperar(e.admin, EVENTO, 1000);
    assert.deepStrictEqual(await (await avisar(e.s, base)).json(), { ok: true, duplicado: false });
    assert.ok(await llega);
  });

  test(`[${almacen}] emisión que falla: 500 ERROR_INTERNO, se libera la clave y el reintento emite`, async (t) => {
    const e = await escenario(t, almacen);
    fallarEmisionUnaVez(t, e.s);
    const cuerpo = mesa();
    const nada = esperar(e.admin, EVENTO, 300);
    const r = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [500, 'ERROR_INTERNO']);
    assert.strictEqual(await nada, null);
    if (e.falso) assert.ok(!e.falso.llaves().includes(`sd:idem:backend:mesa-actualizada:${cuerpo.eventId}`), 'la clave se liberó');
    const llega = esperar(e.admin, EVENTO, 1000);
    const reintento = await avisar(e.s, cuerpo);
    assert.deepStrictEqual([reintento.status, await reintento.json()], [200, { ok: true, duplicado: false }]);
    assert.strictEqual((await llega).eventId, cuerpo.eventId);
  });
}

test('sin INTERNAL_API_KEY configurada: 503 NO_CONFIGURADO y no se emite', async (t) => {
  const e = await escenario(t, 'memoria');
  e.s.config.internalApiKey = undefined;
  const nada = esperar(e.admin, EVENTO, 400);
  const r = await avisar(e.s, mesa());
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [503, 'NO_CONFIGURADO']);
  assert.strictEqual(await nada, null);
});

test('con Redis caído: 500 ERROR_INTERNO sin emitir; al volver, el mismo eventId se emite', async (t) => {
  const e = await escenario(t, 'redis');
  const cuerpo = mesa();
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

test('ni un comensal ni la pantalla pueden emitirlo por socket (no existe como evento de cliente)', async (t) => {
  const e = await escenario(t, 'memoria');
  const nada = esperar(e.admin, EVENTO, 300);
  e.comensal.emit(EVENTO, mesa());
  e.pantalla.emit(EVENTO, mesa());
  assert.strictEqual(await nada, null);
});
