/**
 * Cola de avisos de stock hacia el socket-server: reintentos y "el último gana".
 *
 * La usa el oyente del canal `inventario` (services/inventario-avisos.js) para
 * los avisos de disponibilidad de platos y opciones y para las alertas de stock
 * bajo, y también la emisión de la carta entera al arrancar.
 *
 * POR QUÉ UNA COLA Y NO UN REINTENTO POR AVISO
 * -------------------------------------------
 * Un aviso de disponibilidad es un ESTADO ("el plato 5 está agotado"), no un
 * suceso. Si cada aviso se reintentara por su cuenta, un "agotado" que falló y
 * se reintenta tarde podría llegar DESPUÉS de un "repuesto" más nuevo que sí
 * salió, y dejar el plato agotado en todas las mesas por error. Por eso:
 *
 *   - Hay UNA entrada pendiente por clave (`plato:5`, `ingrediente:7`,
 *     `alerta:12`), y guarda SOLO el último estado. Un aviso nuevo de la misma
 *     clave REEMPLAZA al pendiente: el viejo ya no se manda nunca (eso es
 *     "cancelar su reintento").
 *   - Los envíos van de UNO EN UNO (nunca dos a la vez, nunca dos reintentos a
 *     la vez), así que un aviso de una clave no puede adelantar a otro de la
 *     misma clave en la red.
 *   - Si mientras un aviso está en vuelo llega uno más nuevo de su clave, al
 *     terminar el envío la entrada nueva NO se borra: sale a continuación.
 *
 * Y cada envío (también cada reintento) lleva un eventId NUEVO: lo genera el
 * notificador en cada llamada. El socket-server deduplica por eventId, así que
 * reutilizar el del intento anterior haría que descartara justo el reintento
 * que sí le llega, si el primero llegó a medias (lo procesó pero la respuesta
 * se perdió por un timeout). Con uno nuevo, en el peor caso las mesas reciben
 * dos veces el MISMO estado, que es inofensivo: un estado aplicado dos veces es
 * el mismo estado.
 *
 * REINTENTOS
 * ----------
 * Se reintenta ante errores de RED (el socket-server no está levantado, cortó la
 * conexión, DNS, o no contestó a tiempo: `INALCANZABLE` / `TIMEOUT` del
 * notificador) y ante cualquier 5xx. Un 4xx NO: es un aviso mal armado o una
 * clave que no coincide, y repetirlo da el mismo 4xx; se registra y se
 * descarta. `SIN_CONFIGURAR` (sin SOCKET_URL o sin clave) tampoco: el tiempo
 * real está apagado a propósito.
 *
 * La espera crece 1 s, 2 s, 4 s… hasta un tope (30 s por defecto), con un
 * margen al azar de ±20 % para que varios backends no reintenten todos en el
 * mismo instante. Hay UN solo temporizador para toda la cola, con `unref()`
 * (no retiene el proceso: es trabajo de fondo que se puede abandonar al
 * apagar) y se cancela al detener. Si el socket-server está caído, cada pasada
 * hace UN intento (el aviso más viejo) y, si falla, vuelve a esperar: con el
 * servidor caído no tiene sentido gastar un timeout por cada clave.
 *
 * Cuando un envío sale bien después de fallos, el socket-server volvió: se
 * vacía la cola entera en esa misma pasada, cada aviso con su estado más
 * reciente.
 *
 * Un aviso nuevo no espera al temporizador: intenta en el acto. Si sale bien,
 * el servidor volvió y se vacía todo sin esperar los 30 s; si falla, la espera
 * sigue creciendo hasta el tope.
 *
 * LÍMITE
 * ------
 * Como mucho `maxClaves` claves pendientes (500 por defecto). Con el
 * socket-server caído mucho tiempo la cola no crece sin fin: si llega una clave
 * nueva con la cola llena se descarta la entrada MÁS VIEJA (la que lleva más
 * sin actualizarse) y se registra. Una clave que se actualiza pasa al final.
 *
 * SIN REINTENTOS HASTA QUE ALGUIEN LOS ACTIVE
 * -------------------------------------------
 * La cola nace con los reintentos apagados: cada aviso se intenta UNA vez,
 * como antes. Los enciende `inventario-avisos.iniciar()`, que solo llama
 * server.js cuando el proceso es el servidor. Así una prueba que llama a
 * `manejarAviso` no deja temporizadores ni reintentos de fondo, salvo que la
 * prueba los active a propósito.
 */

