const { exito, fallo, manejar } = require('./ack');
const { ROL_COMENSAL } = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa, SALA_ADMIN, estaEnMesa } = require('./salas');

const MAX_MOTIVO = 100;
// Una mesa puede llamar al mesero una vez por minuto: suficiente para pedir
// ayuda de verdad y corta el abuso de un comensal que pulsa sin parar.
const LIMITE_LLAMADA_SEG = 60;

/** Estado de sala por mesa en memoria (desarrollo y pruebas, sin REDIS_URL). */
function crearEstadoMesasMemoria({ ahora = Date.now } = {}) {
  const llamadas = new Map(); // idMesa -> ms en que vence el bloqueo
  return {
    reservarLlamada(idMesa, segundos) {
      if ((llamadas.get(idMesa) || 0) > ahora()) return false;
      llamadas.set(idMesa, ahora() + segundos * 1000);
      return true;
    },
  };
}

/**
 * Comprobaciones comunes de los eventos de sala que emite un comensal:
 * eventId, rol y que esté dentro de la sala de su mesa. La mesa sale del JWT.
 * Devuelve { idMesa } o { error } (un ack de fallo).
 */
function validarComensalEnSala(socket, p) {
  const identidad = socket.data.identidad;
  if (!esEventIdValido(p.eventId)) return { error: fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID') };
  if (identidad.rol !== ROL_COMENSAL) {
    return { error: fallo('NO_AUTORIZADO', 'Solo un comensal puede emitir este evento', { eventId: p.eventId }) };
  }
  const idMesa = identidad.id_mesa;
  if (!estaEnMesa(socket, idMesa)) {
    return { error: fallo('SIN_SALA', 'Haz join:table antes de emitir', { eventId: p.eventId }) };
  }
  return { idMesa };
}

function registrarSala(socket, ctx) {
  /**
   * mesa:llamar_mesero — el comensal pide atención. Va solo al panel.
   * El servidor pone id_mesa (del JWT), comensal y emitidoEn: el cliente no
   * puede hacerse pasar por otra mesa ni por otro comensal.
   */
  socket.on('mesa:llamar_mesero', manejar('mesa:llamar_mesero', async (p) => {
    const { idMesa, error } = validarComensalEnSala(socket, p);
    if (error) return error;
    if (p.motivo !== undefined && p.motivo !== null
      && (typeof p.motivo !== 'string' || p.motivo.length > MAX_MOTIVO)) {
      return fallo('PAYLOAD_INVALIDO', `motivo debe ser un texto de 0 a ${MAX_MOTIVO} caracteres`, { eventId: p.eventId });
    }

    // Primero el duplicado: el reintento de una llamada que SÍ salió no debe
    // chocar con el límite de frecuencia (respondería RATE_LIMIT a algo que
    // ya se entregó).
    const clave = `comensal:llamar:${idMesa}:${p.eventId}`;
    if (await ctx.registro.obtener(clave)) return exito({ eventId: p.eventId, duplicado: true });
    if (!(await ctx.estadoMesas.reservarLlamada(idMesa, LIMITE_LLAMADA_SEG))) {
      return fallo('RATE_LIMIT', `La mesa ya llamó al mesero; espera ${LIMITE_LLAMADA_SEG} s`, { eventId: p.eventId });
    }
    await ctx.registro.guardar(clave, true);

    ctx.io.to(SALA_ADMIN).emit('mesa:llamar_mesero', {
      eventId: p.eventId,
      id_mesa: idMesa,
      comensal: socket.data.alias ?? null,
      motivo: typeof p.motivo === 'string' && p.motivo.trim() ? p.motivo.trim() : null,
      emitidoEn: new Date().toISOString(),
    });
    return exito({ eventId: p.eventId, duplicado: false });
  }));
}

module.exports = {
  registrarSala, crearEstadoMesasMemoria, validarComensalEnSala, LIMITE_LLAMADA_SEG, MAX_MOTIVO,
};
