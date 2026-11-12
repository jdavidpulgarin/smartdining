/**
 * Servicio de autenticación móvil (pendiente de endpoints D-19).
 * En Etapa 1 solo define los contratos documentados y no realiza llamadas reales.
 * Cuando D-19 esté listo, usará `pedirJson` de `./api` y almacenará el JWT + refresh token.
 */

function errorNoImplementado(accion) {
  return new Error(
    `[D-19 pendiente] ${accion} estará disponible cuando se publiquen los endpoints de autenticación móvil.`
  );
}

/**
 * Registra un nuevo cliente en SmartDining (D-19).
 * Endpoint esperado: POST /api/auth/clientes/registro
 * @param {{ nombre: string, correo: string, password: string }} _datos
 * @returns {Promise<{ usuario: object, token: string, refreshToken: string }>}
 */
export async function registrarUsuario(_datos) {
  throw errorNoImplementado('registrarUsuario');
}

/**
 * Inicia sesión con correo y contraseña (D-19).
 * Endpoint esperado: POST /api/auth/clientes/login
 * @param {{ correo: string, password: string }} _credenciales
 * @returns {Promise<{ usuario: object, token: string, refreshToken: string }>}
 */
export async function iniciarSesion(_credenciales) {
  throw errorNoImplementado('iniciarSesion');
}

/**
 * Refresca el access token usando el refresh token almacenado (D-19).
 * Endpoint esperado: POST /api/auth/clientes/refresh
 * @param {string} _refreshToken
 * @returns {Promise<{ token: string, refreshToken?: string }>}
 */
export async function refrescarToken(_refreshToken) {
  throw errorNoImplementado('refrescarToken');
}

/**
 * Cierra la sesión actual e invalida el refresh token en servidor (D-19).
 * Endpoint esperado: POST /api/auth/clientes/logout
 * @param {string} _token
 * @returns {Promise<void>}
 */
export async function cerrarSesion(_token) {
  throw errorNoImplementado('cerrarSesion');
}
