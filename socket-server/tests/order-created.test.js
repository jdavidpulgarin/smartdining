const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { exigirClaveInterna } = require('../src/http');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA } = require('./helpers');

const CLAVE = CLAVE_INTERNA;
const pedido = (id_pedido = 87, id_mesa = 5) => ({
  id_pedido, codigo_pedido: `PED-${id_pedido}`, id_mesa, estado: 'recibido', total: 56000, items: [{ id_plato: 3, cantidad: 2 }],
});
const post = (s, ruta, cuerpo, clave = CLAVE) => fetch(`${s.url}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

async function escenario() {
  const s = await levantar({});
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', {});
  await emitir(mesa6, 'join:table', {});
  return { s, cocina, admin, mesero, mesa5, mesa6 };
}

test('HTTP interno: difunde a KDS, Admin y a la mesa; no a otras mesas', async () => {
  const { s, cocina, admin, mesa5, mesa6 } = await escenario();
  const esperas = [esperar(cocina, 'order:created'), esperar(admin, 'order:created'), esperar(mesa5, 'order:created'), esperar(mesa6, 'order:created')];
  const eventId = randomUUID();
  const r = await post(s, '/internal/order-created', { eventId, pedido: pedido() });
  assert.deepStrictEqual(await r.json(), { ok: true, eventId, duplicado: false });
  const [kds, adm, m5, m6] = await Promise.all(esperas);
  assert.strictEqual(kds.pedido.codigo_pedido, 'PED-87');
  assert.ok(adm && m5 && kds.emitidoEn);
  assert.strictEqual(m6, null, 'otra mesa no debe enterarse');
  await s.cerrar();
});

test('idempotencia: mismo eventId, o mismo pedido con otro eventId, no se difunde dos veces', async () => {
  const { s, cocina } = await escenario();
  const eventId = randomUUID();
  await post(s, '/internal/order-created', { eventId, pedido: pedido() });
  const otra = esperar(cocina, 'order:created', 300);
  const r1 = await (await post(s, '/internal/order-created', { eventId, pedido: pedido() })).json();
  const r2 = await (await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedido() })).json();
  assert.deepStrictEqual([r1.duplicado, r2.duplicado], [true, true]);
  assert.strictEqual(await otra, null);
  await s.cerrar();
});

test('un admin conectado a KDS y Admin recibe la comanda una sola vez', async () => {
  const { s, admin } = await escenario();
  let veces = 0;
  admin.on('order:created', () => { veces += 1; });
  await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedido() });
  await esperar(admin, 'nunca', 300);
  assert.strictEqual(veces, 1);
  await s.cerrar();
});

test('HTTP interno exige la clave; sin clave configurada queda cerrado', async (t) => {
  const { s } = await escenario();
  // Se cierra aunque falle una aserción: un servidor abierto cuelga node --test.
  t.after(() => s.cerrar());
  const cuerpo = { eventId: randomUUID(), pedido: pedido() };
  assert.strictEqual((await post(s, '/internal/order-created', cuerpo, null)).status, 401);
  assert.strictEqual((await post(s, '/internal/order-created', cuerpo, 'mala')).status, 401);
  assert.strictEqual((await post(s, '/internal/order-created', '{no es json', CLAVE)).status, 400);
  assert.strictEqual((await post(s, '/internal/order-created', { eventId: 'x', pedido: pedido() })).status, 400);
  assert.strictEqual((await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: { ...pedido(), estado: 'raro' } })).status, 400);

  // El arranque ya exige INTERNAL_API_KEY (secretos.js), pero la guarda sigue:
  // si algún día la configuración llega sin clave, /internal/* queda cerrado.
  assert.throws(() => exigirClaveInterna({ headers: {} }, { internalApiKey: null }), (e) => e.status === 503);
});

test('por socket: mesero y admin pueden emitir; comensal y cocina no', async () => {
  const { s, cocina, mesero, mesa5 } = await escenario();
  const llega = esperar(cocina, 'order:created');
  const ack = await emitir(mesero, 'order:created', { eventId: randomUUID(), pedido: pedido(90) });
  assert.strictEqual(ack.ok, true);
  assert.strictEqual((await llega).pedido.id_pedido, 90);
  const falso = await emitir(mesa5, 'order:created', { eventId: randomUUID(), pedido: pedido(91) });
  assert.strictEqual(falso.codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await emitir(cocina, 'order:created', { eventId: randomUUID(), pedido: pedido(92) })).codigo, 'NO_AUTORIZADO');
  await s.cerrar();
});

// --- Carrito al crear la comanda: se quitan SOLO las líneas de quien pidió. ---
// Cada prueba corre con el almacén en memoria y con el doble de Redis.
const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({}),
  redis: () => ({
    redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso }),
  }),
};
// Como lo manda el backend: cada ítem con el alias (del JWT) de quien lo pidió.
const pedidoDe = (...alias) => ({ ...pedido(), items: alias.map((comensal) => ({ id_plato: 3, cantidad: 1, comensal })) });
const comensalesDe = (carrito) => carrito.items.map((i) => i.comensal);

/** Mesa 5 con Ana (2 líneas) y Beto (1 línea) en el carrito. */
async function mesaConAnaYBeto(t, deps) {
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5, 'Ana'));
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(ana, 'join:table', {});
  await emitir(beto, 'join:table', {});
  const agregar = async (c) => (await emitir(c, 'cart:update', {
    eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), id_plato: 3, cantidad: 1,
  })).carrito;
  await agregar(ana);
  await agregar(ana);
  const antes = await agregar(beto);
  return { s, ana, beto, antes, agregar };
}

for (const [nombre, deps] of Object.entries(ALMACENES)) {
  test(`[${nombre}] llega el pedido de Ana: quedan solo las líneas de Beto, sube la versión y se avisa`, async (t) => {
    const { s, beto, antes } = await mesaConAnaYBeto(t, deps());
    assert.deepStrictEqual(comensalesDe(antes), ['Ana', 'Ana', 'Beto']);
    const aviso = esperar(beto, 'cart:updated');
    const eventId = randomUUID();
    await post(s, '/internal/order-created', { eventId, pedido: pedidoDe('Ana', 'Ana') });
    const ev = await aviso;
    assert.strictEqual(ev.origen, 'sistema');
    assert.strictEqual(ev.eventId, eventId);
    assert.deepStrictEqual(comensalesDe(ev.carrito), ['Beto']);
    assert.strictEqual(ev.carrito.version, antes.version + 1);
    assert.deepStrictEqual(await s.carritos.snapshot(5), ev.carrito);
  });

  test(`[${nombre}] pedido sin comensal (personal): el carrito queda igual y no se emite cart:updated`, async (t) => {
    const { s, beto, antes } = await mesaConAnaYBeto(t, deps());
    const aviso = esperar(beto, 'cart:updated');
    // Alias vacío o de más de 40 caracteres cuenta como "sin alias".
    const sinAlias = { ...pedido(), items: [{ id_plato: 3, cantidad: 1 }, { id_plato: 4, comensal: '  ' }, { id_plato: 5, comensal: 'x'.repeat(41) }] };
    const r = await (await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: sinAlias })).json();
    assert.strictEqual(r.duplicado, false);
    assert.strictEqual(await aviso, null);
    assert.deepStrictEqual(await s.carritos.snapshot(5), antes);
    assert.deepStrictEqual(await s.duenosPedidos.obtener(87), []);
  });

  test(`[${nombre}] duenosPedidos del pedido de Ana = [Ana], aunque Beto tenga líneas`, async (t) => {
    const { s } = await mesaConAnaYBeto(t, deps());
    await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedidoDe('Ana', ' Ana ') });
    assert.deepStrictEqual(await s.duenosPedidos.obtener(87), ['Ana']);
  });

  test(`[${nombre}] un cliente no puede usar la acción interna remove_de: PAYLOAD_INVALIDO`, async (t) => {
    const { s, ana, antes } = await mesaConAnaYBeto(t, deps());
    const mesero = await s.conectar(tokenPersonal('mesero'));
    await emitir(mesero, 'join:table', { id_mesa: 5 });
    const op = { accion: 'remove_de', comensales: ['Beto'] };
    const deAna = await emitir(ana, 'cart:update', { eventId: randomUUID(), ...op });
    const delMesero = await emitir(mesero, 'cart:update', { eventId: randomUUID(), id_mesa: 5, comensal: 'Beto', ...op });
    assert.deepStrictEqual([deAna.codigo, delMesero.codigo], ['PAYLOAD_INVALIDO', 'PAYLOAD_INVALIDO']);
    assert.deepStrictEqual(await s.carritos.snapshot(5), antes);
  });

  test(`[${nombre}] pedido repetido (mismo eventId): no quita nada dos veces`, async (t) => {
    const { s, ana, beto, agregar } = await mesaConAnaYBeto(t, deps());
    const cuerpo = { eventId: randomUUID(), pedido: pedidoDe('Ana') };
    await post(s, '/internal/order-created', cuerpo);
    // Ana empieza su segunda ronda antes de que llegue el reintento.
    const tras = await agregar(ana);
    assert.deepStrictEqual(comensalesDe(tras), ['Beto', 'Ana']);
    const aviso = esperar(beto, 'cart:updated');
    const r = await (await post(s, '/internal/order-created', cuerpo)).json();
    assert.strictEqual(r.duplicado, true);
    assert.strictEqual(await aviso, null);
    assert.deepStrictEqual(await s.carritos.snapshot(5), tras);
  });
}

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
