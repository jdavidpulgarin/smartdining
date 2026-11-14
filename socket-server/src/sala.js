const { exito, fallo, manejar } = require('./ack');
const { log } = require('./log');
const { ROL_COMENSAL } = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const {
  salaMesa, SALA_ADMIN, ROLES_ADMIN, estaEnMesa,
} = require('./salas');
const {
  ErrorHttp, enviarJson, leerCuerpoCrudo, parsearJson, exigirClaveInterna,
} = require('./http');

const MAX_MOTIVO = 100;
// Como mucho un aviso de presencia por mesa cada 500 ms: cuando llega un grupo
// de 6 y todos escanean a la vez, el panel recibe 1-2 avisos y no 6.
const VENTANA_PRESENCIA_MS = 500;
const PREFIJO_SALA_MESA = 'room:mesa-';
// La presencia inicial sale 500 ms después de conectar: el panel crea el
// socket al renderizar y registra sus listeners después (useEffect). Si sale
// antes, Socket.io la descarta en el cliente porque nadie la escucha todavía.
const RETRASO_PRESENCIA_INICIAL_MS = 500;
// mesa:presencia:solicitar: como mucho una por socket cada 2 s.
const LIMITE_SOLICITUD_PRESENCIA_MS = 2000;
// Periodo de gracia de un comensal que se cae (PRESENCIA_GRACIA_MS, ver
// config.js): un celular que pasa a segundo plano pierde el socket a los ~45 s
// y vuelve al desbloquearse. Durante la gracia sigue sentado para todos.
const PRESENCIA_GRACIA_POR_DEFECTO_MS = 60 * 1000;
// Solo un corte de red da gracia. Salir a propósito ('client namespace
// disconnect'), que lo eche el servidor al liberar la mesa ('server namespace
// disconnect') o el cierre del servidor ('server shutting down') avisan al
// instante, como siempre.
const MOTIVOS_CON_GRACIA = new Set(['transport close', 'transport error', 'ping timeout']);

/**
 * Presencia de comensales por mesa, calculada de los sockets que de verdad
 * están en la sala (no de un contador que se pueda desincronizar).
 *
 * - comensales: alias distintos de los comensales conectados y de los sin
 *   celular, ordenados.
 * - total: personas en la mesa = alias distintos + sockets de comensal sin
 *   alias (dos pestañas de "Ana" cuentan como una persona).
 * - pagaron: alias que ya pagaron algo en esta sesión de mesa (estén o no
 *   sentados), ordenados. Con esto la PWA calcula "igual" como el servidor.
 * - sin_celular: alias que agregó el personal (POST /internal/mesa-comensal),
 *   ordenados; también entran en comensales y en total.
 *
 * `programar(idMesa)` emite `mesa:presencia` a room:admin y a la sala de esa
 * mesa al instante si no hubo aviso reciente; si lo hubo, deja uno pendiente
 * para el final de la ventana, así el último estado siempre llega.
 *
 * Gracia (EVENTS.md §5.2): cuando el socket de un comensal se cae por la red,
 * su alias sigue contando `graciaMs` (en comensales, en total, en la guarda de
 * rotación del QR y en «igual»). Si el mismo comensal (misma mesa y alias)
 * vuelve antes, no se avisa nada; si no, al vencer sale como siempre. Liberar
 * la mesa cancela todas sus gracias. `programarGracia`/`cancelarGracia` son el
 * reloj, inyectable en las pruebas.
 */
