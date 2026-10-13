const redis = require('../config/redis');

/**
 * Alias del comensal dentro de la sesión de su mesa.
 *
 * El alias ("Ana") identifica al comensal ante los demás: quién pidió cada
 * plato, a quién avisar que su plato está listo y cuánto paga en el modo
 * "propio". Si cada cliente lo eligiera en cada evento, cualquiera de la mesa
 * podría editar, quitar o pagar como otro. Por eso el backend lo fija UNA vez,
 * al abrir la sesión, y lo firma dentro del JWT; el socket-server solo cree
 * el del JWT.
 *
 * Unicidad: dos comensales de la misma sesión no pueden tener el mismo alias
 * (ni variantes por mayúsculas, tildes o espacios: "Ana", "ana" y "Ána" son el
 * mismo). Se reserva con HSETNX en `sd:mesa:{id}:alias`, que es atómico aunque
 * lleguen dos escaneos a la vez. La reserva vence con el JWT y se borra al
 * abrir una sesión nueva o al liberar la mesa.
 *
 * No hay tabla de sesiones de comensal en la base (crearla es de database/).
 * Mientras no exista, la reserva vive en Redis y falla CERRADA en producción:
 * sin Redis no se emite la sesión (503). Una sesión sin unicidad garantizada
 * reabriría la suplantación que esto cierra. Fuera de producción y sin
 * REDIS_URL se usa un respaldo en memoria para poder desarrollar sin Redis.
 */

const MIN = 2;
const MAX = 40;
// Letras (con tildes y ñ), números, espacio y . _ ' -. Nada de < > " / \ ni
// emojis: el alias se muestra en el panel, en la cocina y en notificaciones.
const PERMITIDOS = /^[\p{L}\p{M}\p{N} ._'-]+$/u;

const llave = (idMesa) => `sd:mesa:${idMesa}:alias`;

/** Ttl en segundos a partir de "3h", "90m", "45s", "1d" o un número de segundos. */
function segundos(vigencia) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(vigencia).trim());
  if (!m) return 3 * 60 * 60;
  const factor = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return Number(m[1]) * factor;
}

/**
 * Valida y normaliza el alias. Devuelve { alias, clave } o { error }.
 * - alias: como se muestra (sin espacios a los lados y sin dobles espacios).
 * - clave: para comparar (minúsculas, sin tildes ni espacios).
 */
function normalizarAlias(valor) {
  if (typeof valor !== 'string') return { error: 'comensal es obligatorio (tu nombre o apodo en la mesa)' };
  const alias = valor.normalize('NFC').trim().replace(/\s+/g, ' ');
  const largo = [...alias].length;
  if (largo < MIN || largo > MAX) return { error: `comensal debe tener entre ${MIN} y ${MAX} caracteres` };
  if (!PERMITIDOS.test(alias)) {
    return { error: 'comensal solo admite letras, números, espacios y . _ \' -' };
  }
  const clave = alias.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s._'-]/g, '');
  if (clave.length === 0) return { error: 'comensal debe tener al menos una letra o un número' };
  return { alias, clave };
}

// Respaldo SOLO para desarrollo sin Redis. idMesa -> Map(clave -> vence en ms)
const memoria = new Map();

async function clienteRedis() {
  if (!process.env.REDIS_URL) return null;
  return redis.connectRedis(); // lanza si Redis no responde: el llamador decide
}

/**
 * Reserva el alias para la sesión actual de la mesa.
 * @returns {Promise<{ok: true} | {enUso: true} | {noDisponible: true}>}
 */
async function reservar(idMesa, { alias, clave }, { vigencia = '3h', ahora = Date.now } = {}) {
  const ttl = segundos(vigencia);
  let cliente;
  try {
    cliente = await clienteRedis();
  } catch (err) {
    console.error('[alias] Redis no está disponible:', err.message);
    return { noDisponible: true };
  }

  if (!cliente) {
    if (process.env.NODE_ENV === 'production') return { noDisponible: true };
    const mesa = memoria.get(idMesa) || new Map();
    memoria.set(idMesa, mesa);
    const vence = mesa.get(clave);
    if (vence && vence > ahora()) return { enUso: true };
    mesa.set(clave, ahora() + ttl * 1000);
    return { ok: true };
  }

  try {
    const nuevo = await cliente.hSetNX(llave(idMesa), clave, JSON.stringify({ alias, en: new Date(ahora()).toISOString() }));
    if (!nuevo) return { enUso: true };
    // La reserva dura lo que el JWT más nuevo de la mesa.
    await cliente.expire(llave(idMesa), ttl);
    return { ok: true };
  } catch (err) {
    console.error('[alias] no se pudo reservar el alias:', err.message);
    return { noDisponible: true };
  }
}

/**
 * Olvida los alias de la mesa (sesión nueva o mesa liberada). Nunca lanza:
 * se llama después del commit y no debe deshacer nada. Si Redis falla, la
 * reserva vence sola con el JWT.
 */
async function olvidarMesa(idMesa) {
  memoria.delete(idMesa);
  try {
    const cliente = await clienteRedis();
    if (cliente) await cliente.del(llave(idMesa));
  } catch (err) {
    console.error(`[alias] no se pudieron borrar los alias de la mesa ${idMesa}:`, err.message);
  }
}

module.exports = {
  normalizarAlias, reservar, olvidarMesa, segundos, llave, MIN, MAX,
};
