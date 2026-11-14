const pool = require('../config/db');

/**
 * D-20b: vencimiento de los pedidos de la app que siguen en 'por_pagar'.
 *
 * Cada minuto llama a cancelar_por_pagar_vencidos() (script 36), que decide
 * TODO en la base: cancela solo lo que SIGUE en 'por_pagar' pasado su plazo
 * (configuracion_restaurante.minutos_pago_anticipado, 15 por defecto) y salta lo
 * que otra transacción tiene bloqueado (un pago en curso, SKIP LOCKED). Así
 * por_pagar -> recibido y por_pagar -> cancelado nunca pasan los dos. El stock
 * vuelve por el trigger del script 27.
 *
 *   - Sin solaparse: si una pasada sigue corriendo cuando toca la siguiente,
 *     esa se salta (nunca dos a la vez).
 *   - Apagado limpio: el temporizador no retiene el proceso (unref) y
 *     detener() lo cancela y ESPERA la pasada en curso, antes de cerrar el pool.
 *   - Desactivado en las pruebas: solo lo arranca server.js cuando es el
 *     proceso del servidor (como el oyente del canal 'inventario').
 *   - Al log va solo CUÁNTOS pedidos canceló, no cuáles ni de quién.
 */

const INTERVALO_MS = 60 * 1000;

/**
 * @param {object} [opciones]
 * @param {number} [opciones.intervaloMs]
 * @param {() => Promise<number>} [opciones.ejecutar]  una pasada; devuelve cuántos canceló
 * @param {(fn: Function, ms: number) => any} [opciones.programar]  setInterval (las pruebas pasan uno falso)
 * @param {(t: any) => void} [opciones.cancelar]
 * @param {{log: Function, error: Function}} [opciones.registro]
 */
function crearTareaVencimiento(opciones = {}) {
  const intervaloMs = opciones.intervaloMs || INTERVALO_MS;
  const ejecutar = opciones.ejecutar || cancelarVencidos;
  const programar = opciones.programar || ((fn, ms) => {
    const t = setInterval(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  });
  const cancelar = opciones.cancelar || ((t) => clearInterval(t));
  const registro = opciones.registro || console;

  let temporizador = null;
  let enCurso = null;
  const contadores = { pasadas: 0, saltadas: 0, cancelados: 0, fallos: 0 };

  /** Una pasada. Si ya hay una en curso, no lanza otra: devuelve esa. */
  function pasada() {
    if (enCurso) {
      contadores.saltadas += 1;
      return enCurso;
    }
    enCurso = (async () => {
      try {
        const n = await ejecutar();
        contadores.pasadas += 1;
        contadores.cancelados += n;
        if (n > 0) registro.log(`[por_pagar] ${n} pedido(s) vencido(s) cancelado(s)`);
      } catch (err) {
        contadores.fallos += 1;
        // Solo el código: nada de datos de pedidos ni de clientes.
        registro.error(`[por_pagar] no se pudo cancelar los vencidos (${err && err.code})`);
      }
    })().finally(() => {
      enCurso = null;
    });
    return enCurso;
  }

  return {
    pasada,
    /** Arranca el temporizador (idempotente). */
    iniciar() {
      if (temporizador === null) temporizador = programar(() => { pasada(); }, intervaloMs);
    },
    /** Lo detiene y espera la pasada en curso, si la hay. */
    async detener() {
      if (temporizador !== null) {
        cancelar(temporizador);
        temporizador = null;
      }
      if (enCurso) await enCurso;
    },
    estado() {
      return { activo: temporizador !== null, enCurso: enCurso !== null, ...contadores };
    },
  };
}

/** La pasada real: la base decide qué vence. Devuelve cuántos canceló. */
async function cancelarVencidos() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM cancelar_por_pagar_vencidos() AS c(id_pedido)');
  return rows[0].n;
}

/** La tarea del proceso del servidor (la arranca y detiene server.js). */
const tarea = crearTareaVencimiento();

module.exports = { crearTareaVencimiento, cancelarVencidos, tarea, INTERVALO_MS };
