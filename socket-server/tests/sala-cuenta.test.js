const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, tokenPantalla, CLAVE_INTERNA,
} = require('./helpers');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');
const { crearRedisFalso } = require('./redis-falso');

async function escenario(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const beto = await s.conectar(tokenComensal(5));
  await emitir(beto, 'join:table', {});
  const cajero = await s.conectar(tokenPersonal('cajero'));
  return { s, ana, beto, cajero };
}

test('pedir la cuenta llega al panel y a la mesa, y queda marcada', async (t) => {
  const { s, ana, beto, cajero } = await escenario(t);
  const enPanel = esperar(cajero, 'cuenta:solicitada');
  const enMesa = esperar(beto, 'cuenta:solicitada');
  const ack = await emitir(ana, 'cuenta:solicitada', { eventId: randomUUID(), id_mesa: 9 });
  assert.deepStrictEqual([ack.ok, ack.duplicado], [true, false]);
  assert.strictEqual((await enPanel).id_mesa, 5);
  assert.strictEqual((await enMesa).id_mesa, 5);
  assert.strictEqual(await s.estadoMesas.cuentaSolicitada(5), true);
  assert.strictEqual(await s.estadoMesas.cuentaSolicitada(9), false);
});

test('rol incorrecto: personal y pantalla no piden la cuenta por este evento', async (t) => {
  const { s, cajero } = await escenario(t);
  assert.strictEqual((await emitir(cajero, 'cuenta:solicitada', { eventId: randomUUID() })).codigo, 'NO_AUTORIZADO');
  const pantalla = await s.conectar(tokenPantalla(5));
  assert.strictEqual((await emitir(pantalla, 'cuenta:solicitada', { eventId: randomUUID() })).codigo, 'NO_AUTORIZADO');
});

test('payload inválido y sin sala', async (t) => {
  const { s, ana } = await escenario(t);
  assert.strictEqual((await emitir(ana, 'cuenta:solicitada', {})).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cuenta:solicitada', { eventId: 'abc' })).codigo, 'PAYLOAD_INVALIDO');
  const fuera = await s.conectar(tokenComensal(5));
  assert.strictEqual((await emitir(fuera, 'cuenta:solicitada', { eventId: randomUUID() })).codigo, 'SIN_SALA');
});

test('duplicado: el mismo eventId no se reenvía', async (t) => {
  const { ana, cajero } = await escenario(t);
  const eventId = randomUUID();
  const primero = esperar(cajero, 'cuenta:solicitada');
  await emitir(ana, 'cuenta:solicitada', { eventId });
  await primero;
  const otra = esperar(cajero, 'cuenta:solicitada', 300);
  assert.strictEqual((await emitir(ana, 'cuenta:solicitada', { eventId })).duplicado, true);
  assert.strictEqual(await otra, null);
});

test('aislamiento: otra mesa no recibe nada; liberar la mesa borra la marca', async (t) => {
  const { s, ana } = await escenario(t);
  const vecina = await s.conectar(tokenComensal(6));
  await emitir(vecina, 'join:table', {});
  const nada = esperar(vecina, 'cuenta:solicitada', 300);
  await emitir(ana, 'cuenta:solicitada', { eventId: randomUUID() });
  assert.strictEqual(await nada, null);
  await fetch(`${s.url}/internal/mesa-liberada`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }),
  });
  assert.strictEqual(await s.estadoMesas.cuentaSolicitada(5), false);
});

test('Redis: la marca vive en sd:mesa:{ID}:cuenta y se borra con la mesa', async () => {
  const falso = crearRedisFalso();
  const estado = crearEstadoMesasRedis({ cliente: falso.cliente });
  await estado.marcarCuenta(5);
  await estado.reservarLlamada(5, 60);
  assert.strictEqual(await falso.cliente.get('sd:mesa:5:cuenta'), '1');
  assert.strictEqual(await estado.cuentaSolicitada(5), true);
  await estado.limpiarMesa(5);
  assert.deepStrictEqual(falso.llaves(), []);
});
