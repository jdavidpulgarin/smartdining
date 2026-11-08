const { aplicarOperacion, CARRITO_VACIO } = require('../carrito');
const { PREFIJO } = require('./redis');

// Un carrito abandonado (mesa que nunca se liberó) no debe vivir para siempre:
// 24 h es más que cualquier estadía y se renueva con cada cambio.
const TTL_CARRITO_SEG = 24 * 60 * 60;
// Misma ventana de deduplicación que el registro en memoria (10 min).
const TTL_IDEM_SEG = 10 * 60;
// Reintentos ante conflicto de WATCH: con pocas personas por mesa dos
// escrituras simultáneas son raras; 10 seguidas indican un problema real.
const MAX_REINTENTOS = 10;

const llaveCarrito = (idMesa) => `${PREFIJO}carrito:${idMesa}`;
const llaveIdem = (clave) => `${PREFIJO}idem:${clave}`;

const leer = (crudo) => {
  if (!crudo) return { version: 0, items: [] };
  const c = JSON.parse(crudo);
  return { version: c.version, items: c.items };
};

const esConflicto = (err) => err && err.name === 'WatchError';

/**
 * Carrito de cada mesa en Redis, en `sd:carrito:{mesa}` como JSON.
 *
 * Atomicidad con WATCH/MULTI/EXEC (bloqueo optimista): se vigilan la llave del
 * carrito y la del eventId, se lee, se calcula el siguiente estado con la
 * MISMA función que usa la memoria (aplicarOperacion) y se escribe en una
 * transacción. Si otro proceso tocó cualquiera de las dos llaves entretanto,
 * EXEC falla y se reintenta desde la lectura. Así:
 *   - dos comensales que editan a la vez no se pisan (ninguna escritura se pierde);
 *   - un evento reenviado dos veces en paralelo se aplica UNA sola vez, porque
 *     la marca de idempotencia se escribe en la misma transacción que el carrito.
 *
 * Se eligió WATCH/MULTI y no un script Lua para no duplicar la lógica del
 * carrito en otro lenguaje: la que se prueba en memoria es la que corre aquí.
 */
function crearAlmacenCarritosRedis({ cliente, ttlSeg = TTL_CARRITO_SEG }) {
  async function snapshot(idMesa) {
    return leer(await cliente.get(llaveCarrito(idMesa)));
  }

  async function aplicarUnaVez(idMesa, op, claveIdem) {
    const kc = llaveCarrito(idMesa);
    const ki = claveIdem ? llaveIdem(claveIdem) : null;

    for (let intento = 0; intento < MAX_REINTENTOS; intento += 1) {
      try {
        const r = await cliente.executeIsolated(async (iso) => {
          await iso.watch(ki ? [kc, ki] : kc);
          if (ki && await iso.get(ki)) {
            await iso.unwatch();
            return { duplicado: true, snapshot: leer(await iso.get(kc)) };
          }
          const calculado = aplicarOperacion(leer(await iso.get(kc)), op);
          if (calculado.error) {
            await iso.unwatch();
            return calculado;
          }
          const tx = iso.multi();
          // Sin cambios (remove_de que no encontró líneas) no se reescribe el
          // carrito, pero el eventId sí se marca dentro de la misma transacción.
          if (!calculado.sinCambios) tx.set(kc, JSON.stringify(calculado.carrito), { EX: ttlSeg });
          if (ki) tx.set(ki, '1', { EX: TTL_IDEM_SEG });
          await tx.exec();
          return { duplicado: false, snapshot: calculado.carrito, ...(calculado.sinCambios && { sinCambios: true }) };
        });
        return r;
      } catch (err) {
        if (!esConflicto(err)) throw err;
      }
    }
    throw new Error(`Conflicto persistente al actualizar el carrito de la mesa ${idMesa}`);
  }

  async function aplicar(idMesa, op) {
    const r = await aplicarUnaVez(idMesa, op, null);
    if (r.error) return r;
    return r.sinCambios ? { snapshot: r.snapshot, sinCambios: true } : { snapshot: r.snapshot };
  }

  async function vaciar(idMesa) {
    return (await aplicar(idMesa, { accion: 'clear' })).snapshot;
  }

  return { snapshot, aplicar, aplicarUnaVez, vaciar };
}

module.exports = {
  crearAlmacenCarritosRedis, llaveCarrito, llaveIdem, TTL_CARRITO_SEG, TTL_IDEM_SEG, CARRITO_VACIO,
};
