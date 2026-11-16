import { formatearPrecio } from './formato';

/**
 * Avisos para el comensal cuando la carta cambia con el carrito lleno
 * (`menu:actualizado`, EVENTS.md §5.8). Las líneas del carrito toman nombre y
 * precio del menú, así que al llegar el menú nuevo se recalculan solas; esto
 * dice QUÉ cambió para que el comensal no se entere al ver el total.
 *
 * - `precio`: la línea sigue en la carta y su precio unitario cambió.
 * - `retirado`: el plato ya no está en la carta (lo borraron o dejó de estar
 *   disponible): no se podrá pedir.
 *
 * Un aviso por plato y tipo, aunque esté en varias líneas.
 *
 * @param {Array<{id_linea: string, id_plato: number, nombre: string, precioUnitario: number}>} antes
 *   líneas enriquecidas con el menú viejo
 * @param {Array<{id_linea: string, id_plato: number, nombre: string, precioUnitario: number}>} despues
 *   las mismas líneas enriquecidas con el menú nuevo
 * @param {(idPlato: number) => boolean} estaEnCarta  si el plato está en el menú nuevo
 * @returns {Array<{clave: string, tipo: 'precio'|'retirado', id_plato: number, texto: string}>}
 */
export function avisosCambiosCarrito(antes = [], despues = [], estaEnCarta = () => true) {
  if (!Array.isArray(antes) || !Array.isArray(despues)) return [];
  const porLinea = new Map(despues.map((l) => [String(l.id_linea), l]));
  const avisos = new Map();

  for (const vieja of antes) {
    const nueva = porLinea.get(String(vieja.id_linea));
    if (!nueva) continue; // la línea ya no está en el carrito: nada que avisar
    const idPlato = Number(vieja.id_plato);

    if (!estaEnCarta(idPlato)) {
      const clave = `retirado:${idPlato}`;
      if (!avisos.has(clave)) {
        avisos.set(clave, {
          clave, tipo: 'retirado', id_plato: idPlato,
          texto: `«${vieja.nombre}» ya no está en la carta. Quítalo del carrito para enviar tu pedido.`,
        });
      }
      continue;
    }

    const precioAntes = Number(vieja.precioUnitario) || 0;
    const precioAhora = Number(nueva.precioUnitario) || 0;
    if (precioAntes > 0 && precioAhora > 0 && precioAntes !== precioAhora) {
      const clave = `precio:${idPlato}`;
      if (!avisos.has(clave)) {
        avisos.set(clave, {
          clave, tipo: 'precio', id_plato: idPlato,
          texto: `«${nueva.nombre}» cambió de precio: ahora ${formatearPrecio(precioAhora)} (antes ${formatearPrecio(precioAntes)}). Tu carrito ya tiene el precio nuevo.`,
        });
      }
    }
  }
  return [...avisos.values()];
}

/** Suma avisos nuevos a los que ya se ven; uno nuevo del mismo plato y tipo reemplaza al viejo. */
export function unirAvisos(actuales = [], nuevos = []) {
  if (!nuevos.length) return actuales;
  const claves = new Set(nuevos.map((a) => a.clave));
  return [...actuales.filter((a) => !claves.has(a.clave)), ...nuevos];
}

/**
 * El oyente de `menu:actualizado` (EVENTS.md §5.8), sin React para poder
 * probarlo: deduplica por eventId, vuelve a pedir el menú (`refrescar`, que
 * avisa a Menú y Constructor), entrega el menú nuevo y compara el carrito de
 * antes con el de ahora. Nunca rechaza: un fallo de red queda en el log y el
 * siguiente aviso (o volver a abrir el Menú) lo arregla.
 *
 * @param {object} deps
 * @param {() => Promise<object>} deps.refrescar  refrescarMenu de menuService
 * @param {() => Array} deps.leerAntes  líneas enriquecidas con el menú viejo
 * @param {(menu: object) => Array} deps.enriquecer  líneas con el menú nuevo
 * @param {(menu: object, idPlato: number) => boolean} deps.estaEnCarta
 * @param {(menu: object) => void} deps.alRecibirMenu
 * @param {(avisos: Array) => void} deps.alAvisar
 * @param {{ visto: (id: string) => boolean }} deps.deduplicador
 * @returns {(data: object) => Promise<Array|null>} los avisos, o null si no hizo nada
 */
export function crearOyenteMenuActualizado({
  refrescar, leerAntes, enriquecer, estaEnCarta, alRecibirMenu, alAvisar, deduplicador, log = console,
}) {
  return (data) => {
    if (deduplicador?.visto(data?.eventId)) return Promise.resolve(null);
    const antes = leerAntes();
    return Promise.resolve()
      .then(() => refrescar())
      .then((menu) => {
        if (!menu) return null;
        alRecibirMenu(menu);
        const avisos = avisosCambiosCarrito(antes, enriquecer(menu), (id) => estaEnCarta(menu, id));
        if (avisos.length > 0) alAvisar(avisos);
        return avisos;
      })
      .catch((err) => {
        log.error('Error al recargar el menú tras menu:actualizado:', err);
        return null;
      });
  };
}
