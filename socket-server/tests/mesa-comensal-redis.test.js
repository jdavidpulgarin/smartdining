// POST /internal/mesa-comensal con el doble de Redis
// (EVENTS.md §6.4 y §5.2). Utilidades en ./mesa-comensal-ayuda.js.
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  silencioso, pausa, VENTANA_MS, ALMACENES, post, aviso, llamar, OK, error, comoError, escenario, presencia, nadaDePresencia, pruebasDeLaRuta,
} = require('./mesa-comensal-ayuda');

pruebasDeLaRuta('redis');

test('con Redis caído: 500 ERROR_INTERNO; al volver, el mismo eventId aplica', async (t) => {
  const { s, falso } = await escenario(t, 'redis');
  const cuerpo = aviso('Abuela');
  falso.caer();
  assert.deepStrictEqual(comoError(await llamar(s, cuerpo)), error(500, 'ERROR_INTERNO'));
  falso.levantar();
  assert.deepStrictEqual(await llamar(s, cuerpo), OK);
});
