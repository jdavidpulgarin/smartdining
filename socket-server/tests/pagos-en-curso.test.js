const test = require('node:test');
const assert = require('node:assert');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { levantar, CLAVE_INTERNA } = require('./helpers');

// T4: GET /internal/pagos-en-curso (EVENTS.md §6.6). El backend la consulta
// antes de cancelar un plato: no se quita una línea que alguien está pagando.

const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({ falso: null, deps: {} }),
  'Redis falso': () => {
    const falso = crearRedisFalso();
    return { falso, deps: { redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso }) } };
  },
};

const MIN = 60 * 1000;
let contador = 0;

/** Una intención como la deja POST /pagos/intencion: el registro y la marca de pendiente. */
async function intencion(s, {
  mesa = 5, comensal = 'Ana', modo = 'propio', montoCentavos = 2500000, estado = 'pendiente', venceEnMs = 25 * MIN, marcaSeg = 1800,
} = {}) {
  contador += 1;
  const referencia = `SD-${mesa}-${Date.now()}-prueba${contador}`;
  await s.almacenPagos.guardarIntencion(referencia, {
    id_mesa: mesa,
    comensal,
    modo,
    monto_centavos: montoCentavos,
    estado,
    creada_en: new Date().toISOString(),
    expira_en: new Date(Date.now() + venceEnMs).toISOString(),
  }, 26 * 3600);
  await s.almacenPagos.reservarPendiente(mesa, comensal, referencia, marcaSeg);
  return referencia;
}

const consultar = (s, query, clave = CLAVE_INTERNA) => fetch(`${s.url}/internal/pagos-en-curso${query}`, {
  headers: clave ? { 'x-internal-key': clave } : {},
});
const json = async (s, query) => {
  const r = await consultar(s, query);
  assert.strictEqual(r.status, 200, query);
  return r.json();
};

for (const [nombre, crear] of Object.entries(ALMACENES)) {
  const escenario = async (t) => {
    const { deps } = crear();
    const s = await levantar({}, deps);
    t.after(() => s.cerrar());
    return s;
  };

  test(`[${nombre}] sin intenciones: enCurso false, con y sin comensal`, async (t) => {
    const s = await escenario(t);
    assert.deepStrictEqual(await json(s, '?mesa=5'), { mesa: 5, enCurso: false, pagos: [] });
    assert.deepStrictEqual(await json(s, '?mesa=5&comensal=Ana'), { mesa: 5, enCurso: false, pagos: [] });
  });

  test(`[${nombre}] 'propio' de ese comensal: bloquea; la forma de la respuesta no lleva referencia ni tokens`, async (t) => {
    const s = await escenario(t);
    const ref = await intencion(s, { comensal: 'Ana', modo: 'propio', montoCentavos: 2500000 });
    const r = await json(s, '?mesa=5&comensal=Ana');
    assert.strictEqual(r.enCurso, true);
    assert.strictEqual(r.pagos.length, 1);
    const [p] = r.pagos;
    assert.deepStrictEqual(Object.keys(p).sort(), ['comensal', 'modo', 'monto', 'venceEn']);
    assert.deepStrictEqual([p.comensal, p.modo, p.monto], ['Ana', 'propio', 25000]);
    assert.ok(Date.parse(p.venceEn) > Date.now());
    assert.ok(!JSON.stringify(r).includes(ref), 'la referencia de Wompi nunca sale');
  });

  test(`[${nombre}] el comensal se compara por la clave del alias («Ána» = «ana» = «ANA »)`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Ána María', modo: 'propio' });
    for (const q of ['ana%20maria', 'ANA%20MARIA', 'Ana_Maria', ' anamaría ']) {
      assert.strictEqual((await json(s, `?mesa=5&comensal=${encodeURIComponent(decodeURIComponent(q))}`)).enCurso, true, q);
    }
  });

  test(`[${nombre}] 'propio' de OTRO comensal: no bloquea a este (sí cuenta sin comensal)`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Beto', modo: 'propio' });
    assert.deepStrictEqual(await json(s, '?mesa=5&comensal=Ana'), { mesa: 5, enCurso: false, pagos: [] });
    const todos = await json(s, '?mesa=5');
    assert.strictEqual(todos.enCurso, true);
    assert.deepStrictEqual(todos.pagos.map((p) => p.comensal), ['Beto']);
  });

  test(`[${nombre}] 'total' de otro comensal: SÍ bloquea (cubre todas las líneas)`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Beto', modo: 'total', montoCentavos: 9000000 });
    await intencion(s, { comensal: 'Caro', modo: 'propio' });
    const r = await json(s, '?mesa=5&comensal=Ana');
    assert.strictEqual(r.enCurso, true);
    assert.deepStrictEqual(r.pagos.map((p) => [p.comensal, p.modo, p.monto]), [['Beto', 'total', 90000]], 'solo las que deciden');
  });

  test(`[${nombre}] 'igual' (Dividir, que T2 retira) cuenta como de toda la mesa`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Beto', modo: 'igual' });
    assert.strictEqual((await json(s, '?mesa=5&comensal=Ana')).enCurso, true);
  });

  test(`[${nombre}] intención vencida (expira_en pasado) o ya no pendiente: no cuenta`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Ana', modo: 'total', venceEnMs: -1000 });
    await intencion(s, { comensal: 'Beto', modo: 'total', estado: 'pagada' });
    await intencion(s, { comensal: 'Caro', modo: 'propio', estado: 'reemplazada' });
    assert.deepStrictEqual(await json(s, '?mesa=5'), { mesa: 5, enCurso: false, pagos: [] });
    assert.strictEqual((await json(s, '?mesa=5&comensal=Ana')).enCurso, false);
  });

  test(`[${nombre}] sin la marca de pendiente (venció o se liberó), la intención no cuenta`, async (t) => {
    const s = await escenario(t);
    const ref = await intencion(s, { comensal: 'Ana', modo: 'total' });
    await s.almacenPagos.liberarPendiente(5, 'Ana', ref);
    assert.strictEqual((await json(s, '?mesa=5')).enCurso, false);
  });

  test(`[${nombre}] cada mesa ve solo lo suyo`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { mesa: 6, comensal: 'Ana', modo: 'total' });
    await intencion(s, { mesa: 15, comensal: 'Ana', modo: 'total' });
    assert.strictEqual((await json(s, '?mesa=5&comensal=Ana')).enCurso, false);
    assert.strictEqual((await json(s, '?mesa=1')).enCurso, false, 'la mesa 1 no ve la 15');
    assert.strictEqual((await json(s, '?mesa=6')).enCurso, true);
  });

  test(`[${nombre}] 400 PAYLOAD_INVALIDO: mesa, comensal y parámetros de más o repetidos`, async (t) => {
    const s = await escenario(t);
    const casos = [
      '', '?', '?mesa=', '?mesa=0', '?mesa=-1', '?mesa=1.5', '?mesa=abc', '?mesa=05', '?mesa=2147483648', '?mesa=1e3',
      '?mesa=5&comensal=', '?mesa=5&comensal=A', `?mesa=5&comensal=${'x'.repeat(41)}`, '?mesa=5&comensal=General',
      '?mesa=5&comensal=%3Cscript%3E', '?mesa=5&comensal=...', '?mesa=5&mesa=6', '?mesa=5&comensal=Ana&comensal=Beto',
      '?mesa=5&otro=1', '?comensal=Ana',
    ];
    for (const q of casos) {
      const r = await consultar(s, q);
      assert.strictEqual(r.status, 400, q);
      assert.strictEqual((await r.json()).codigo, 'PAYLOAD_INVALIDO', q);
    }
  });

  test(`[${nombre}] 401 sin clave o con otra; 503 sin INTERNAL_API_KEY`, async (t) => {
    const s = await escenario(t);
    await intencion(s, { comensal: 'Ana', modo: 'total' });
    for (const clave of [null, 'otra', `${CLAVE_INTERNA}x`]) {
      const r = await consultar(s, '?mesa=5', clave);
      assert.strictEqual(r.status, 401);
      const cuerpo = await r.json();
      assert.strictEqual(cuerpo.codigo, 'NO_AUTORIZADO');
      assert.ok(!('pagos' in cuerpo));
    }
    s.config.internalApiKey = undefined;
    const r = await consultar(s, '?mesa=5');
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [503, 'NO_CONFIGURADO']);
  });
}