const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 30000;
const MAX_CLAVES = 500;
/** Margen al azar de la espera: ±20 %. */
const JITTER = 0.2;

/** Entero positivo de una variable de entorno, o el valor por defecto. */
function enteroPositivo(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

/** La configuración de .env (todas opcionales). */
function configuracionDelEntorno(env = process.env) {
  const esperaInicialMs = enteroPositivo(env.AVISOS_STOCK_REINTENTO_INICIAL_MS, ESPERA_INICIAL_MS);
  return {
    esperaInicialMs,
    esperaMaximaMs: Math.max(esperaInicialMs, enteroPositivo(env.AVISOS_STOCK_REINTENTO_MAX_MS, ESPERA_MAXIMA_MS)),
    maxClaves: enteroPositivo(env.AVISOS_STOCK_COLA_MAX, MAX_CLAVES),
  };
}

/**
 * Qué hacer con el resultado de un envío del notificador.
 *
 * @returns {'ok'|'apagado'|'rechazado'|'reintentar'}
 */
function clasificar(resultado) {
  if (resultado && resultado.ok) return 'ok';
  const motivo = resultado && resultado.motivo;
  if (motivo === 'SIN_CONFIGURAR') return 'apagado';
  if (typeof motivo === 'string' && /^HTTP_4\d\d$/.test(motivo)) return 'rechazado';
  // HTTP_5xx, TIMEOUT, INALCANZABLE, una excepción o algo que no se entiende:
  // nada de eso dice que el aviso esté mal, así que se vuelve a intentar.
  return 'reintentar';
}

/** El código que va al log: el motivo y, si es de red, el código del sistema. */
function codigoDelFallo(resultado) {
  if (!resultado) return 'SIN_RESPUESTA';
  return resultado.codigo ? `${resultado.motivo}/${resultado.codigo}` : String(resultado.motivo);
}

/** Temporizador de verdad, sin retener el proceso. */
function programarReal(fn, ms) {
  const t = setTimeout(fn, ms);
  if (t && typeof t.unref === 'function') t.unref();
  return t;
}

/**
 * @param {object} [opciones]
 * @param {number} [opciones.esperaInicialMs]
 * @param {number} [opciones.esperaMaximaMs]
 * @param {number} [opciones.maxClaves]
 * @param {(fn: Function, ms: number) => any} [opciones.programar]  temporizador (las pruebas pasan uno falso)
 * @param {(t: any) => void} [opciones.cancelar]
 * @param {() => number} [opciones.aleatorio]  entre 0 y 1, para el jitter
 * @param {boolean} [opciones.reintentos]  si nace con los reintentos encendidos
 */
function crearColaAvisos(opciones = {}) {
  const config = { ...configuracionDelEntorno(), ...definidas(opciones) };
  const programar = opciones.programar || programarReal;
  const cancelar = opciones.cancelar || ((t) => clearTimeout(t));
  const aleatorio = opciones.aleatorio || Math.random;

  /** clave -> { enviar } ; el orden del Map es el de antigüedad. */
  const pendientes = new Map();
  let reintentos = Boolean(opciones.reintentos);
  let temporizador = null;
  let drenando = null;
  let fallosSeguidos = 0;
  const contadores = { emitidos: 0, fallidos: 0, rechazados: 0, descartadosPorLimite: 0 };

  /** Espera del reintento número `n` (1, 2, 3…), con tope y jitter. */
  function esperaDelReintento(n) {
    const base = Math.min(config.esperaMaximaMs, config.esperaInicialMs * 2 ** (n - 1));
    const conJitter = base * (1 - JITTER + 2 * JITTER * aleatorio());
    return Math.round(Math.min(config.esperaMaximaMs, conJitter));
  }

  function cancelarTemporizador() {
    if (temporizador !== null) {
      cancelar(temporizador);
      temporizador = null;
    }
  }

  function programarReintento(resultado) {
    if (temporizador !== null) return; // nunca dos esperando a la vez
    const ms = esperaDelReintento(fallosSeguidos);
    console.error(
      `[inventario] el socket-server no tomo un aviso de stock (${codigoDelFallo(resultado)}); `
        + `${pendientes.size} pendientes, reintento en ${ms} ms`
    );
    temporizador = programar(() => {
      temporizador = null;
      drenar();
    }, ms);
  }

  /** Quita la entrada si sigue siendo ESA (no la reemplazó una más nueva). */
  function quitarSiSigue(clave, entrada) {
    if (pendientes.get(clave) === entrada) pendientes.delete(clave);
  }

  async function pasada() {
    while (pendientes.size > 0) {
      const [clave, entrada] = pendientes.entries().next().value;

      let resultado;
      try {
        resultado = await entrada.enviar();
      } catch {
        // El notificador no lanza; esto es una red de seguridad. Sin mensaje
        // en el log: solo el código.
        resultado = { ok: false, motivo: 'EXCEPCION' };
      }

      const decision = clasificar(resultado);
      if (decision === 'ok') {
        quitarSiSigue(clave, entrada);
        contadores.emitidos += 1;
        if (fallosSeguidos > 0) {
          console.log(`[inventario] el socket-server volvio: se emiten ${pendientes.size} avisos de stock pendientes`);
        }
        fallosSeguidos = 0;
        continue;
      }
      if (decision === 'apagado') {
        quitarSiSigue(clave, entrada);
        continue;
      }
      if (decision === 'rechazado') {
        quitarSiSigue(clave, entrada);
        contadores.rechazados += 1;
        console.error(`[inventario] el socket-server rechazo un aviso de stock (${codigoDelFallo(resultado)}): no se reintenta`);
        continue;
      }

      // Reintentar.
      contadores.fallidos += 1;
      fallosSeguidos += 1;
      if (!reintentos) {
        // Sin reintentos (pruebas, o tras detener): un solo intento, como antes.
        quitarSiSigue(clave, entrada);
        continue;
      }
      programarReintento(resultado);
      return;
    }
  }

  /**
   * Manda lo pendiente. Si ya hay una pasada en marcha devuelve ESA (nunca dos
   * a la vez): lo que se encole mientras tanto lo recoge su bucle.
   */
  function drenar() {
    if (drenando) return drenando;
    cancelarTemporizador();
    drenando = pasada().finally(() => {
      drenando = null;
    });
    return drenando;
  }

  /**
   * Guarda el último estado de una clave (reemplazando el pendiente, si lo
   * había) y lo intenta enviar.
   *
   * @param {string} clave  `tipo:id`
   * @param {() => Promise<{ok: boolean, motivo?: string}>} enviar  hace UN envío con eventId nuevo
   * @returns {Promise<void>} la pasada que lo manda (o la que estaba en marcha)
   */
  function encolar(clave, enviar) {
    if (pendientes.has(clave)) {
      // El último gana, y pasa al final: es la entrada más reciente.
      pendientes.delete(clave);
    } else if (pendientes.size >= config.maxClaves) {
      const masVieja = pendientes.keys().next().value;
      pendientes.delete(masVieja);
      contadores.descartadosPorLimite += 1;
      console.error(
        `[inventario] cola de avisos de stock llena (${config.maxClaves}): se descarta el mas viejo `
          + `(${contadores.descartadosPorLimite} descartados en total)`
      );
    }
    pendientes.set(clave, { enviar });
    return drenar();
  }

  return {
    encolar,
    drenar,
    /** Enciende los reintentos (lo hace iniciar()). */
    activar() {
      reintentos = true;
    },
    /** Apaga los reintentos, cancela el temporizador y olvida lo pendiente. */
    detener() {
      reintentos = false;
      cancelarTemporizador();
      pendientes.clear();
      fallosSeguidos = 0;
    },
    /** Para pruebas y logs. */
    estado() {
      return {
        pendientes: [...pendientes.keys()],
        reintentos,
        esperando: temporizador !== null,
        enVuelo: drenando !== null,
        fallosSeguidos,
        ...contadores,
      };
    },
    esperaDelReintento,
    config,
  };
}

/** Solo las opciones que vienen definidas, para no pisar las del entorno con undefined. */
function definidas(opciones) {
  const salida = {};
  for (const k of ['esperaInicialMs', 'esperaMaximaMs', 'maxClaves']) {
    if (opciones[k] !== undefined) salida[k] = opciones[k];
  }
  return salida;
}

module.exports = {
  crearColaAvisos,
  clasificar,
  configuracionDelEntorno,
  ESPERA_INICIAL_MS,
  ESPERA_MAXIMA_MS,
  MAX_CLAVES,
};
