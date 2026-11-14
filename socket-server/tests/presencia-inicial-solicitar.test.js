// Presencia inicial · mesa:presencia:solicitar devuelve la lista en el ack
// (opción 2): roles y aislamiento. El límite por socket y Redis caído van en
// presencia-inicial-solicitar-limites.test.js.
const test = require('node:test');
const assert = require('node:assert');
const {
  emitir, tokenComensal, tokenPantalla, tokenPersonal,
} = require('./helpers');
const {
  pausa, ESPERA_MS, esperadas, escenarioSolicitar,
} = require('./presencia-inicial-helpers');

for (const rol of ['admin', 'mesero', 'cajero']) {
  test(`solicitar (${rol}): el ack trae todas las mesas con algo y no se emite ningún evento suelto`, async (t) => {
    const { mesas, conectar } = await escenarioSolicitar(t);
    const { c, recibidas } = await conectar(tokenPersonal(rol));
    const ack = await emitir(c, 'mesa:presencia:solicitar', {});
    assert.deepStrictEqual(ack, { ok: true, mesas: esperadas(mesas) });
    await pausa(ESPERA_MS);
    assert.deepStrictEqual(recibidas, [], 'la respuesta va solo en el ack');
  });
}

test('solicitar: también sin payload ni ack (emit sin callback) no rompe nada', async (t) => {
  const { conectar } = await escenarioSolicitar(t);
  const { c } = await conectar(tokenPersonal('admin'));
  c.emit('mesa:presencia:solicitar');
  await pausa(100);
  assert.strictEqual(c.connected, true);
});

test('solicitar: aislamiento por rol (comensal, tablet y cocina → NO_AUTORIZADO, sin calcular)', async (t) => {
  const { s, mesas, conectar } = await escenarioSolicitar(t);
  const original = s.presencia.listarConEstado;
  let calculos = 0;
  s.presencia.listarConEstado = (...a) => { calculos += 1; return original(...a); };
  t.after(() => { s.presencia.listarConEstado = original; });
  const quienes = await Promise.all([
    conectar(tokenComensal(mesas.A, 'Carla')),
    conectar(tokenPantalla(mesas.A)),
    conectar(tokenPersonal('cocina')),
  ]);
  for (const { c } of quienes) {
    const ack = await emitir(c, 'mesa:presencia:solicitar', {});
    assert.strictEqual(ack.ok, false);
    assert.strictEqual(ack.codigo, 'NO_AUTORIZADO');
    assert.ok(!('mesas' in ack));
  }
  assert.strictEqual(calculos, 0);
});