test('[Redis falso] Redis caído: 500 ERROR_INTERNO (el backend lo trata como sin_verificar y no cancela)', async (t) => {
  const { falso, deps } = ALMACENES['Redis falso']();
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  await intencion(s, { comensal: 'Ana', modo: 'total' });
  falso.caer();
  const r = await consultar(s, '?mesa=5');
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [500, 'ERROR_INTERNO']);
  falso.levantar();
  assert.strictEqual((await json(s, '?mesa=5')).enCurso, true);
});

test('[Redis falso] al reservar se anota el índice sd:pago:mesa:{mesa} junto a la marca', async (t) => {
  const { falso, deps } = ALMACENES['Redis falso']();
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  await intencion(s, { comensal: 'Ana', modo: 'propio', marcaSeg: 1800 });
  assert.ok(falso.llaves().includes('sd:pago:mesa:5'));
  assert.ok(falso.llaves().includes('sd:pago:pendiente:5:Ana'));
});

test('[Redis falso] varios comensales: el índice dura al menos lo que la marca más larga, nunca se acorta', async (t) => {
  const { falso, deps } = ALMACENES['Redis falso']();
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  const ttlIndice = () => s.redis.cliente.ttl('sd:pago:mesa:5');
  await intencion(s, { comensal: 'Ana', modo: 'propio', marcaSeg: 1800 });
  assert.ok((await ttlIndice()) > 1790, 'toma el plazo de la primera marca');
  await intencion(s, { comensal: 'Beto', modo: 'propio', marcaSeg: 60 });
  assert.ok((await ttlIndice()) > 1790, 'una marca con plazo menor no lo acorta');
  await intencion(s, { comensal: 'Caro', modo: 'propio', marcaSeg: 3600 });
  assert.ok((await ttlIndice()) > 3590, 'una marca con plazo mayor lo alarga');
  assert.ok(falso.llaves().includes('sd:pago:mesa:5'));
});

for (const [nombre, crear] of Object.entries(ALMACENES)) {
  test(`[${nombre}] un miembro del índice cuya marca ya no existe se ignora, sin romper la consulta`, async (t) => {
    const { deps } = crear();
    const s = await levantar({}, deps);
    t.after(() => s.cerrar());
    const refBeto = await intencion(s, { comensal: 'Beto', modo: 'total' });
    await intencion(s, { comensal: 'Ana', modo: 'propio' });
    await s.almacenPagos.liberarPendiente(5, 'Beto', refBeto); // Beto sigue en el índice, sin marca
    const r = await json(s, '?mesa=5');
    assert.deepStrictEqual(r.pagos.map((p) => p.comensal), ['Ana']);
    assert.strictEqual((await json(s, '?mesa=5&comensal=Caro')).enCurso, false, 'el total de Beto ya no cuenta');
  });
}
