const { PREFIJO } = require('./redis');

/**
 * Intenciones de pago, en memoria o en Redis (misma interfaz).
 *
 *   sd:pago:ref:{referencia}             → { id_mesa, comensal, modo, monto_centavos, estado, creada_en, expira_en }
 *   sd:pago:pendiente:{mesa}:{comensal}  → referencia de su intención pendiente
 *
 * Ambas con TTL = PAGOS_TTL_MINUTOS: una intención que nadie pagó caduca sola.
 * La referencia es la llave con la que el webhook encuentra qué se esperaba
 * cobrar; por eso el monto esperado vive aquí y no en el cliente.
 */
const llaveRef = (ref) => `${PREFIJO}pago:ref:${ref}`;
const llavePendiente = (idMesa, comensal) => `${PREFIJO}pago:pendiente:${idMesa}:${comensal}`;

function crearAlmacenPagosMemoria({ ahora = Date.now } = {}) {
  const datos = new Map(); // llave -> { valor, expira }
  const leer = (k) => {
    const e = datos.get(k);
    if (!e) return null;
    if (e.expira <= ahora()) { datos.delete(k); return null; }
    return e.valor;
  };
  const escribir = (k, valor, ttlSeg) => datos.set(k, { valor, expira: ahora() + ttlSeg * 1000 });

  return {
    async guardarIntencion(ref, intencion, ttlSeg) { escribir(llaveRef(ref), { ...intencion }, ttlSeg); },
    async obtener(ref) { const v = leer(llaveRef(ref)); return v ? { ...v } : null; },
    async borrarIntencion(ref) { datos.delete(llaveRef(ref)); },
    /** Fija la pendiente solo si no hay otra. Devuelve la referencia ganadora. */
    async reservarPendiente(idMesa, comensal, ref, ttlSeg) {
      const k = llavePendiente(idMesa, comensal);
      const actual = leer(k);
      if (actual) return actual;
      escribir(k, ref, ttlSeg);
      return ref;
    },
    async obtenerPendiente(idMesa, comensal) { return leer(llavePendiente(idMesa, comensal)); },
    async liberarPendiente(idMesa, comensal) { datos.delete(llavePendiente(idMesa, comensal)); },
  };
}

function crearAlmacenPagosRedis({ cliente }) {
  return {
    async guardarIntencion(ref, intencion, ttlSeg) {
      await cliente.set(llaveRef(ref), JSON.stringify(intencion), { EX: ttlSeg });
    },
    async obtener(ref) {
      const v = await cliente.get(llaveRef(ref));
      return v ? JSON.parse(v) : null;
    },
    async borrarIntencion(ref) { await cliente.del(llaveRef(ref)); },
    async reservarPendiente(idMesa, comensal, ref, ttlSeg) {
      const k = llavePendiente(idMesa, comensal);
      // SET NX: si dos peticiones del mismo comensal llegan a la vez, una
      // sola intención queda como su pendiente.
      if ((await cliente.set(k, ref, { NX: true, EX: ttlSeg })) === 'OK') return ref;
      return (await cliente.get(k)) || ref;
    },
    async obtenerPendiente(idMesa, comensal) { return cliente.get(llavePendiente(idMesa, comensal)); },
    async liberarPendiente(idMesa, comensal) { await cliente.del(llavePendiente(idMesa, comensal)); },
  };
}

/**
 * Límite de peticiones por ventana fija: `consumir(clave, max, ventanaSeg)`
 * devuelve false cuando se superó. En Redis es INCR + EXPIRE (atómico por
 * llave), así el límite vale entre instancias.
 */
function crearLimitesMemoria({ ahora = Date.now } = {}) {
  const ventanas = new Map(); // clave -> { cuenta, vence }
  return {
    consumir(clave, max, ventanaSeg) {
      const t = ahora();
      let v = ventanas.get(clave);
      if (!v || v.vence <= t) { v = { cuenta: 0, vence: t + ventanaSeg * 1000 }; ventanas.set(clave, v); }
      v.cuenta += 1;
      return v.cuenta <= max;
    },
  };
}

function crearLimitesRedis({ cliente }) {
  return {
    async consumir(clave, max, ventanaSeg) {
      const k = `${PREFIJO}rl:${clave}`;
      const n = await cliente.incr(k);
      if (n === 1) await cliente.expire(k, ventanaSeg);
      return n <= max;
    },
  };
}

module.exports = {
  crearAlmacenPagosMemoria, crearAlmacenPagosRedis, crearLimitesMemoria, crearLimitesRedis, llaveRef, llavePendiente,
};
