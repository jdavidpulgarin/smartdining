/**
 * D-19 parte B: el refresh token de los clientes.
 *
 * Es OPACO y aleatorio: 32 bytes de `crypto.randomBytes` en base64url, o sea 43
 * caracteres `[A-Za-z0-9_-]` sin relleno. En la base se guarda SOLO su SHA-256
 * en hex (64 caracteres, `refresh_tokens_cliente.hash`): quien lea la tabla, un
 * respaldo o un log de consultas no puede usar ningún token.
 */

const crypto = require('crypto');

const BYTES_REFRESH = 32;

/** 32 bytes en base64url sin relleno son siempre 43 caracteres. */
const FORMATO_REFRESH = /^[A-Za-z0-9_-]{43}$/;

/** Un refresh token nuevo. */
function generarRefreshToken() {
  return crypto.randomBytes(BYTES_REFRESH).toString('base64url');
}

/** El SHA-256 en hex del token: lo único que toca la base y los contadores. */
function hashDeRefresh(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** ¿Tiene la forma de un refresh token? (no dice si existe). */
function esFormatoDeRefresh(valor) {
  return typeof valor === 'string' && FORMATO_REFRESH.test(valor);
}

module.exports = {
  BYTES_REFRESH,
  FORMATO_REFRESH,
  generarRefreshToken,
  hashDeRefresh,
  esFormatoDeRefresh,
};
