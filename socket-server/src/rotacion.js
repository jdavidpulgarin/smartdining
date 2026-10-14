const { salaMesa } = require('./salas');
const { log: logPorDefecto } = require('./log');

const INTERVALO_POR_DEFECTO_MS = 3 * 60 * 1000;

/**
 * Rotación automática del QR de mesas abiertas SIN comensales.
 *
 * Por qué: entre que el mesero abre la mesa y llega el primer comensal, el QR
 * está a la vista en la tablet. Si alguien lo fotografía, podría entrar a la
 * mesa más tarde. Rotarlo cada 3 minutos mientras nadie se ha sentado hace
 * inútil esa foto. En cuanto entra el primer comensal el QR queda FIJO hasta
 * que la mesa se libere: así los amigos que llegan después pueden escanear el
 * mismo QR que ya tiene el grupo.
 *
 * Diseño elegido (opción A, ver docs/rotacion-qr.md): el temporizador vive en
 * el socket-server, que es quien conoce la presencia real de la sala y quien
 * firma los QR. El QR nuevo solo se anuncia (qr:actualizado) DESPUÉS de que el
 * backend lo guarde como el vigente de la mesa; si el backend falla, la tablet
 * sigue mostrando el anterior, que sigue siendo válido, y se reintenta en el
 * siguiente ciclo.
 *
 * Dependencias inyectables para pruebas deterministas: `programar/cancelar`
 * (reloj) y `backend` (cliente HTTP).
 */
function crearRotadorQr({
  io, qr, presencia, backend,
  intervaloMs = INTERVALO_POR_DEFECTO_MS,
  programar = (fn, ms) => setTimeout(fn, ms),
  cancelar = (h) => clearTimeout(h),
  log = logPorDefecto,
}) {
  // idMesa -> { temporizador, tokenActual } solo para mesas abiertas y aún sin comensales.
  const mesas = new Map();
  const habilitado = Boolean(backend);

  function detener(idMesa) {
    const m = mesas.get(idMesa);
    if (!m) return;
    if (m.temporizador) cancelar(m.temporizador);
    mesas.delete(idMesa);
  }

  function siguiente(idMesa) {
    const m = mesas.get(idMesa);
    if (!m) return;
    const h = programar(() => { ciclo(idMesa).catch((err) => log.error?.('rotación: falló el ciclo', { id_mesa: idMesa, error: err })); }, intervaloMs);
    if (h && h.unref) h.unref(); // no impide el cierre ordenado del proceso
    m.temporizador = h;
  }

  async function ciclo(idMesa) {
    const m = mesas.get(idMesa);
    if (!m) return;
    m.temporizador = null;

    // Se comprueba en el momento de rotar, con los sockets reales de la sala.
    const { total } = await presencia.calcular(idMesa);
    if (total > 0) {
      detener(idMesa); // ya hay alguien sentado: el QR queda fijo
      return;
    }

    const nuevo = qr.generar(idMesa);
    let r;
    try {
      r = await backend.post(`/api/mesas/${idMesa}/token-qr/interno`, {
        token_qr: nuevo.token,
        token_anterior: m.tokenActual,
      });
    } catch (err) {
      log.error?.('rotación: backend sin respuesta; se reintenta', { id_mesa: idMesa, codigo: err.codigo || err.message });
      siguiente(idMesa);
      return;
    }
    if (!mesas.has(idMesa)) return; // se liberó o se fijó mientras esperábamos

    if (r.ok) {
      m.tokenActual = nuevo.token;
      io.to(salaMesa(idMesa)).emit('qr:actualizado', {
        id_mesa: idMesa,
        token_qr: nuevo.token,
        emitidoEn: new Date().toISOString(),
      });
      siguiente(idMesa);
      return;
    }
    if (r.status === 409 || r.status === 404) {
      // La mesa ya no está ocupada, o alguien rotó el QR a mano: el backend
      // manda. Se deja de rotar hasta la próxima apertura.
      detener(idMesa);
      return;
    }
    log.error?.('rotación: el backend respondió error; se reintenta', { id_mesa: idMesa, status: r.status });
    siguiente(idMesa);
  }

  return {
    habilitado,
    /** La mesa abrió sesión con este token: empieza a contar. */
    abrir(idMesa, tokenActual = null) {
      if (!habilitado) return;
      detener(idMesa);
      mesas.set(idMesa, { temporizador: null, tokenActual });
      siguiente(idMesa);
    },
    /** Entró el primer comensal: el QR queda fijo hasta liberar la mesa. */
    fijar: detener,
    /** La mesa se liberó. */
    cerrar: detener,
    /** Para el cierre ordenado del servidor. */
    detenerTodo() { for (const id of [...mesas.keys()]) detener(id); },
    activa: (idMesa) => mesas.has(idMesa),
    ciclo, // expuesto para pruebas
  };
}

module.exports = { crearRotadorQr, INTERVALO_POR_DEFECTO_MS };
