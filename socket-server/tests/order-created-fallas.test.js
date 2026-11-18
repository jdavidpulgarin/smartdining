const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { emitir, esperar, tokenPersonal } = require('./helpers');
const {
  pedido, post, silencioso, pedidoDe, comensalesDe, mesaConAnaYBeto,
} = require('./order-created-helpers');

// --- Fallas a mitad de camino: el reintento termina el trabajo y el aviso
// sale UNA sola vez. En memoria se sustituye el paso por uno que lanza una vez;
// con el doble de Redis, falla el comando de Redis de ese paso. ---

/** Sustituye obj[metodo] por uno que lanza UNA vez cuando `filtro(args)` se cumple. */
function parcharUnaVez(obj, metodo, filtro = () => true) {
  const original = obj[metodo];
  obj[metodo] = async function (...args) {
    if (filtro(args)) {
      obj[metodo] = original;
      throw new Error(`Falla simulada en ${metodo}`);
    }
    return original.apply(this, args);
  };
}

const conRedisFalso = () => {
  const falso = crearRedisFalso();
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  return { falso, deps: { redis } };
};
const ALMACENES_CON_FALLA = { memoria: () => ({ falso: null, deps: {} }), redis: conRedisFalso };
const llaveEn = (args, texto) => String(args[0]).includes(texto);

// Cada punto: cómo hacerlo fallar en memoria (s) y en el doble de Redis (falso).
const PUNTOS_DE_FALLA = {
  'quitar las líneas del carrito': {
    memoria: (s) => parcharUnaVez(s.carritos, 'aplicarUnaVez'),
    redis: (falso) => falso.fallarUnaVez((nombre, [cola]) => nombre === 'exec'
      && cola.some(([, args]) => llaveEn(args, 'sd:idem:sistema:cart:'))),
  },
  'guardar los dueños': {
    memoria: (s) => parcharUnaVez(s.duenosPedidos, 'guardar'),
    redis: (falso) => falso.fallarUnaVez((nombre, args) => nombre === 'set' && llaveEn(args, ':duenos')),
  },
  'reservar el aviso (SET NX por pedido)': {
    memoria: (s) => parcharUnaVez(s.registro, 'reservar', ([k]) => k.startsWith('order:created:pedido:')),
    redis: (falso) => falso.fallarUnaVez((nombre, args) => nombre === 'set' && llaveEn(args, 'order:created:pedido:')),
  },
};

/** Cuenta lo que ven la cocina y Beto, y el orden en que le llega a Beto. */
function contar(cocina, beto) {
  const c = { kds: 0, mesa: 0, carrito: 0, orden: [] };
  cocina.on('order:created', () => { c.kds += 1; });
  beto.on('order:created', () => { c.mesa += 1; c.orden.push('order:created'); });
  // Solo los del sistema: la segunda ronda de Ana también le llega a Beto.
  beto.on('cart:updated', (ev) => { if (ev.origen === 'sistema') { c.carrito += 1; c.orden.push('cart:updated'); } });
  return c;
}

