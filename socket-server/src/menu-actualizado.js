const { log } = require('./log');
const { esEventIdValido } = require('./idempotencia');
const { SALA_ADMIN } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

// id_plato es INTEGER > 0 en la base (database/schema.sql, tabla platos).
const MAX_INT_PG = 2147483647;
const SALA_MESA = /^room:mesa-\d+$/;

// Qué cambió en la carta. Las de plato siempre traen id_plato; las de categoría
// nunca (una categoría mueve varios platos); las del constructor (pasos y sus
// opciones) lo traen si el backend lo sabe, si no va null.
const ACCIONES_PLATO = ['plato-creado', 'plato-editado', 'plato-eliminado'];
const ACCIONES_CATEGORIA = ['categoria-creada', 'categoria-editada', 'categoria-eliminada'];
const ACCIONES_CONSTRUCTOR = [
  'paso-creado', 'paso-editado', 'paso-eliminado', 'opcion-creada', 'opcion-editada', 'opcion-eliminada',
];
const ACCIONES = [...ACCIONES_PLATO, ...ACCIONES_CATEGORIA, ...ACCIONES_CONSTRUCTOR];
const CAMPOS = ['eventId', 'id_plato', 'accion'];

const esId = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_INT_PG;

/**
 * Valida el cuerpo (EVENTS.md §5.8); lanza 400 si no cumple. Estricto: los
 * tres campos son obligatorios (id_plato puede ser null, pero tiene que venir)
 * y un campo de más se RECHAZA, no se descarta: el aviso solo dice «cambió la
 * carta», nunca lleva datos del plato (la PWA los vuelve a pedir a GET /menu).
 */
function validar(c) {
  const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalido('El cuerpo debe ser un objeto JSON');
  const sobran = Object.keys(c).filter((k) => !CAMPOS.includes(k));
  if (sobran.length > 0) throw invalido(`campos no permitidos: ${sobran.join(', ')}`);
  if (!esEventIdValido(c.eventId)) throw invalido('eventId debe ser un UUID');
  if (!ACCIONES.includes(c.accion)) throw invalido(`accion debe ser una de: ${ACCIONES.join(', ')}`);
  if (!('id_plato' in c) || (c.id_plato !== null && !esId(c.id_plato))) {
    throw invalido(`id_plato debe ser null o un entero entre 1 y ${MAX_INT_PG}`);
  }
  if (ACCIONES_PLATO.includes(c.accion) && c.id_plato === null) throw invalido(`con accion ${c.accion}, id_plato es obligatorio`);
  if (ACCIONES_CATEGORIA.includes(c.accion) && c.id_plato !== null) throw invalido(`con accion ${c.accion}, id_plato debe ser null`);
}

/** Las salas de mesa que existen en este proceso (una sola instancia, sin adaptador de Redis). */
function salasDeMesa(io) {
  return [...io.of('/').adapter.rooms.keys()].filter((sala) => SALA_MESA.test(sala));
}

/**
 * POST /internal/menu-actualizado (EVENTS.md §5.8) — cambió la carta: se creó,
 * editó o borró un plato, una categoría o un paso u opción del constructor. Lo
 * llama el backend después del COMMIT (y después de invalidar la caché del
 * menú), para que la PWA vuelva a pedir GET /menu sin recargar.
 *
 * Emite menu:actualizado a TODAS las mesas (room:mesa-N: comensales y
 * pantallas) y a room:admin. No a room:kds: la cocina no muestra la carta.
 *
 * Idempotencia como mesa-actualizada: todo se valida ANTES de reservar (un 4xx
 * no consume el eventId). Si la emisión falla, se libera la reserva y responde
 * 500 ERROR_INTERNO, que el backend reintenta con el mismo eventId.
 */
async function rutaMenuActualizado(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const c = parsearJson(await leerCuerpoCrudo(req));
  validar(c);

  const clave = `backend:menu-actualizado:${c.eventId}`;
  if (!(await ctx.registro.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });
  try {
    ctx.io.to([...salasDeMesa(ctx.io), SALA_ADMIN]).emit('menu:actualizado', {
      eventId: c.eventId,
      id_plato: c.id_plato,
      accion: c.accion,
      emitidoEn: new Date().toISOString(),
    });
  } catch (err) {
    try {
      await ctx.registro.liberar(clave);
    } catch (errLiberar) {
      // Sin liberar, el reintento llegará como duplicado: que quede en el log.
      log.error('menu-actualizado: no se pudo liberar el eventId tras fallar la emisión', { error: errLiberar });
    }
    throw err;
  }
  return enviarJson(res, 200, { ok: true, duplicado: false });
}

const rutasMenuActualizado = { 'POST /internal/menu-actualizado': rutaMenuActualizado };

module.exports = { rutasMenuActualizado, ACCIONES };
