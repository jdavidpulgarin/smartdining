const { exito, fallo, manejar } = require('./ack');
const { ROL_COMENSAL } = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const { salaMesa, SALA_ADMIN, estaEnMesa } = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

const MAX_MOTIVO = 100;
// Como mucho un aviso de presencia por mesa cada 500 ms: cuando llega un grupo
// de 6 y todos escanean a la vez, el panel recibe 1-2 avisos y no 6.
const VENTANA_PRESENCIA_MS = 500;
const PREFIJO_SALA_MESA = 'room:mesa-';

/**
 * Presencia de comensales por mesa, calculada de los sockets que de verdad
 * están en la sala (no de un contador que se pueda desincronizar).
 *
 * - comensales: alias distintos de los comensales conectados, ordenados.
 * - total: personas en la mesa = alias distintos + sockets de comensal sin
 *   alias (dos pestañas de "Ana" cuentan como una persona).
 *
 * `programar(idMesa)` emite `mesa:presencia` a room:admin al instante si no
 * hubo aviso reciente; si lo hubo, deja uno pendiente para el final de la
 * ventana, así el último estado siempre llega.
 */
function crearPresencia({ io, ventanaMs = VENTANA_PRESENCIA_MS }) {
  const ventanas = new Map(); // idMesa -> { pendiente: boolean, temporizador }

  async function calcular(idMesa) {
    const sockets = await io.in(salaMesa(idMesa)).fetchSockets();
    const alias = new Set();
    let anonimos = 0;
    for (const s of sockets) {
      if (!s.data.identidad || s.data.identidad.rol !== ROL_COMENSAL) continue;
      if (s.data.alias) alias.add(s.data.alias);
      else anonimos += 1;
    }
    const comensales = [...alias].sort((a, b) => a.localeCompare(b));
    return { id_mesa: idMesa, comensales, total: comensales.length + anonimos };
  }

  async function emitir(idMesa) {
    const presencia = await calcular(idMesa);
    io.to(SALA_ADMIN).emit('mesa:presencia', presencia);
  }

  function abrirVentana(idMesa) {
    const v = { pendiente: false, temporizador: null };
    v.temporizador = setTimeout(() => {
      ventanas.delete(idMesa);
      if (v.pendiente) programar(idMesa);
    }, ventanaMs);
    // No mantiene vivo el proceso por un aviso de presencia (cierre ordenado).
    if (v.temporizador.unref) v.temporizador.unref();
    ventanas.set(idMesa, v);
  }

  function programar(idMesa) {
    const v = ventanas.get(idMesa);
    if (v) {
      v.pendiente = true;
      return;
    }
    abrirVentana(idMesa);
    emitir(idMesa).catch((err) => console.error('[presencia] no se pudo emitir:', err.message));
  }

  return { calcular, programar };
}
// Una mesa puede llamar al mesero una vez por minuto: suficiente para pedir
// ayuda de verdad y corta el abuso de un comensal que pulsa sin parar.
const LIMITE_LLAMADA_SEG = 60;

/** Estado de sala por mesa en memoria (desarrollo y pruebas, sin REDIS_URL). */
function crearEstadoMesasMemoria({ ahora = Date.now } = {}) {
  const llamadas = new Map(); // idMesa -> ms en que vence el bloqueo
  const cuentas = new Set(); // mesas que pidieron la cuenta
  return {
    marcarCuenta(idMesa) { cuentas.add(idMesa); },
    cuentaSolicitada(idMesa) { return cuentas.has(idMesa); },
    limpiarMesa(idMesa) {
      cuentas.delete(idMesa);
      llamadas.delete(idMesa);
    },
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
  // Al desconectarse, el socket ya no está en ninguna sala: se anotan sus
  // mesas mientras aún está dentro ('disconnecting') y se avisa después.
  let mesasAlSalir = [];
  socket.on('disconnecting', () => {
    if (!socket.data.identidad || socket.data.identidad.rol !== ROL_COMENSAL) return;
    mesasAlSalir = [...socket.rooms]
      .filter((r) => r.startsWith(PREFIJO_SALA_MESA))
      .map((r) => Number(r.slice(PREFIJO_SALA_MESA.length)));
  });
  socket.on('disconnect', () => {
    for (const idMesa of mesasAlSalir) ctx.presencia.programar(idMesa);
  });

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

  /**
   * cuenta:solicitada — el comensal pide la cuenta. Llega al panel (para que
   * el cajero se acerque) y a la propia mesa (para que los demás comensales lo
   * vean). Queda marcada en sd:mesa:{ID}:cuenta hasta que la mesa se libere.
   */
  socket.on('cuenta:solicitada', manejar('cuenta:solicitada', async (p) => {
    const { idMesa, error } = validarComensalEnSala(socket, p);
    if (error) return error;

    if (!(await ctx.registro.reservar(`comensal:cuenta:${idMesa}:${p.eventId}`))) {
      return exito({ eventId: p.eventId, duplicado: true });
    }
    await ctx.estadoMesas.marcarCuenta(idMesa);

    ctx.io.to(SALA_ADMIN).to(salaMesa(idMesa)).emit('cuenta:solicitada', {
      eventId: p.eventId,
      id_mesa: idMesa,
      comensal: socket.data.alias ?? null,
      emitidoEn: new Date().toISOString(),
    });
    return exito({ eventId: p.eventId, duplicado: false });
  }));
}

/**
 * Rutas internas de sala (solo backend, con x-internal-key).
 *
 * POST /internal/ingrediente-disponibilidad — un ingrediente se agotó o volvió.
 * Se difunde a TODOS los sockets: es información pública del menú y le sirve
 * a cada mesa (el constructor deshabilita la opción en vivo), a la cocina y al
 * panel. Solo se reenvían los dos campos validados.
 */
const rutasSala = {
  'POST /internal/ingrediente-disponibilidad': async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    if (!Number.isSafeInteger(cuerpo.id_ingrediente) || cuerpo.id_ingrediente <= 0) {
      throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'id_ingrediente debe ser un entero positivo');
    }
    if (typeof cuerpo.disponible !== 'boolean') {
      throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'disponible debe ser true o false');
    }
    // eventId opcional: si el backend reintenta el mismo aviso, no se repite.
    if (cuerpo.eventId !== undefined) {
      if (!esEventIdValido(cuerpo.eventId)) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
      if (!(await ctx.registro.reservar(`backend:ingrediente:${cuerpo.eventId}`))) {
        return enviarJson(res, 200, { ok: true, duplicado: true });
      }
    }
    ctx.io.emit('ingrediente:disponibilidad', {
      id_ingrediente: cuerpo.id_ingrediente,
      disponible: cuerpo.disponible,
      emitidoEn: new Date().toISOString(),
    });
    return enviarJson(res, 200, { ok: true, duplicado: false });
  },
};

module.exports = {
  rutasSala,
  registrarSala, crearEstadoMesasMemoria, crearPresencia, VENTANA_PRESENCIA_MS, validarComensalEnSala, LIMITE_LLAMADA_SEG, MAX_MOTIVO,
};
