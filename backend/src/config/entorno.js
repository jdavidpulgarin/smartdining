/**
 * ¿Estamos corriendo las pruebas?
 *
 * No basta con NODE_ENV: `npm test` arranca `node --test` sin definirla. El
 * runner de Node sí marca cada proceso hijo con NODE_TEST_CONTEXT, y eso es
 * fiable.
 *
 * Lo usan las piezas que deben comportarse distinto en pruebas para no volverlas
 * frágiles: los límites de intentos (si no, una prueba que llame seis veces al
 * login empezaría a fallar) y la caché de usuarios activos (una caché compartida
 * con TTL filtraría estado de una prueba a la siguiente).
 */
function enPruebas(env = process.env) {
  return env.NODE_ENV === 'test' || Boolean(env.NODE_TEST_CONTEXT);
}

module.exports = { enPruebas };
