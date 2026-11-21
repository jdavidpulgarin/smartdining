const { exito, fallo, manejar } = require('./ack');
const { log } = require('./log');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa, SALA_ADMIN, ROLES_ADMIN } = require('./salas');

// Lo que el personal marca «Atendida» en el panel (BandejaAlertas).
const TIPOS = ['llamado', 'cuenta'];
// Cuerpo estricto: un campo que no esté aquí es PAYLOAD_INVALIDO (no se
// descarta en silencio). Es el primer evento de socket con esta regla.
const CAMPOS = ['eventId', 'idMesa', 'tipo'];
// id_mesa es SERIAL (INTEGER en PostgreSQL): uno mayor ni se consulta.
const MAX_INT_PG = 2147483647;
// Como la capacidad en limites.js: una mesa activa no deja de existir a cada
// rato. Solo se guardan las activas; una inexistente o inactiva se vuelve a
// preguntar (puede crearse o reactivarse en cualquier momento).
const CACHE_MESA_ACTIVA_MS = 5 * 60 * 1000;

const esIdMesa = (v) => Number.isSafeInteger(v) && v > 0 && v <= MAX_INT_PG;

/** Mensaje del primer problema del cuerpo, o null si es válido (EVENTS.md §4). */
function problemaDelCuerpo(p) {
  if (Array.isArray(p)) return 'El cuerpo debe ser un objeto { eventId, idMesa, tipo }';
  const deMas = Object.keys(p).filter((k) => !CAMPOS.includes(k));
  if (deMas.length > 0) return `Campos no permitidos: ${deMas.slice(0, 5).join(', ')}`;
  if (!esEventIdValido(p.eventId)) return 'eventId debe ser un UUID';
  if (!esIdMesa(p.idMesa)) return `idMesa debe ser un entero entre 1 y ${MAX_INT_PG}`;
  if (!TIPOS.includes(p.tipo)) return `tipo debe ser uno de: ${TIPOS.join(', ')}`;
  return null;
}

/**
 * ¿La mesa existe y está activa? Pregunta al backend con GET /api/mesas/:id
 * (ruta pública; la misma que usa limites.js para la capacidad).
 *
 * `estado(idMesa)` devuelve 'activa', 'inactiva' o 'no_existe'. Lanza un Error
 * con .codigo si no se pudo saber (sin backend, timeout, 5xx u otra respuesta
 * rara): quien llama responde ERROR_INTERNO y el panel reintenta.
 * Si el 200 no trae `activa`, se toma como activa (el DEFAULT de la tabla).
 */
function crearVerificadorMesas({ backend, ahora = Date.now, cacheMs = CACHE_MESA_ACTIVA_MS } = {}) {
  const activas = new Map(); // idMesa -> ms en que vence

  async function estado(idMesa) {
    const vence = activas.get(idMesa);
    if (vence !== undefined && vence > ahora()) return 'activa';
    activas.delete(idMesa);
    if (!backend) {
      throw Object.assign(new Error('BACKEND_URL no configurada'), { codigo: 'BACKEND_NO_CONFIGURADO' });
    }
    const r = await backend.get(`/api/mesas/${idMesa}`);
    if (r.status === 404) return 'no_existe';
    if (r.status !== 200 || !r.cuerpo || typeof r.cuerpo !== 'object') {
      throw Object.assign(new Error(`Respuesta inesperada del backend (${r.status})`), { codigo: 'BACKEND_RESPUESTA' });
    }
    if (r.cuerpo.activa === false) return 'inactiva';
    activas.set(idMesa, ahora() + cacheMs);
    return 'activa';
  }

  return { estado };
}

/**
 * mesa:atendida — el personal marcó «Atendida» un llamado o una cuenta.
 * Llega a la mesa (el comensal sabe que ya lo atendieron) y a room:admin (las
 * otras pantallas del panel limpian la alerta). EVENTS.md §4.
 *
 * Orden: rol → cuerpo estricto → mesa existente y activa → reserva del eventId
 * → emisión. Nada antes de la reserva gasta el eventId; si la emisión falla,
 * se libera y el panel reintenta con el mismo.
 *
 * El evento solo lleva { eventId, id_mesa, tipo, emitidoEn }: ni nombre, ni id
 * ni rol de quien lo marcó.
 */
function registrarMesaAtendida(socket, ctx) {
  socket.on('mesa:atendida', manejar('mesa:atendida', async (p) => {
    const extra = esEventIdValido(p.eventId) ? { eventId: p.eventId } : {};
    if (!ROLES_ADMIN.includes(socket.data.identidad.rol)) {
      return fallo('NO_AUTORIZADO', 'Solo el personal de sala puede marcar una mesa como atendida', extra);
    }
    const problema = problemaDelCuerpo(p);
    if (problema) return fallo('PAYLOAD_INVALIDO', problema, extra);

    const { eventId, idMesa, tipo } = p;
    let estado;
    try {
      estado = await ctx.verificadorMesas.estado(idMesa);
    } catch (err) {
      log.warn('mesa:atendida: no se pudo comprobar la mesa', { id_mesa: idMesa, codigo: err.codigo || err.message });
      return fallo('ERROR_INTERNO', 'No se pudo comprobar la mesa; reintenta con el mismo eventId', extra);
    }
    if (estado === 'no_existe') return fallo('PAYLOAD_INVALIDO', 'idMesa no corresponde a ninguna mesa', extra);
    if (estado === 'inactiva') return fallo('PAYLOAD_INVALIDO', 'La mesa está inactiva', extra);

    const clave = `personal:atendida:${idMesa}:${eventId}`;
    if (!(await ctx.registro.reservar(clave))) return exito({ eventId, duplicado: true });
    try {
      ctx.io.to(salaMesa(idMesa)).to(SALA_ADMIN).emit('mesa:atendida', {
        eventId,
        id_mesa: idMesa,
        tipo,
        emitidoEn: new Date().toISOString(),
      });
    } catch (err) {
      try {
        await ctx.registro.liberar(clave);
      } catch (errLiberar) {
        // Sin liberar, el reintento llegará como duplicado: que quede en el log.
        log.error('mesa:atendida: no se pudo liberar el eventId tras fallar la emisión', { error: errLiberar });
      }
      throw err;
    }
    return exito({ eventId, duplicado: false });
  }));
}

module.exports = {
  registrarMesaAtendida, crearVerificadorMesas, problemaDelCuerpo, TIPOS, CACHE_MESA_ACTIVA_MS,
};
