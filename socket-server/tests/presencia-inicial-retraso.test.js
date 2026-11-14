// Presencia inicial · el retraso real de 500 ms cubre al panel que registra
// el listener tarde (opción 1), y si se desconecta antes no se calcula nada.
const test = require('node:test');
const assert = require('node:assert');
const { tokenPersonal } = require('./helpers');
const { RETRASO_PRESENCIA_INICIAL_MS } = require('../src/sala');
const {
  pausa, hasta, conectarEscuchando, escenario, esperadas, abrirComoElPanel,
} = require('./presencia-inicial-helpers');


for (const listenerTrasMs of [16, 50]) {
  test(`retraso de ${RETRASO_PRESENCIA_INICIAL_MS} ms: el panel con el listener a ${listenerTrasMs} ms recibe la presencia`, async (t) => {
    const { s, mesas } = await escenario(t, {}, 10, RETRASO_PRESENCIA_INICIAL_MS);
    const { c, recibidas } = await abrirComoElPanel(s, tokenPersonal('mesero'), listenerTrasMs);
    t.after(() => c.close());
    await hasta(() => recibidas.length >= 3, RETRASO_PRESENCIA_INICIAL_MS + 2000);
    await pausa(50);
    assert.strictEqual(c.connected, true);
    assert.deepStrictEqual(recibidas, esperadas(mesas));
  });
}

test('si el panel se desconecta antes del retraso, no se calcula ni se envía nada', async (t) => {
  const { s } = await escenario(t, {}, 10, 400);
  const original = s.presencia.listarConEstado;
  let calculos = 0;
  s.presencia.listarConEstado = (...a) => { calculos += 1; return original(...a); };
  t.after(() => { s.presencia.listarConEstado = original; });
  const { c } = await conectarEscuchando(s, tokenPersonal('admin'));
  await pausa(100);
  c.close();
  await pausa(600);
  assert.strictEqual(calculos, 0);
});

