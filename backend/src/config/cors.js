/**
 * Orígenes permitidos para CORS (H-10).
 *
 * Antes se usaba `cors()` sin argumentos, que responde
 * `Access-Control-Allow-Origin: *`: cualquier página de internet podía llamar a
 * la API desde el navegador de un empleado con sesión abierta.
 *
 * La lista viene de `CORS_ORIGINS` (separada por comas). En **producción** es
 * obligatoria: si falta, no se permite ningún origen cruzado, porque un
 * despliegue sin configurar debe quedarse corto, no abierto. En desarrollo y en
 * pruebas se usan los tres puertos locales de los frontends, para que nadie
 * tenga que configurar nada para trabajar.
 */

/** Puertos de Vite de los tres frontends (cliente, restaurante, KDS). */
const ORIGENES_LOCALES = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
];

/** Lista de orígenes permitidos según el entorno. */
function origenesPermitidos(env = process.env) {
  const configurados = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (configurados.length > 0) return configurados;
  if (env.NODE_ENV === 'production') return [];
  return ORIGENES_LOCALES;
}

/**
 * Opciones para el middleware `cors`.
 *
 * `credentials` se queda **fuera** a propósito: el backend autentica con
 * `Authorization: Bearer`, no con cookies, así que no hace falta y activarlo
 * obligaría a no poder usar comodines nunca más.
 *
 * Una petición **sin** cabecera `Origin` (curl, el socket-server, una prueba)
 * se deja pasar: CORS es una protección del navegador y esas peticiones no
 * vienen de uno. Lo que decide el acceso en esos casos es el JWT o la clave
 * interna, no esta lista.
 */
function opcionesCors(env = process.env) {
  const permitidos = origenesPermitidos(env);

  return {
    origin(origen, callback) {
      if (!origen) return callback(null, true);
      return callback(null, permitidos.includes(origen));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
  };
}

module.exports = { opcionesCors, origenesPermitidos, ORIGENES_LOCALES };