function crearPresencia({
  io, estadoMesas, ventanaMs = VENTANA_PRESENCIA_MS, retrasoInicialMs = RETRASO_PRESENCIA_INICIAL_MS,
  graciaMs = PRESENCIA_GRACIA_POR_DEFECTO_MS,
  programarGracia = (fn, ms) => setTimeout(fn, ms),
  cancelarGracia = (h) => clearTimeout(h),
  mesaLiberada = () => false,
}) {
  const ventanas = new Map(); // idMesa -> { pendiente: boolean, temporizador }
  const gracias = new Map(); // idMesa -> Map(alias -> temporizador)

  async function calcular(idMesa) {
    const sockets = await io.in(salaMesa(idMesa)).fetchSockets();
    const alias = new Set();
    let anonimos = 0;
    for (const s of sockets) {
      if (!s.data.identidad || s.data.identidad.rol !== ROL_COMENSAL) continue;
      if (s.data.alias) alias.add(s.data.alias);
      else anonimos += 1;
    }
    // Quien está en su periodo de gracia sigue sentado.
    for (const a of (gracias.get(idMesa) || new Map()).keys()) alias.add(a);
    // Los sin celular (§6.4) cuentan como personas sentadas: van en
    // comensales y en total, así «igual» y la rotación del QR los ven sin
    // lógica aparte.
    const sinCelular = Object.values(await estadoMesas.sinCelular(idMesa)).sort((a, b) => a.localeCompare(b));
    for (const a of sinCelular) alias.add(a);
    const comensales = [...alias].sort((a, b) => a.localeCompare(b));
    const pagaron = await estadoMesas.pagaron(idMesa);
    return {
      id_mesa: idMesa, comensales, total: comensales.length + anonimos, pagaron, sin_celular: sinCelular,
    };
  }

  // A la mesa también: sus comensales necesitan quién está y quién pagó para
  // mostrar cuánto es "igual". Solo llevan datos de esa misma mesa.
  async function emitir(idMesa) {
    const presencia = await calcular(idMesa);
    io.to(SALA_ADMIN).to(salaMesa(idMesa)).emit('mesa:presencia', presencia);
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
    emitir(idMesa).catch((err) => log.error('presencia: no se pudo emitir', { id_mesa: idMesa, error: err }));
  }

  function quitarGracia(idMesa, alias) {
    const porAlias = gracias.get(idMesa);
    if (!porAlias || !porAlias.has(alias)) return false;
    cancelarGracia(porAlias.get(alias));
    porAlias.delete(alias);
    if (porAlias.size === 0) gracias.delete(idMesa);
    return true;
  }

  function iniciarGracia(idMesa, alias) {
    quitarGracia(idMesa, alias);
    let porAlias = gracias.get(idMesa);
    if (!porAlias) { porAlias = new Map(); gracias.set(idMesa, porAlias); }
    const h = programarGracia(() => {
      const actual = gracias.get(idMesa);
      if (!actual || actual.get(alias) !== h) return; // ya volvió o se liberó la mesa
      actual.delete(alias);
      if (actual.size === 0) gracias.delete(idMesa);
      programar(idMesa); // ahora sí: salió de la mesa
    }, graciaMs);
    // No mantiene vivo el proceso (cierre ordenado).
    if (h && h.unref) h.unref();
    porAlias.set(alias, h);
  }

  /**
   * Se cayó el socket de un comensal de `idMesa` (ya fuera de la sala).
   * - Salida a propósito, expulsión o gracia desactivada: aviso al instante.
   * - Si otra pestaña del mismo alias sigue en la sala, nada cambia y no se
   *   avisa. Si no, empieza su gracia (tampoco se avisa: sigue contando).
   */
  async function salirComensal(idMesa, alias, motivo) {
    if (!alias || graciaMs <= 0 || !MOTIVOS_CON_GRACIA.has(motivo) || mesaLiberada(idMesa)) {
      programar(idMesa);
      return;
    }
    const sockets = await io.in(salaMesa(idMesa)).fetchSockets();
    if (sockets.some((s) => s.data.alias === alias && s.data.identidad?.rol === ROL_COMENSAL)) return;
    // La mesa pudo liberarse mientras se consultaba: no se ensucia la sesión siguiente.
    if (mesaLiberada(idMesa)) {
      programar(idMesa);
      return;
    }
    iniciarGracia(idMesa, alias);
  }

  /**
   * El comensal hizo join:table. true si volvía dentro de su gracia: para los
   * demás nunca se fue y no hay que avisar.
   */
  const volverComensal = (idMesa, alias) => quitarGracia(idMesa, alias);

  /** La mesa se liberó: sus gracias no pasan a la sesión siguiente. */
  function cancelarGracias(idMesa) {
    const porAlias = gracias.get(idMesa);
    if (!porAlias) return;
    for (const h of porAlias.values()) cancelarGracia(h);
    gracias.delete(idMesa);
  }

  /** Alias en gracia en esa mesa (para pruebas y diagnóstico). */
  const enGracia = (idMesa) => [...(gracias.get(idMesa) || new Map()).keys()].sort((a, b) => a.localeCompare(b));

  /**
   * Presencia de cada mesa con algo, ordenada por id_mesa.
   *
   * Mesas candidatas, sin consultar al backend:
   * - las salas room:mesa-N de este proceso (hay una sola instancia y no hay
   *   adaptador de Redis para Socket.io);
   * - el índice de mesas con pagos o sin celular anotados, que cubre una mesa
   *   sin ningún socket conectado.
   * Se omiten las vacías (una tablet sola en su sala, o una mesa cerrada):
   * para el panel, que no llegue una mesa es lo mismo que 0 comensales.
   */
  async function listarConEstado() {
    const candidatas = new Set(await estadoMesas.mesasConEstado());
    // Una mesa cuyo único comensal está en gracia ya no tiene sala.
    for (const idMesa of gracias.keys()) candidatas.add(idMesa);
    for (const sala of io.of('/').adapter.rooms.keys()) {
      const m = /^room:mesa-(\d+)$/.exec(sala);
      if (m) candidatas.add(Number(m[1]));
    }
    const presencias = await Promise.all([...candidatas].sort((a, b) => a - b).map(calcular));
    return presencias.filter((p) => p.total > 0 || p.pagaron.length > 0 || p.sin_celular.length > 0);
  }

  /**
   * Envía esa presencia SOLO a `socket` (personal que acaba de conectarse o
   * recargó el panel), un mesa:presencia por mesa. No pasa por programar():
   * ni los demás paneles ni las mesas reciben nada.
   */
  async function enviarInicial(socket) {
    const presencias = await listarConEstado();
    if (!socket.connected) return 0;
    for (const p of presencias) socket.emit('mesa:presencia', p);
    return presencias.length;
  }

  /**
   * Programa enviarInicial a `retrasoInicialMs` de la conexión, para que el
   * panel ya tenga registrados sus listeners. Si el socket se desconecta antes,
   * no se envía nada (ni se calcula). Es el respaldo de quien no usa
   * mesa:presencia:solicitar (EVENTS.md §5.2).
   */
  function programarInicial(socket) {
    const h = setTimeout(() => {
      if (!socket.connected) return;
      enviarInicial(socket)
        .catch((err) => log.error('presencia: no se pudo enviar la inicial', { socket: socket.id, error: err }));
    }, retrasoInicialMs);
    if (h.unref) h.unref(); // no impide el cierre ordenado del proceso
    socket.once('disconnect', () => clearTimeout(h));
  }

  return {
    calcular, programar, listarConEstado, enviarInicial, programarInicial,
    salirComensal, volverComensal, cancelarGracias, enGracia,
  };
}
// Una mesa puede llamar al mesero una vez por minuto: suficiente para pedir
// ayuda de verdad y corta el abuso de un comensal que pulsa sin parar.
const LIMITE_LLAMADA_SEG = 60;
// Igual que sd:mesa:{ID}:sin_celular en Redis (24 h, como pagaron).
const TTL_SIN_CELULAR_MS = 24 * 60 * 60 * 1000;

