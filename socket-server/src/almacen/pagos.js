const { PREFIJO } = require('./redis');

/**
 * Intenciones de pago, en memoria o en Redis (misma interfaz).
 *
 *   sd:pago:ref:{referencia}             → { id_mesa, comensal, modo, monto_centavos, estado, creada_en, expira_en }
 *   sd:pago:pendiente:{mesa}:{comensal}  → referencia de su intención pendiente
 *   sd:pago:mesa:{mesa}                  → hash comensal → '1': quién de la mesa
 *                                          tiene (o tuvo hace poco) una marca de
 *                                          pendiente. Solo para listarlas (T4,
 *                                          GET /internal/pagos-en-curso) sin
 *                                          recorrer todo Redis con SCAN.
 *
 * La marca dura PAGOS_TTL_MINUTOS: si nadie paga, el comensal puede pedir otra.
 * El registro dura más (ttlIntencionRegistroSeg, 26 h por defecto) porque el
 * webhook puede llegar mucho después de que venció. La referencia es la llave
 * con la que el webhook encuentra qué se esperaba cobrar; por eso el monto
 * esperado vive aquí y no en el cliente.
 *
 * Al liberar la mesa, `limpiarMesa` borra el índice y las marcas de pendiente
 * que lista (las intenciones eran del grupo que se fue). Los registros
 * sd:pago:ref:* se quedan: un webhook tardío se tiene que seguir registrando.
 *
 * Una intención pendiente que ya no sirve (otro modo u otro monto) no se
 * borra: queda `reemplazada` con `reemplazada_por`, porque el comensal pudo
 * haberla pagado en otra pestaña y su webhook todavía tiene que registrarse.
 */
const llaveRef = (ref) => `${PREFIJO}pago:ref:${ref}`;
const llavePendiente = (idMesa, comensal) => `${PREFIJO}pago:pendiente:${idMesa}:${comensal}`;
const llaveMesa = (idMesa) => `${PREFIJO}pago:mesa:${idMesa}`;
const esConflicto = (err) => err && err.name === 'WatchError';
const MAX_REINTENTOS = 5;

function crearAlmacenPagosMemoria({ ahora = Date.now } = {}) {
  const datos = new Map(); // llave -> { valor, expira }
  const leer = (k) => {
    const e = datos.get(k);
    if (!e) return null;
    if (e.expira <= ahora()) { datos.delete(k); return null; }
    return e.valor;
  };
  const escribir = (k, valor, ttlSeg) => datos.set(k, { valor, expira: ahora() + ttlSeg * 1000 });
  // Índice por mesa (ver arriba): comensal → vence. Se anota ANTES de fijar la
  // marca, así toda marca que exista está en el índice; un nombre de más (la
  // marca venció o la ganó otro) se ignora al listar.
  const indice = new Map(); // idMesa -> Map(comensal -> expira)
  const anotarEnMesa = (idMesa, comensal, ttlSeg) => {
    if (!indice.has(idMesa)) indice.set(idMesa, new Map());
    const expira = ahora() + ttlSeg * 1000;
    const mesa = indice.get(idMesa);
    mesa.set(comensal, Math.max(expira, mesa.get(comensal) || 0));
  };

  return {
    async guardarIntencion(ref, intencion, ttlSeg) { escribir(llaveRef(ref), { ...intencion }, ttlSeg); },
    async obtener(ref) { const v = leer(llaveRef(ref)); return v ? { ...v } : null; },
    async borrarIntencion(ref) { datos.delete(llaveRef(ref)); },
    async actualizarEstado(ref, estado, ttlSeg) {
      const actual = leer(llaveRef(ref));
      if (actual) escribir(llaveRef(ref), { ...actual, estado }, ttlSeg);
    },
    /** Fija la pendiente solo si no hay otra. Devuelve la referencia ganadora. */
    async reservarPendiente(idMesa, comensal, ref, ttlSeg) {
      anotarEnMesa(idMesa, comensal, ttlSeg);
      const k = llavePendiente(idMesa, comensal);
      const actual = leer(k);
      if (actual) return actual;
      escribir(k, ref, ttlSeg);
      return ref;
    },
    /**
     * Cambia la pendiente de `vieja` a `nueva` solo si todavía apunta a `vieja`
     * (si ya no hay ninguna, reserva `nueva`). Devuelve la referencia ganadora.
     */
    async reemplazarPendiente(idMesa, comensal, vieja, nueva, ttlSeg) {
      anotarEnMesa(idMesa, comensal, ttlSeg);
      const k = llavePendiente(idMesa, comensal);
      const actual = leer(k);
      if (actual && actual !== vieja) return actual;
      escribir(k, nueva, ttlSeg);
      return nueva;
    },
    /** Marca `ref` como reemplazada por `por`, solo si seguía pendiente. */
    async marcarReemplazada(ref, por, ttlSeg) {
      const actual = leer(llaveRef(ref));
      if (!actual || actual.estado !== 'pendiente') return false;
      escribir(llaveRef(ref), { ...actual, estado: 'reemplazada', reemplazada_por: por }, ttlSeg);
      return true;
    },
    async obtenerPendiente(idMesa, comensal) { return leer(llavePendiente(idMesa, comensal)); },
    /** Borra la marca de pendiente solo si apunta a `ref` (no la de una intención más nueva). */
    async liberarPendiente(idMesa, comensal, ref) {
      const k = llavePendiente(idMesa, comensal);
      if (leer(k) === ref) datos.delete(k);
    },
    /** Las marcas de pendiente vigentes de la mesa: [{ comensal, referencia }]. */
    async listarPendientesMesa(idMesa) {
      const mesa = indice.get(idMesa);
      if (!mesa) return [];
      const salida = [];
      for (const [comensal, expira] of [...mesa]) {
        if (expira <= ahora()) { mesa.delete(comensal); continue; }
        const referencia = leer(llavePendiente(idMesa, comensal));
        if (referencia) salida.push({ comensal, referencia });
      }
      if (mesa.size === 0) indice.delete(idMesa);
      return salida;
    },
    /** La mesa se liberó: borra su índice y las marcas que lista (no los registros sd:pago:ref:*). */
    async limpiarMesa(idMesa) {
      const mesa = indice.get(idMesa);
      if (mesa) for (const comensal of mesa.keys()) datos.delete(llavePendiente(idMesa, comensal));
      indice.delete(idMesa);
    },
  };
}

