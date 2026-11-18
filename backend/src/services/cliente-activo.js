/**
 * D-19 parte B: ¿el cliente del JWT existe y sigue activo?
 *
 * Es lo mismo que usuario-activo.js hace para el personal (H-09): un JWT válido
 * no basta, porque un cliente desactivado tendría la API abierta hasta que su
 * token venciera. Aquí el JWT vive 15 minutos, pero el refresh lo renovaría sin
 * fin, así que se comprueba en cada petición.
 *
 * Misma caché en Redis y mismo TTL (CACHE_USUARIO_TTL_SEG, 60 s), con su propia
 * llave. Con Redis caído o apagado se consulta PostgreSQL; dentro de las
 * pruebas la caché no se usa. No hay hoy una ruta que desactive clientes; el día
 * que la haya, tiene que llamar a `olvidar` como hace la de usuarios.
 */

const redis = require('../config/redis');
const clientesService = require('./clientes.service');
const { cacheActiva, ttlSegundos } = require('./usuario-activo');

const llave = (idCliente) => `sd:cliente:${idCliente}:activo`;

async function leerCache(idCliente, env) {
  if (!cacheActiva(env)) return null;
  try {
    const cliente = await redis.connectRedis();
    const valor = await cliente.get(llave(idCliente));
    if (valor === '1') return true;
    if (valor === '0') return false;
    return null;
  } catch {
    return null;
  }
}

async function guardarCache(idCliente, activo, env) {
  if (!cacheActiva(env)) return;
  try {
    const cliente = await redis.connectRedis();
    await cliente.set(llave(idCliente), activo ? '1' : '0', { EX: ttlSegundos(env) });
  } catch {
    // Sin caché se sigue funcionando: la próxima petición consulta la base.
  }
}

async function estaActivo(idCliente, { env = process.env } = {}) {
  if (!Number.isInteger(idCliente) || idCliente <= 0) return false;
  const enCache = await leerCache(idCliente, env);
  if (enCache !== null) return enCache;
  const fila = await clientesService.buscarEstado(idCliente);
  const activo = Boolean(fila && fila.activo);
  await guardarCache(idCliente, activo, env);
  return activo;
}

async function olvidar(idCliente, { env = process.env } = {}) {
  if (!cacheActiva(env)) return false;
  try {
    const cliente = await redis.connectRedis();
    await cliente.del(llave(idCliente));
    return true;
  } catch {
    return false;
  }
}

module.exports = { estaActivo, olvidar, llave };
