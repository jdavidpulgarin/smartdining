const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { esperar, CLAVE_INTERNA } = require('./helpers');
const {
  EVENTO, CAMPOS, avisar, aviso, ALMACENES, escenario,
} = require('./sala-inventario-helpers');

// POST /internal/inventario-alerta → inventario:alerta solo a room:admin (EVENTS.md §5.5).
// Casos válidos, idempotencia y validación del cuerpo. Los errores van en sala-inventario-errores.test.js.

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
}
