const { log } = require('./log');
const { esEventIdValido } = require('./idempotencia');
const { SALA_ADMIN } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

// Límites del esquema (database/schema.sql, tabla mesas): ids, numero y
// capacidad INTEGER > 0; ubicacion VARCHAR(50); estado con su CHECK.
const MAX_INT_PG = 2147483647;
const MAX_UBICACION = 50;
const ESTADOS_MESA = ['disponible', 'ocupada', 'reservada', 'mantenimiento'];

// Qué cambió (opcional, solo informativo para el panel): la mesa se abrió con
// su QR, cambió de estado, se creó, se editaron sus datos, quedó libre (a mano
// o tras el cobro), se borró o se le asignó mesero (esto último aún no existe
// en el backend).
const MOTIVOS = ['abierta', 'estado', 'creada', 'datos', 'liberada', 'eliminada', 'mesero'];
const ELIMINADA = 'eliminada';
// Con 'eliminada' la fila ya no existe (DELETE ... RETURNING id_mesa): los
// datos de la mesa son opcionales y, si vienen, se validan igual.
const DATOS_MESA = ['numero', 'estado', 'capacidad', 'ubicacion'];
const OPCIONALES = ['activa', 'sesion_abierta', 'motivo', 'id_mesero'];

const esId = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_INT_PG;
// Caracteres (puntos de código), como VARCHAR en PostgreSQL.
const esTextoDe1a = (v, max) => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max;

/**
 * Valida el cuerpo (EVENTS.md §5.7); lanza 400 si no cumple. Los campos que
 * no están en el contrato NO se rechazan (el backend puede mandar la fila
 * entera): se descartan al armar el evento, token_qr incluido.
 */
function validar(c) {
  const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw invalido('El cuerpo debe ser un objeto JSON');
  if (!esEventIdValido(c.eventId)) throw invalido('eventId debe ser un UUID');
  if (!esId(c.id_mesa)) throw invalido(`id_mesa debe ser un entero entre 1 y ${MAX_INT_PG}`);
  // Opcional quiere decir que puede NO venir; si viene, tiene que ser válido.
  if (c.motivo !== undefined && !MOTIVOS.includes(c.motivo)) throw invalido(`motivo debe ser uno de: ${MOTIVOS.join(', ')} (o no venir)`);
  const eliminada = c.motivo === ELIMINADA;
  const presente = (campo) => !eliminada || c[campo] !== undefined;
  for (const campo of ['numero', 'capacidad']) {
    if (presente(campo) && !esId(c[campo])) throw invalido(`${campo} debe ser un entero entre 1 y ${MAX_INT_PG}`);
  }
  if (presente('estado') && !ESTADOS_MESA.includes(c.estado)) throw invalido(`estado debe ser uno de: ${ESTADOS_MESA.join(', ')}`);
  if (presente('ubicacion') && !esTextoDe1a(c.ubicacion, MAX_UBICACION)) throw invalido(`ubicacion debe tener de 1 a ${MAX_UBICACION} caracteres`);
  if (c.activa !== undefined && typeof c.activa !== 'boolean') throw invalido('activa debe ser true o false (o no venir)');
  if (c.sesion_abierta !== undefined && typeof c.sesion_abierta !== 'boolean') {
    throw invalido('sesion_abierta debe ser true o false (o no venir)');
  }
  // Coherencia: un aviso contradictorio es un error del backend; mejor un 400
  // que pintarle al panel una mesa imposible.
  if (eliminada && c.activa !== false) throw invalido('con motivo eliminada, activa debe ser false');
  if ((eliminada || c.motivo === 'liberada') && c.sesion_abierta === true) {
    throw invalido(`con motivo ${c.motivo}, sesion_abierta no puede ser true`);
  }
  if (c.motivo === 'abierta' && c.sesion_abierta === false) throw invalido('con motivo abierta, sesion_abierta no puede ser false');
  if (c.id_mesero !== undefined && c.id_mesero !== null && !esId(c.id_mesero)) {
    throw invalido(`id_mesero debe ser null o un entero entre 1 y ${MAX_INT_PG} (o no venir)`);
  }
}

/** Solo los campos del contrato; los opcionales, solo si vinieron. */
function armarEvento(c) {
  const evento = { eventId: c.eventId, id_mesa: c.id_mesa };
  // Obligatorios salvo con 'eliminada' (ya validados): van si vinieron.
  for (const campo of [...DATOS_MESA, ...OPCIONALES]) {
    if (c[campo] !== undefined) evento[campo] = c[campo];
  }
  evento.emitidoEn = new Date().toISOString();
  return evento;
}

/**
 * POST /internal/mesa-actualizada (EVENTS.md §5.7) — cambió una mesa: se
 * abrió, cambió de estado, se creó, se editaron sus datos, quedó libre o se
 * borró (motivo 'eliminada', activa false). Lo llama el
 * backend después del COMMIT, para que el panel vea las mesas en vivo.
 *
 * Emite mesa:actualizada SOLO a room:admin (admin, mesero, cajero). Nunca a
 * las mesas, las pantallas, la cocina ni los clientes, y nunca el token_qr ni
 * datos de comensales: el evento se arma solo con los campos validados.
 *
 * Idempotencia como inventario-alerta: todo se valida ANTES de reservar (un
 * 4xx no consume el eventId). Si la emisión falla, se libera la reserva y
 * responde 500 ERROR_INTERNO, que el backend reintenta con el mismo eventId.
 */
async function rutaMesaActualizada(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const c = parsearJson(await leerCuerpoCrudo(req));
  validar(c);

  const clave = `backend:mesa-actualizada:${c.eventId}`;
  if (!(await ctx.registro.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });
  try {
    ctx.io.to(SALA_ADMIN).emit('mesa:actualizada', armarEvento(c));
  } catch (err) {
    try {
      await ctx.registro.liberar(clave);
    } catch (errLiberar) {
      // Sin liberar, el reintento llegará como duplicado: que quede en el log.
      log.error('mesa-actualizada: no se pudo liberar el eventId tras fallar la emisión', { error: errLiberar });
    }
    throw err;
  }
  return enviarJson(res, 200, { ok: true, duplicado: false });
}

const rutasMesaActualizada = { 'POST /internal/mesa-actualizada': rutaMesaActualizada };

module.exports = {
  rutasMesaActualizada, ESTADOS_MESA, MOTIVOS, MAX_UBICACION,
};