for (const [nombre, crear] of Object.entries(ALMACENES_CON_FALLA)) {
  for (const [punto, fallar] of Object.entries(PUNTOS_DE_FALLA)) {
    test(`[${nombre}] falla al ${punto}: 500, y el reintento quita las líneas y avisa una sola vez`, async (t) => {
      const { falso, deps } = crear();
      const { s, ana, beto, agregar } = await mesaConAnaYBeto(t, deps);
      const cocina = await s.conectar(tokenPersonal('cocina'));
      const c = contar(cocina, beto);
      const cuerpo = { eventId: randomUUID(), pedido: pedidoDe('Ana') };

      if (falso) fallar.redis(falso); else fallar.memoria(s);
      const r1 = await post(s, '/internal/order-created', cuerpo);
      assert.strictEqual(r1.status, 500);
      if (falso) assert.strictEqual(falso.fallaPendiente, false, 'la falla debió dispararse');

      // Reintento con el mismo eventId: completa lo que faltó.
      assert.deepStrictEqual(await (await post(s, '/internal/order-created', cuerpo)).json(),
        { ok: true, eventId: cuerpo.eventId, duplicado: false });
      await esperar(beto, 'nunca', 200);
      assert.deepStrictEqual(comensalesDe(await s.carritos.snapshot(5)), ['Beto']);
      assert.deepStrictEqual(await s.duenosPedidos.obtener(87), ['Ana']);
      assert.deepStrictEqual([c.kds, c.mesa, c.carrito], [1, 1, 1]);
      assert.deepStrictEqual(c.orden, ['cart:updated', 'order:created']);

      // Segunda ronda de Ana: ni el mismo eventId ni uno nuevo la tocan.
      const tras = await agregar(ana);
      const r3 = await (await post(s, '/internal/order-created', cuerpo)).json();
      const r4 = await (await post(s, '/internal/order-created', { ...cuerpo, eventId: randomUUID() })).json();
      assert.deepStrictEqual([r3.duplicado, r4.duplicado], [true, true]);
      await esperar(beto, 'nunca', 200);
      assert.deepStrictEqual(await s.carritos.snapshot(5), tras);
      assert.deepStrictEqual([c.kds, c.mesa, c.carrito], [1, 1, 1]);
    });
  }

  test(`[${nombre}] falla la marca del eventId tras emitir: ok; el reintento es duplicado, no reemite ni toca el carrito`, async (t) => {
    const { falso, deps } = crear();
    const { s, ana, beto, agregar } = await mesaConAnaYBeto(t, deps);
    const cocina = await s.conectar(tokenPersonal('cocina'));
    const c = contar(cocina, beto);
    const cuerpo = { eventId: randomUUID(), pedido: pedidoDe('Ana') };
    const marca = `order:created:${cuerpo.eventId}`;

    if (falso) falso.fallarUnaVez((n, args) => n === 'set' && String(args[0]) === `sd:idem:${marca}`);
    else parcharUnaVez(s.registro, 'guardar', ([k]) => k === marca);
    const r1 = await (await post(s, '/internal/order-created', cuerpo)).json();
    assert.deepStrictEqual(r1, { ok: true, eventId: cuerpo.eventId, duplicado: false }, 'la marca es secundaria: no es un error');
    if (falso) assert.strictEqual(falso.fallaPendiente, false, 'la falla debió dispararse');
    assert.strictEqual(await s.registro.obtener(marca), undefined);

    const tras = await agregar(ana);
    const r2 = await (await post(s, '/internal/order-created', cuerpo)).json();
    assert.strictEqual(r2.duplicado, true);
    await esperar(beto, 'nunca', 200);
    assert.deepStrictEqual(await s.carritos.snapshot(5), tras);
    assert.deepStrictEqual([c.kds, c.mesa, c.carrito], [1, 1, 1]);
    // El reintento dejó la marca puesta.
    assert.strictEqual(await s.registro.obtener(marca), true);
  });
}

test('[redis] por socket: ERROR_INTERNO al fallar el carrito y el reenvío del mesero lo completa', async (t) => {
  const { falso, deps } = conRedisFalso();
  const { s, beto } = await mesaConAnaYBeto(t, deps);
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const c = contar(cocina, beto);
  const cuerpo = { eventId: randomUUID(), pedido: pedidoDe('Ana') };
  falso.fallarUnaVez((nombre) => nombre === 'exec');
  assert.strictEqual((await emitir(mesero, 'order:created', cuerpo)).codigo, 'ERROR_INTERNO');
  assert.strictEqual((await emitir(mesero, 'order:created', cuerpo)).duplicado, false);
  await esperar(beto, 'nunca', 200);
  assert.deepStrictEqual(comensalesDe(await s.carritos.snapshot(5)), ['Beto']);
  assert.deepStrictEqual([c.kds, c.mesa, c.carrito], [1, 1, 1]);
});
