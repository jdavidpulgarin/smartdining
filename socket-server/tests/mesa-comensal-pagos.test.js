// «Igual», cobro de caja y almacenes de sin_celular (memoria, doble de Redis y Redis real)
// (EVENTS.md §6.4 y §5.2). Utilidades en ./mesa-comensal-ayuda.js.
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearRedisFalso } = require('./redis-falso');
const { emitir, tokenComensal } = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');
const {
  silencioso, pausa, VENTANA_MS, ALMACENES, post, aviso, llamar, OK, error, comoError, escenario, presencia, nadaDePresencia, pruebasDeLaRuta,
} = require('./mesa-comensal-ayuda');

// ---------------------------------------------------------------------------
// «Igual» y cobro de caja (§8.1 y §8.6), en memoria y con el doble de Redis
// ---------------------------------------------------------------------------

async function escenarioPagos(t, almacen, total) {
  const mesa = { saldo: total };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, total, mesa.saldo) }),
  });
  const { s } = await escenario(t, almacen, {
    extraEnv: WOMPI_ENV, deps: { backend, pasarela: pasarelaFalsa({}).pasarela },
  });
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(beto, 'join:table', {});
  const igual = async (alias) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, alias)}` },
      body: JSON.stringify({ modo: 'igual', eventId: randomUUID() }),
    });
    return (await r.json()).monto_en_centavos;
  };
  return { s, mesa, igual };
}

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] «igual» con 2 conectados + 1 sin celular reparte entre 3`, async (t) => {
    const { s, igual } = await escenarioPagos(t, almacen, 9_000_000);
    assert.strictEqual(await igual('Ana'), 4_500_000, 'antes: entre Ana y Beto');
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    assert.strictEqual(await igual('Beto'), 3_000_000, 'con Abuela: entre 3');
  });

  test(`[${almacen}] caja con comensal "Abuela " marca a "Abuela" en pagaron y deja de contar en «igual»`, async (t) => {
    const { s, mesa, igual } = await escenarioPagos(t, almacen, 9_000_000);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    mesa.saldo = 6_000_000;
    const r = await post(s, '/internal/payment-confirmed', {
      eventId: randomUUID(), id_mesa: 5, comensal: 'Abuela ', monto_centavos: 3_000_000, saldo_restante_centavos: 6_000_000,
    });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), ['Abuela']);
    assert.strictEqual(await igual('Ana'), 3_000_000, 'el saldo de 60.000 entre Ana y Beto');
  });
}

test('caja con un comensal que no es alias válido: se anota tal cual y el cobro no se rompe', async (t) => {
  const { s } = await escenario(t, 'memoria');
  for (const comensal of ['Mesa #5', 'General']) {
    const r = await post(s, '/internal/payment-confirmed', {
      eventId: randomUUID(), id_mesa: 5, comensal, monto_centavos: 100, saldo_restante_centavos: 500,
    });
    assert.strictEqual(r.status, 200, comensal);
  }
  assert.deepStrictEqual(await s.estadoMesas.pagaron(5), ['General', 'Mesa #5']);
});

// ---------------------------------------------------------------------------
// Almacenes: TTL de 24 h y aislamiento por mesa
// ---------------------------------------------------------------------------

test('almacenes: sin_celular por mesa, HSETNX por clave y TTL de 24 h (memoria y Redis)', async () => {
  const reloj = { t: 1_000_000 };
  const falso = crearRedisFalso({ ahora: () => reloj.t });
  const almacenes = [crearEstadoMesasMemoria({ ahora: () => reloj.t }), crearEstadoMesasRedis({ cliente: falso.cliente })];
  for (const e of almacenes) {
    assert.strictEqual(await e.agregarSinCelular(5, 'abuela', 'Abuela'), true);
    assert.strictEqual(await e.agregarSinCelular(5, 'abuela', 'abuela'), false, 'misma clave: no se pisa');
    assert.strictEqual(await e.agregarSinCelular(6, 'abuela', 'Abuela'), true, 'otra mesa');
    assert.deepStrictEqual(await e.sinCelular(5), { abuela: 'Abuela' });
  }
  reloj.t += 24 * 60 * 60 * 1000 - 1;
  for (const e of almacenes) assert.deepStrictEqual(await e.sinCelular(5), { abuela: 'Abuela' });
  reloj.t += 2;
  for (const e of almacenes) {
    assert.deepStrictEqual(await e.sinCelular(5), {}, 'vence a las 24 h');
    assert.strictEqual(await e.quitarSinCelular(5, 'abuela'), false);
  }
});

const REDIS_URL = process.env.REDIS_URL;
test('Redis real: sin_celular con HSETNX (solo un alias por clave), TTL y limpieza', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  const { cliente } = conexion;
  const mesa = 900000 + Math.floor(Math.random() * 99999);
  t.after(async () => {
    await cliente.del(`sd:mesa:${mesa}:sin_celular`);
    await conexion.cerrar();
  });
  const e = crearEstadoMesasRedis({ cliente });
  const altas = await Promise.all(['Abuela', 'abuela', 'ABUELA'].map((a) => e.agregarSinCelular(mesa, 'abuela', a)));
  assert.strictEqual(altas.filter(Boolean).length, 1, 'solo una gana');
  assert.strictEqual(Object.keys(await e.sinCelular(mesa)).length, 1);
  const ttl = await cliente.ttl(`sd:mesa:${mesa}:sin_celular`);
  assert.ok(ttl > 24 * 60 * 60 - 60 && ttl <= 24 * 60 * 60, `TTL ${ttl}`);
  assert.strictEqual(await e.quitarSinCelular(mesa, 'abuela'), true);
  await e.agregarSinCelular(mesa, 'beto', 'Beto');
  await e.limpiarMesa(mesa);
  assert.deepStrictEqual(await e.sinCelular(mesa), {});
});