/** Estado de sala por mesa en memoria (desarrollo y pruebas, sin REDIS_URL). */
function crearEstadoMesasMemoria({ ahora = Date.now } = {}) {
  const llamadas = new Map(); // idMesa -> ms en que vence el bloqueo
  const cuentas = new Set(); // mesas que pidieron la cuenta
  const pagos = new Map(); // idMesa -> Set de alias que ya pagaron
  const sinCelular = new Map(); // idMesa -> { ms en que vence, Map(clave -> alias) }
  // Como sd:mesas:con-estado en Redis: idMesa -> ms en que vence (24 h desde la
  // última vez que se anotó un pago o un sin celular).
  const conEstado = new Map();
  const anotarEnIndice = (idMesa) => conEstado.set(idMesa, ahora() + TTL_SIN_CELULAR_MS);
  const listaSinCelular = (idMesa) => {
    const e = sinCelular.get(idMesa);
    if (e && e.vence <= ahora()) sinCelular.delete(idMesa);
    return sinCelular.get(idMesa);
  };
  return {
    marcarCuenta(idMesa) { cuentas.add(idMesa); },
    cuentaSolicitada(idMesa) { return cuentas.has(idMesa); },
    limpiarMesa(idMesa) {
      cuentas.delete(idMesa);
      llamadas.delete(idMesa);
      pagos.delete(idMesa);
      sinCelular.delete(idMesa);
      conEstado.delete(idMesa);
    },
    /** Mesas con pagos o sin celular anotados que no han vencido, en orden. */
    mesasConEstado() {
      for (const [id, vence] of conEstado) if (vence <= ahora()) conEstado.delete(id);
      return [...conEstado.keys()].sort((a, b) => a - b);
    },
    sinCelular(idMesa) {
      const e = listaSinCelular(idMesa);
      return e ? Object.fromEntries(e.alias) : {};
    },
    agregarSinCelular(idMesa, clave, alias) {
      let e = listaSinCelular(idMesa);
      if (e && e.alias.has(clave)) return false;
      if (!e) { e = { vence: 0, alias: new Map() }; sinCelular.set(idMesa, e); }
      e.alias.set(clave, alias);
      e.vence = ahora() + TTL_SIN_CELULAR_MS; // como EXPIRE en Redis: se renueva al agregar
      anotarEnIndice(idMesa);
      return true;
    },
    quitarSinCelular(idMesa, clave) {
      const e = listaSinCelular(idMesa);
      if (!e || !e.alias.delete(clave)) return false;
      if (e.alias.size === 0) sinCelular.delete(idMesa);
      return true;
    },
    marcarPago(idMesa, alias) {
      if (!pagos.has(idMesa)) pagos.set(idMesa, new Set());
      pagos.get(idMesa).add(alias);
      anotarEnIndice(idMesa);
    },
    /** Deshace un marcarPago que llegó tarde a una mesa ya liberada (ver anotarPagoEnSesion en pagos.js). */
    desmarcarPago(idMesa, alias) {
      const p = pagos.get(idMesa);
      if (p) p.delete(alias);
      if (p && p.size === 0) pagos.delete(idMesa);
      if (!pagos.has(idMesa) && !listaSinCelular(idMesa)) conEstado.delete(idMesa);
    },
    pagaron(idMesa) { return [...(pagos.get(idMesa) || [])].sort((a, b) => a.localeCompare(b)); },
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
  socket.on('disconnect', (motivo) => {
    for (const idMesa of mesasAlSalir) {
      ctx.presencia.salirComensal(idMesa, socket.data.alias, motivo)
        .catch((err) => log.error('presencia: no se pudo procesar la salida', { id_mesa: idMesa, error: err }));
    }
  });

  /**
   * mesa:presencia:solicitar — el panel pide la presencia de todas las mesas
   * con algo y la recibe EN EL ACK ({ ok, mesas: [...] }), sin eventos sueltos:
   * no depende de que sus listeners estén registrados. Se recomienda en cada
   * 'connect' (EVENTS.md §5.2). Solo personal (admin, mesero, cajero), y como
   * mucho una vez cada 2 s por socket: si se excede, no se calcula nada.
   */
  let ultimaSolicitudPresencia = 0;
  socket.on('mesa:presencia:solicitar', manejar('mesa:presencia:solicitar', async () => {
    const { rol } = socket.data.identidad;
    if (!ROLES_ADMIN.includes(rol)) {
      return fallo('NO_AUTORIZADO', 'Solo el personal de sala puede pedir la presencia de las mesas');
    }
    const ahora = Date.now();
    if (ahora - ultimaSolicitudPresencia < LIMITE_SOLICITUD_PRESENCIA_MS) {
      return fallo('RATE_LIMIT', `Máximo una solicitud de presencia cada ${LIMITE_SOLICITUD_PRESENCIA_MS / 1000} s`);
    }
    ultimaSolicitudPresencia = ahora;
    return exito({ mesas: await ctx.presencia.listarConEstado() });
  }));

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
 * Ruta interna "algo del menú se agotó o volvió" (solo backend, con
 * x-internal-key). Se difunde a TODOS los sockets: es información pública del
 * menú y le sirve a cada mesa, a la cocina y al panel. Solo se reenvían el id
 * y `disponible` validados; cualquier otro campo del cuerpo se descarta.
 *
 * - campoId: nombre del id en el cuerpo y en el evento (id_ingrediente, id_plato).
 * - evento: evento de socket que se emite.
 * - prefijo: clave de idempotencia por eventId (backend:{prefijo}:{eventId}).
 */
function rutaDisponibilidad({ campoId, evento, prefijo }) {
  return async (req, res, ctx) => {
    exigirClaveInterna(req, ctx.config);
    const cuerpo = parsearJson(await leerCuerpoCrudo(req));
    if (!Number.isSafeInteger(cuerpo[campoId]) || cuerpo[campoId] <= 0) {
      throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', `${campoId} debe ser un entero positivo`);
    }
    if (typeof cuerpo.disponible !== 'boolean') {
      throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'disponible debe ser true o false');
    }
    // eventId opcional: si el backend reintenta el mismo aviso, no se repite.
    if (cuerpo.eventId !== undefined) {
      if (!esEventIdValido(cuerpo.eventId)) throw new ErrorHttp(400, 'PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
      if (!(await ctx.registro.reservar(`backend:${prefijo}:${cuerpo.eventId}`))) {
        return enviarJson(res, 200, { ok: true, duplicado: true });
      }
    }
    ctx.io.emit(evento, {
      [campoId]: cuerpo[campoId],
      disponible: cuerpo.disponible,
      emitidoEn: new Date().toISOString(),
    });
    return enviarJson(res, 200, { ok: true, duplicado: false });
  };
}

const MAX_NOMBRE_INSUMO = 80;
const MAX_UNIDAD_INSUMO = 15;

// Se cuentan caracteres (puntos de código), como VARCHAR en PostgreSQL, y no
// unidades UTF-16: un nombre de 80 caracteres con tildes o emoji que la base
// aceptó no se rechaza aquí.
const esTextoDe1a = (v, max) => typeof v === 'string' && v.length > 0 && [...v].length <= max;
// Solo números JSON: el texto ("450.00", lo que da pg con NUMERIC) se rechaza
// para que el error salga en el backend y no en el panel.
const esCantidadValida = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Valida el cuerpo de /internal/inventario-alerta (EVENTS.md §5.5); lanza 400 si no cumple. */
function validarAvisoInventario(c) {
  const invalido = (mensaje) => new ErrorHttp(400, 'PAYLOAD_INVALIDO', mensaje);
  if (!Number.isSafeInteger(c.id_insumo) || c.id_insumo <= 0) throw invalido('id_insumo debe ser un entero positivo');
  if (!esTextoDe1a(c.nombre, MAX_NOMBRE_INSUMO)) throw invalido(`nombre debe tener de 1 a ${MAX_NOMBRE_INSUMO} caracteres`);
  if (!esTextoDe1a(c.unidad, MAX_UNIDAD_INSUMO)) throw invalido(`unidad debe tener de 1 a ${MAX_UNIDAD_INSUMO} caracteres`);
  if (!esCantidadValida(c.stock_actual)) throw invalido('stock_actual debe ser un número ≥ 0');
  if (!esCantidadValida(c.stock_minimo)) throw invalido('stock_minimo debe ser un número ≥ 0');
  if (!esEventIdValido(c.eventId)) throw invalido('eventId debe ser un UUID');
}

/**
 * POST /internal/inventario-alerta (EVENTS.md §5.5) — un insumo cruzó su stock
 * mínimo hacia abajo. Lo llama el backend (D-17); cuándo avisar lo decide él,
 * aquí solo se valida y se retransmite.
 *
 * Se emite SOLO a room:admin (admin, mesero, cajero): ni las mesas ni la cocina
 * deben ver el inventario. Solo viajan los campos validados; `agotado` y
 * `emitidoEn` los pone este servidor.
 *
 * Idempotencia: todo se valida ANTES de reservar (un 4xx no consume el
 * eventId). Si la emisión falla, se libera la reserva y se responde 500
 * ERROR_INTERNO, que el backend reintenta con el mismo eventId.
 */
async function rutaInventarioAlerta(req, res, ctx) {
  exigirClaveInterna(req, ctx.config);
  const cuerpo = parsearJson(await leerCuerpoCrudo(req));
  validarAvisoInventario(cuerpo);

  const clave = `backend:inventario-alerta:${cuerpo.eventId}`;
  if (!(await ctx.registro.reservar(clave))) return enviarJson(res, 200, { ok: true, duplicado: true });
  try {
    ctx.io.to(SALA_ADMIN).emit('inventario:alerta', {
      eventId: cuerpo.eventId,
      id_insumo: cuerpo.id_insumo,
      nombre: cuerpo.nombre,
      unidad: cuerpo.unidad,
      stock_actual: cuerpo.stock_actual,
      stock_minimo: cuerpo.stock_minimo,
      agotado: cuerpo.stock_actual === 0,
      emitidoEn: new Date().toISOString(),
    });
  } catch (err) {
    try {
      await ctx.registro.liberar(clave);
    } catch (errLiberar) {
      // Sin liberar, el reintento llegará como duplicado: que quede en el log.
      log.error('inventario-alerta: no se pudo liberar el eventId tras fallar la emisión', { error: errLiberar });
    }
    throw err;
  }
  return enviarJson(res, 200, { ok: true, duplicado: false });
}

/**
 * Rutas internas de sala (solo backend, con x-internal-key).
 *
 * POST /internal/ingrediente-disponibilidad — un ingrediente se agotó o volvió
 * (el constructor de la PWA deshabilita la opción en vivo).
 * POST /internal/plato-disponibilidad — un plato se agotó o volvió (lo llama el
 * backend después del COMMIT de PATCH /api/platos/:id/disponible).
 * POST /internal/inventario-alerta — un insumo cruzó su mínimo (D-17); solo al panel.
 */
const rutasSala = {
  'POST /internal/inventario-alerta': rutaInventarioAlerta,
  'POST /internal/ingrediente-disponibilidad': rutaDisponibilidad({
    campoId: 'id_ingrediente', evento: 'ingrediente:disponibilidad', prefijo: 'ingrediente',
  }),
  'POST /internal/plato-disponibilidad': rutaDisponibilidad({
    campoId: 'id_plato', evento: 'plato:disponibilidad', prefijo: 'plato',
  }),
};

module.exports = {
  rutasSala, MAX_NOMBRE_INSUMO, MAX_UNIDAD_INSUMO,
  registrarSala, crearEstadoMesasMemoria, crearPresencia, VENTANA_PRESENCIA_MS, PRESENCIA_GRACIA_POR_DEFECTO_MS, MOTIVOS_CON_GRACIA, RETRASO_PRESENCIA_INICIAL_MS, LIMITE_SOLICITUD_PRESENCIA_MS, validarComensalEnSala, LIMITE_LLAMADA_SEG, MAX_MOTIVO,
};
