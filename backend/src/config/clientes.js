/**
 * D-19 parte B: la configuración de la sesión de los clientes de la app.
 *
 * Todo se lee en cada llamada (no al cargar el módulo), para que las pruebas
 * puedan cambiar una variable sin recargar nada. Ninguna es obligatoria: si
 * falta o no es válida, vale lo que dice el contrato (docs/api-spec.md, "API v1 ·
 * Clientes").
 */

/** Vida del JWT del cliente por omisión: corta, porque el refresh lo renueva. */
const VIDA_JWT_POR_DEFECTO = '15m';
const DIAS_REFRESH_POR_DEFECTO = 30;
const GRACIA_POR_DEFECTO_SEG = 30;

/**
 * Vida del JWT del cliente, en el formato de `jsonwebtoken` ('15m', '1h', 900).
 *
 * El contrato la llama `JWT_CLIENTE_EXPIRES_IN`, que es el mismo patrón de
 * `JWT_COMENSAL_EXPIRES_IN`. Se acepta también `CLIENTE_JWT_EXPIRES_IN` (el
 * nombre con el que se pidió la tarea) para que ninguno de los dos quede
 * ignorado en silencio; si están las dos, gana la del contrato.
 */
function vidaJwtCliente(env = process.env) {
  const valor = env.JWT_CLIENTE_EXPIRES_IN || env.CLIENTE_JWT_EXPIRES_IN;
  return typeof valor === 'string' && valor.trim() ? valor.trim() : VIDA_JWT_POR_DEFECTO;
}

/** Entero de una variable, o el valor por defecto si no es un entero >= minimo. */
function entero(valor, porDefecto, minimo) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return porDefecto;
  const n = Number(valor);
  return Number.isInteger(n) && n >= minimo ? n : porDefecto;
}

/** Días que vive un refresh token desde que se emite (REFRESH_CLIENTE_DIAS, 30). */
function diasRefresh(env = process.env) {
  return entero(env.REFRESH_CLIENTE_DIAS, DIAS_REFRESH_POR_DEFECTO, 1);
}

/**
 * Ventana de gracia del refresh, en segundos (REFRESH_CLIENTE_GRACIA_SEGUNDOS,
 * 30). `0` la apaga: un token rotado que vuelve a llegar revoca la familia
 * siempre.
 */
function graciaSegundos(env = process.env) {
  return entero(env.REFRESH_CLIENTE_GRACIA_SEGUNDOS, GRACIA_POR_DEFECTO_SEG, 0);
}

module.exports = {
  vidaJwtCliente,
  diasRefresh,
  graciaSegundos,
  VIDA_JWT_POR_DEFECTO,
  DIAS_REFRESH_POR_DEFECTO,
  GRACIA_POR_DEFECTO_SEG,
};