/** Compara y cambia una llave en Redis con WATCH/MULTI; reintenta si otro proceso la tocó. */
async function compararYCambiar(cliente, llaves, fn) {
  for (let i = 0; i < MAX_REINTENTOS; i += 1) {
    try {
      return await cliente.executeIsolated(async (iso) => {
        await iso.watch(llaves);
        return fn(iso);
      });
    } catch (err) {
      if (!esConflicto(err)) throw err;
    }
  }
  throw new Error(`Conflicto persistente en ${[].concat(llaves).join(', ')}`);
}

function crearAlmacenPagosRedis({ cliente }) {
  // Índice por mesa: se anota ANTES de fijar la marca (ver la versión en
  // memoria). Su plazo solo se ALARGA, nunca se acorta: queda al menos tan
  // largo como el de la marca más larga de la mesa, aunque una marca nueva
  // traiga un plazo menor. Un miembro cuya marca ya venció se ignora al listar.
  const anotarEnMesa = async (idMesa, comensal, ttlSeg) => {
    const k = llaveMesa(idMesa);
    await cliente.hSet(k, comensal, '1');
    const queda = await cliente.ttl(k); // -1 recién creado (sin plazo)
    if (queda < ttlSeg) await cliente.expire(k, ttlSeg);
  };
  return {
    async guardarIntencion(ref, intencion, ttlSeg) {
      await cliente.set(llaveRef(ref), JSON.stringify(intencion), { EX: ttlSeg });
    },
    async obtener(ref) {
      const v = await cliente.get(llaveRef(ref));
      return v ? JSON.parse(v) : null;
    },
    async borrarIntencion(ref) { await cliente.del(llaveRef(ref)); },
    async actualizarEstado(ref, estado, ttlSeg) {
      const actual = await cliente.get(llaveRef(ref));
      if (actual) await cliente.set(llaveRef(ref), JSON.stringify({ ...JSON.parse(actual), estado }), { EX: ttlSeg });
    },
    async reservarPendiente(idMesa, comensal, ref, ttlSeg) {
      await anotarEnMesa(idMesa, comensal, ttlSeg);
      const k = llavePendiente(idMesa, comensal);
      // SET NX: si dos peticiones del mismo comensal llegan a la vez, una
      // sola intención queda como su pendiente.
      if ((await cliente.set(k, ref, { NX: true, EX: ttlSeg })) === 'OK') return ref;
      return (await cliente.get(k)) || ref;
    },
    async reemplazarPendiente(idMesa, comensal, vieja, nueva, ttlSeg) {
      await anotarEnMesa(idMesa, comensal, ttlSeg);
      const k = llavePendiente(idMesa, comensal);
      return compararYCambiar(cliente, k, async (iso) => {
        const actual = await iso.get(k);
        if (actual && actual !== vieja) {
          await iso.unwatch();
          return actual;
        }
        await iso.multi().set(k, nueva, { EX: ttlSeg }).exec();
        return nueva;
      });
    },
    async marcarReemplazada(ref, por, ttlSeg) {
      const k = llaveRef(ref);
      return compararYCambiar(cliente, k, async (iso) => {
        const v = await iso.get(k);
        const actual = v ? JSON.parse(v) : null;
        if (!actual || actual.estado !== 'pendiente') {
          await iso.unwatch();
          return false;
        }
        await iso.multi().set(k, JSON.stringify({ ...actual, estado: 'reemplazada', reemplazada_por: por }), { EX: ttlSeg }).exec();
        return true;
      });
    },
    async obtenerPendiente(idMesa, comensal) { return cliente.get(llavePendiente(idMesa, comensal)); },
    async liberarPendiente(idMesa, comensal, ref) {
      const k = llavePendiente(idMesa, comensal);
      await compararYCambiar(cliente, k, async (iso) => {
        if ((await iso.get(k)) !== ref) {
          await iso.unwatch();
          return;
        }
        await iso.multi().del(k).exec();
      });
    },
    /** Las marcas de pendiente vigentes de la mesa: [{ comensal, referencia }]. */
    async listarPendientesMesa(idMesa) {
      const comensales = Object.keys(await cliente.hGetAll(llaveMesa(idMesa)));
      const salida = [];
      for (const comensal of comensales) {
        const referencia = await cliente.get(llavePendiente(idMesa, comensal));
        if (referencia) salida.push({ comensal, referencia });
      }
      return salida;
    },
    /**
     * La mesa se liberó: borra su índice y las marcas que lista, en un solo DEL
     * y sin SCAN. Los registros sd:pago:ref:* se quedan (webhook tardío).
     */
    async limpiarMesa(idMesa) {
      const k = llaveMesa(idMesa);
      const comensales = Object.keys(await cliente.hGetAll(k));
      await cliente.del([k, ...comensales.map((c) => llavePendiente(idMesa, c))]);
    },
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
  crearAlmacenPagosMemoria, crearAlmacenPagosRedis, crearLimitesMemoria, crearLimitesRedis, llaveRef, llavePendiente, llaveMesa,
};
