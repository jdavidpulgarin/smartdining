const redis = require('../config/redis');
const { enPruebas } = require('../config/entorno');
const usuariosService = require('./usuarios.service');

/**
 * ¿El usuario del JWT sigue activo? (H-09)
 *
 * Un JWT vive 8 horas y no se puede retirar: tras desactivar a alguien en la
 * base, su token seguía abriendo la API hasta que caducaba. Así que en cada
 * petición del personal hay que preguntar si la cuenta sigue viva.
 *
 * Preguntárselo a PostgreSQL en CADA petición sería una consulta extra por
 * cada llamada del panel, así que la respuesta se guarda en Redis unos
 * segundos.
 *
 * VENTANA ACEPTADA: con el TTL por defecto (60 s), un usuario recién
 * desactivado puede seguir entrando hasta un minuto. Es el precio de no
 * consultar la base en cada petición; si hiciera falta cerrar más rápido, se
 * baja CACHE_USUARIO_TTL_SEG o se borra la llave al desactivar.
 *
 * Redis aquí es solo una caché y NUNCA puede tumbar una petición: si falla al
 * leer o al escribir, se consulta la base y se sigue. Quien sí decide es
 * PostgreSQL, y si la base falla el error sube (falla cerrada), igual que la
 * comprobación de sesión del comensal.
 */

const TTL_POR_DEFECTO_SEG = 60;

const llave = (idUsuario) => `sd:usuario:${idUsuario}:activo`;

/**
 * En las pruebas la caché se salta.
 *
 * Es una caché compartida con TTL: una prueba que deje a un usuario como
 * inactivo contaminaría a las siguientes durante un minuto, y el orden de las
 * pruebas pasaría a importar. El comportamiento de la caché se prueba aparte,
 * pasándole un entorno de producción y un cliente de Redis de mentira.
 */
function cacheActiva(env = process.env) {
  return !enPruebas(env);
}

function ttlSegundos(env = process.env) {
  const n = Number(env.CACHE_USUARIO_TTL_SEG);
  return Number.isInteger(n) && n > 0 ? n : TTL_POR_DEFECTO_SEG;
}

/** Lee la caché. Devuelve true, false o null (sin dato o sin Redis). */
async function leerCache(idUsuario, env = process.env) {
  if (!cacheActiva(env)) return null;
  try {
    const cliente = await redis.connectRedis();
    const valor = await cliente.get(llave(idUsuario));
    if (valor === '1') return true;
    if (valor === '0') return false;
    return null;
  } catch {
    // Sin Redis no hay caché, y eso no es un error para quien llama.
    return null;
  }
}

/** Guarda el resultado. Si Redis falla, da igual: solo se pierde la caché. */
async function guardarCache(idUsuario, activo, env = process.env) {
  if (!cacheActiva(env)) return;
  try {
    const cliente = await redis.connectRedis();
    await cliente.set(llave(idUsuario), activo ? '1' : '0', { EX: ttlSegundos(env) });
  } catch {
    // Ignorado a propósito.
  }
}

/**
 * @returns {Promise<boolean>} true si la cuenta existe y está activa.
 * @throws si la base de datos no responde (falla cerrada).
 */
async function estaActivo(idUsuario, { env = process.env } = {}) {
  if (idUsuario === undefined || idUsuario === null) return false;

  const enCache = await leerCache(idUsuario, env);
  if (enCache !== null) return enCache;

  const usuario = await usuariosService.buscarPorId(idUsuario);
  // Un usuario borrado cuenta como inactivo: su token no debe seguir sirviendo.
  const activo = Boolean(usuario && usuario.activo);

  await guardarCache(idUsuario, activo, env);
  return activo;
}

/** Olvida lo que se sepa de un usuario (al desactivarlo, por ejemplo). */
async function olvidar(idUsuario) {
  try {
    const cliente = await redis.connectRedis();
    await cliente.del(llave(idUsuario));
    return true;
  } catch {
    return false;
  }
}

module.exports = { estaActivo, olvidar, llave, ttlSegundos, cacheActiva, TTL_POR_DEFECTO_SEG };
