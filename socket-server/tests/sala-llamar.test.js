const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal, tokenPantalla } = require('./helpers');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');
const { crearRedisFalso } = require('./redis-falso');

async function escenario(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const mesero = await s.conectar(tokenPersonal('mesero'));
  return { s, ana, mesero };
}

test('llamar al mesero llega al panel con id_mesa del JWT y emitidoEn', async (t) => {
  const { ana, mesero } = await escenario(t);
  const llega = esperar(mesero, 'mesa:llamar_mesero');
  const eventId = randomUUID();
  const ack = await emitir(ana, 'mesa:llamar_mesero', { eventId, motivo: '  Más servilletas ', id_mesa: 99 });
  assert.deepStrictEqual([ack.ok, ack.duplicado], [true, false]);
  const ev = await llega;
  assert.strictEqual(ev.id_mesa, 5, 'la mesa sale del JWT, no del payload');
  assert.strictEqual(ev.motivo, 'Más servilletas');
  assert.strictEqual(ev.eventId, eventId);
  assert.ok(!Number.isNaN(Date.parse(ev.emitidoEn)));
});

test('rol incorrecto: personal, pantalla y cocina no pueden llamar', async (t) => {
  const { s } = await escenario(t);
  for (const token of [tokenPersonal('mesero'), tokenPersonal('cocina'), tokenPantalla(5)]) {
    const c = await s.conectar(token);
    const ack = await emitir(c, 'mesa:llamar_mesero', { eventId: randomUUID() });
    assert.strictEqual(ack.codigo, 'NO_AUTORIZADO');
  }
});

test('payload inválido: eventId, motivo largo o no texto; y sin join:table', async (t) => {
  const { s, ana } = await escenario(t);
  assert.strictEqual((await emitir(ana, 'mesa:llamar_mesero', { eventId: 'x' })).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'mesa:llamar_mesero', { eventId: randomUUID(), motivo: 'x'.repeat(101) })).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'mesa:llamar_mesero', { eventId: randomUUID(), motivo: 5 })).codigo, 'PAYLOAD_INVALIDO');
  const fuera = await s.conectar(tokenComensal(6));
  assert.strictEqual((await emitir(fuera, 'mesa:llamar_mesero', { eventId: randomUUID() })).codigo, 'SIN_SALA');
});

test('límite: 1 llamada por mesa cada 60 s (aunque llame otro comensal de la mesa)', async (t) => {
  const { s, ana, mesero } = await escenario(t);
  const beto = await s.conectar(tokenComensal(5));
  await emitir(beto, 'join:table', {});
  assert.strictEqual((await emitir(ana, 'mesa:llamar_mesero', { eventId: randomUUID() })).ok, true);
  const nada = esperar(mesero, 'mesa:llamar_mesero', 300);
  const segunda = await emitir(beto, 'mesa:llamar_mesero', { eventId: randomUUID() });
  assert.strictEqual(segunda.codigo, 'RATE_LIMIT');
  assert.strictEqual(await nada, null, 'el panel no recibe la segunda');
});

test('duplicado: reenviar el mismo eventId no reenvía ni choca con el límite', async (t) => {
  const { ana, mesero } = await escenario(t);
  const eventId = randomUUID();
  const primera = esperar(mesero, 'mesa:llamar_mesero');
  await emitir(ana, 'mesa:llamar_mesero', { eventId });
  await primera;
  const repetida = esperar(mesero, 'mesa:llamar_mesero', 300);
  const ack = await emitir(ana, 'mesa:llamar_mesero', { eventId });
  assert.deepStrictEqual([ack.ok, ack.duplicado], [true, true]);
  assert.strictEqual(await repetida, null);
});

test('aislamiento: el límite y el aviso son por mesa; los comensales no reciben la llamada', async (t) => {
  const { s, ana } = await escenario(t);
  const otra = await s.conectar(tokenComensal(6));
  await emitir(otra, 'join:table', {});
  const companero = await s.conectar(tokenComensal(5));
  await emitir(companero, 'join:table', {});
  const enMesa = esperar(companero, 'mesa:llamar_mesero', 300);
  assert.strictEqual((await emitir(ana, 'mesa:llamar_mesero', { eventId: randomUUID() })).ok, true);
  assert.strictEqual((await emitir(otra, 'mesa:llamar_mesero', { eventId: randomUUID() })).ok, true, 'otra mesa tiene su propio límite');
  assert.strictEqual(await enMesa, null);
});

test('el límite vence a los 60 s (memoria y Redis)', async () => {
  const reloj = { t: 0 };
  const mem = crearEstadoMesasMemoria({ ahora: () => reloj.t });
  const falso = crearRedisFalso({ ahora: () => reloj.t });
  const red = crearEstadoMesasRedis({ cliente: falso.cliente });
  for (const estado of [mem, red]) {
    assert.strictEqual(await estado.reservarLlamada(5, 60), true);
    assert.strictEqual(await estado.reservarLlamada(5, 60), false);
    assert.strictEqual(await estado.reservarLlamada(6, 60), true);
  }
  reloj.t += 60_001;
  assert.strictEqual(await mem.reservarLlamada(5, 60), true);
  assert.strictEqual(await red.reservarLlamada(5, 60), true);
  assert.ok(falso.llaves().includes('sd:mesa:5:llamada'));
});
