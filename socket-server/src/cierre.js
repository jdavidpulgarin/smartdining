const { log: logPorDefecto } = require('./log');

const ESPERA_MAX_MS = 10 * 1000;

/**
 * Trabajo en curso (manejadores de eventos de socket y peticiones HTTP, como
 * el webhook de pagos). Lo usan ack.manejar y http.crearRouter; el cierre
 * ordenado espera a que llegue a cero antes de cortar.
 */
function crearEnCurso() {
  let cantidad = 0;
  const esperando = new Set();
  return {
    iniciar() { cantidad += 1; },
    terminar() {
      cantidad = Math.max(0, cantidad - 1);
      if (cantidad === 0) for (const r of esperando) r();
    },
    get cantidad() { return cantidad; },
    /** Resuelve true cuando no queda nada en curso, o false si venció el plazo. */
    esperarVacio(ms) {
      if (cantidad === 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        const listo = () => { clearTimeout(t); esperando.delete(listo); resolve(true); };
        const t = setTimeout(() => { esperando.delete(listo); resolve(false); }, ms);
        esperando.add(listo);
      });
    },
  };
}

// Uno por proceso: hay un solo servidor por proceso en producción.
const enCurso = crearEnCurso();

/**
 * Cierre ordenado (SIGTERM de Docker o del despliegue, Ctrl+C en desarrollo):
 *  1. deja de aceptar conexiones y peticiones nuevas;
 *  2. espera los acks y peticiones en curso, máximo 10 s (un webhook a medio
 *     registrar no debe cortarse: Wompi recibiría un error y el pago quedaría
 *     a medias hasta su reintento);
 *  3. cierra los sockets (los clientes reconectan a la instancia nueva y
 *     recuperan el estado de Redis), detiene la rotación de QR y cierra Redis.
 * Idempotente: dos señales seguidas comparten el mismo cierre.
 */
function crearCierreOrdenado({
  httpServer, io, ctx, esperaMaxMs = ESPERA_MAX_MS, log = logPorDefecto, trabajo = enCurso,
}) {
  let promesa = null;

  async function ejecutar(motivo) {
    log.info('cierre ordenado iniciado', { motivo, en_curso: trabajo.cantidad });
    ctx.cerrando = true;
    // Sin conexiones TCP nuevas; las abiertas siguen hasta terminar.
    httpServer.close(() => {});
    const vacio = await trabajo.esperarVacio(esperaMaxMs);
    if (!vacio) log.warn('cierre: se agotó la espera con trabajo en curso', { en_curso: trabajo.cantidad, espera_ms: esperaMaxMs });
    if (ctx.rotador) ctx.rotador.detenerTodo();
    await new Promise((resolve) => { io.close(() => resolve()); });
    if (ctx.redis) {
      try {
        await ctx.redis.cerrar();
      } catch (err) {
        log.error('cierre: no se pudo cerrar Redis', { error: err });
      }
    }
    log.info('cierre ordenado terminado', { motivo });
    return { vacio };
  }

  return {
    cerrar(motivo = 'manual') {
      if (!promesa) promesa = ejecutar(motivo);
      return promesa;
    },
  };
}

module.exports = {
  crearCierreOrdenado, crearEnCurso, enCurso, ESPERA_MAX_MS,
};
