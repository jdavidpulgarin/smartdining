// POST /internal/mesa-comensal con el almacén en memoria
// (EVENTS.md §6.4 y §5.2). Utilidades en ./mesa-comensal-ayuda.js.
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  silencioso, pausa, VENTANA_MS, ALMACENES, post, aviso, llamar, OK, error, comoError, escenario, presencia, nadaDePresencia, pruebasDeLaRuta,
} = require('./mesa-comensal-ayuda');

pruebasDeLaRuta('memoria');

test('sin INTERNAL_API_KEY configurada: 503 NO_CONFIGURADO', async (t) => {
  const { s } = await escenario(t, 'memoria');
  // El arranque exige la clave (secretos.js): se quita del config ya cargado.
  s.config.internalApiKey = undefined;
  assert.deepStrictEqual(comoError(await llamar(s, aviso('Abuela'))), error(503, 'NO_CONFIGURADO'));
  assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {});
});

test('mesa solo con sin celular: total 1 (el QR deja de rotar) y comensales con su alias', async (t) => {
  const { s } = await escenario(t, 'memoria');
  assert.deepStrictEqual(await llamar(s, aviso('Abuela', 'agregar', { id_mesa: 7 })), OK);
  assert.deepStrictEqual(await s.presencia.calcular(7), {
    id_mesa: 7, comensales: ['Abuela'], total: 1, pagaron: [], sin_celular: ['Abuela'],
  });
});
