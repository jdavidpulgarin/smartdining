/**
 * Aviso de `mesa:atendida` (socket-server/EVENTS.md §4): el personal marcó
 * «Atendida» el llamado o la cuenta de la mesa. Llega a la sala de la mesa como
 * { eventId, id_mesa, tipo: 'llamado' | 'cuenta', emitidoEn }.
 *
 * Todo es puro (sin React ni DOM) y el reloj se inyecta, para probarlo en Node.
 */
import { crearDeduplicador } from './deduplicador';

export const MENSAJES_ATENDIDA = Object.freeze({
  llamado: 'Tu mesero ya va en camino',
  cuenta: 'El mesero va con tu cuenta',
});

export const DURACION_AVISO_ATENDIDA_MS = 6000;

/**
 * El aviso que corresponde al evento, o null si hay que ignorarlo: no es un
 * objeto, la sesión no tiene mesa, `id_mesa` no es la mesa de esta sesión o
 * `tipo` no es 'llamado' ni 'cuenta'.
 *
 * @param {object} evento - Payload de mesa:atendida
 * @param {number|string|null} idMesaSesion - id_mesa de la sesión (no el número de mesa)
 * @returns {{ eventId: string|null, tipo: string, mensaje: string }|null}
 */
export function avisoDeAtendida(evento, idMesaSesion) {
  if (!evento || typeof evento !== 'object') return null;
  const mesaSesion = Number(idMesaSesion);
  if (!Number.isInteger(mesaSesion) || mesaSesion <= 0) return null;
  if (Number(evento.id_mesa) !== mesaSesion) return null;
  if (!Object.hasOwn(MENSAJES_ATENDIDA, evento.tipo)) return null;
  return {
    eventId: typeof evento.eventId === 'string' ? evento.eventId : null,
    tipo: evento.tipo,
    mensaje: MENSAJES_ATENDIDA[evento.tipo],
  };
}

/**
 * Un solo aviso a la vez. `recibir` valida el evento, ignora un eventId ya
 * visto y, si vale, REEMPLAZA el aviso actual (no se apilan) y reinicia el
 * cierre automático. `cerrar` lo quita a mano. Cada cambio llama a
 * `alCambiar(aviso | null)`.
 *
 * @param {object} opciones
 * @param {(aviso: object|null) => void} opciones.alCambiar
 * @param {number} [opciones.duracionMs]
 * @param {Function} [opciones.programar] - como setTimeout
 * @param {Function} [opciones.cancelar] - como clearTimeout
 * @param {{ visto: Function }} [opciones.deduplicador]
 */
export function crearControlAvisoAtendida({
  alCambiar,
  duracionMs = DURACION_AVISO_ATENDIDA_MS,
  programar = (fn, ms) => setTimeout(fn, ms),
  cancelar = (h) => clearTimeout(h),
  deduplicador = crearDeduplicador({ capacidad: 200 }),
} = {}) {
  let actual = null;
  let temporizador = null;

  const pararReloj = () => {
    if (temporizador !== null) cancelar(temporizador);
    temporizador = null;
  };

  function recibir(evento, idMesaSesion) {
    const aviso = avisoDeAtendida(evento, idMesaSesion);
    if (!aviso) return false;
    if (deduplicador.visto(aviso.eventId)) return false;
    pararReloj();
    actual = aviso;
    alCambiar?.(actual);
    const propio = programar(() => {
      if (temporizador !== propio) return; // ya lo reemplazó otro aviso
      temporizador = null;
      actual = null;
      alCambiar?.(null);
    }, duracionMs);
    temporizador = propio;
    return true;
  }

  function cerrar() {
    pararReloj();
    if (actual === null) return;
    actual = null;
    alCambiar?.(null);
  }

  return {
    recibir,
    cerrar,
    /** Al desmontar: solo para el reloj (no avisa a nadie). */
    destruir: pararReloj,
    get actual() {
      return actual;
    },
  };
}

// Alturas de lo que ya está fijo abajo (con su margen), para dejar el aviso ENCIMA.
// Barra del carrito de /menu: bottom max(14px, safe-area) + ~72 px de alto, y el
// toast de Menu en bottom-24 (96 px) + ~44 px. BottomBar de /armar: ~80 px.
const BASE = 'max(14px, env(safe-area-inset-bottom))';
const SOBRE_CARRITO_MENU = 'calc(max(14px, env(safe-area-inset-bottom)) + 140px)';
const SOBRE_BOTTOM_BAR = 'calc(env(safe-area-inset-bottom) + 92px)';

/**
 * Dónde va el aviso según la pantalla:
 * - /pago: dentro del flujo, arriba del contenido (no tapa botones, montos ni Wompi).
 * - Con el aviso «La carta cambió» abierto (alto variable, con botón): también
 *   en el flujo, para no taparlo.
 * - Si no, banda fija abajo, por ENCIMA de lo que ya esté fijo abajo y del safe-area.
 *
 * @returns {{ enLinea: boolean, bottom: string|null }}
 */
export function posicionAvisoAtendida({ ruta = '', hayCarrito = false, hayAvisosMenu = false } = {}) {
  if (ruta === '/pago' || hayAvisosMenu) return { enLinea: true, bottom: null };
  if (ruta === '/menu' && hayCarrito) return { enLinea: false, bottom: SOBRE_CARRITO_MENU };
  if (ruta.startsWith('/armar/')) return { enLinea: false, bottom: SOBRE_BOTTOM_BAR };
  return { enLinea: false, bottom: BASE };
}
