// Doble en memoria del cliente de node-redis v4: solo los comandos que usa el
// socket-server, con la semántica que importa (EX, NX, WATCH/MULTI/EXEC con
// conflicto y "Redis caído"). Sirve para probar los almacenes Redis sin un
// servidor real; las pruebas contra Redis de verdad corren si existe REDIS_URL.
const { EventEmitter } = require('node:events');

class WatchError extends Error {
  constructor() { super('One (or more) of the watched keys has been changed'); this.name = 'WatchError'; }
}

function crearRedisFalso({ ahora = Date.now } = {}) {
  const datos = new Map(); // llave -> { valor, expira, version }
  let version = 0;
  let caido = false;
  const emisor = new EventEmitter();
  // Gancho para simular que OTRO proceso escribe entre el WATCH y el EXEC.
  let antesDeExec = null;

  const vigente = (k) => {
    const e = datos.get(k);
    if (!e) return undefined;
    if (e.expira && e.expira <= ahora()) { datos.delete(k); return undefined; }
    return e;
  };
  const verificar = () => {
    if (caido) {
      const err = new Error('The client is offline');
      err.name = 'ClientOfflineError';
      throw err;
    }
  };
  const escribir = (k, valor, expira) => { version += 1; datos.set(k, { valor, expira, version }); };
  const versionDe = (k) => (vigente(k) ? datos.get(k).version : 0);

  const comandos = {
    async get(k) { verificar(); const e = vigente(k); return e ? e.valor : null; },
    async set(k, v, opts = {}) {
      verificar();
      if (opts.NX && vigente(k)) return null;
      escribir(k, String(v), opts.EX ? ahora() + opts.EX * 1000 : null);
      return 'OK';
    },
    async del(k) {
      verificar();
      const ks = Array.isArray(k) ? k : [k];
      let n = 0;
      for (const x of ks) if (vigente(x)) { datos.delete(x); version += 1; n += 1; }
      return n;
    },
    async expire(k, seg) { verificar(); const e = vigente(k); if (!e) return 0; e.expira = ahora() + seg * 1000; return 1; },
    async hSet(k, campo, valor) {
      verificar();
      const e = vigente(k);
      const h = e ? new Map(e.valor) : new Map();
      const nuevo = !h.has(campo);
      h.set(campo, String(valor));
      escribir(k, h, e ? e.expira : null);
      return nuevo ? 1 : 0;
    },
    async hGet(k, campo) { verificar(); const e = vigente(k); return e && e.valor.has(campo) ? e.valor.get(campo) : null; },
    async hDel(k, campo) {
      verificar();
      const e = vigente(k);
      if (!e || !e.valor.has(campo)) return 0;
      const h = new Map(e.valor); h.delete(campo);
      if (h.size === 0) datos.delete(k); else escribir(k, h, e.expira);
      return 1;
    },
    async hLen(k) { verificar(); const e = vigente(k); return e ? e.valor.size : 0; },
    async hExists(k, campo) { verificar(); const e = vigente(k); return Boolean(e && e.valor.has(campo)); },
    async hVals(k) { verificar(); const e = vigente(k); return e ? [...e.valor.values()] : []; },
  };

  function multi(vigiladas) {
    const cola = [];
    const cadena = {};
    for (const nombre of ['set', 'del', 'expire', 'hSet', 'hDel']) {
      cadena[nombre] = (...args) => { cola.push([nombre, args]); return cadena; };
    }
    cadena.exec = async () => {
      verificar();
      if (antesDeExec) { const f = antesDeExec; antesDeExec = null; await f(); }
      for (const [k, v] of vigiladas) if (versionDe(k) !== v) throw new WatchError();
      const res = [];
      for (const [nombre, args] of cola) res.push(await comandos[nombre](...args));
      return res;
    };
    return cadena;
  }

  // Object.assign copiaría el VALOR de los getters: se definen aparte.
  Object.defineProperties(emisor, {
    isOpen: { get: () => !caido },
    isReady: { get: () => !caido },
  });
  const cliente = Object.assign(emisor, comandos, {
    async connect() { emisor.emit('ready'); },
    async quit() {},
    async executeIsolated(fn) {
      verificar();
      const vigiladas = new Map();
      const iso = {
        ...comandos,
        async watch(ks) { verificar(); for (const k of [].concat(ks)) vigiladas.set(k, versionDe(k)); return 'OK'; },
        async unwatch() { vigiladas.clear(); return 'OK'; },
        multi: () => multi(vigiladas),
      };
      return fn(iso);
    },
  });

  return {
    cliente,
    crearCliente: () => cliente,
    caer() { caido = true; emisor.emit('error', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })); },
    levantar() { caido = false; emisor.emit('ready'); },
    /** La próxima EXEC verá antes una escritura de "otro proceso". */
    interferir(fn) { antesDeExec = fn; },
    llaves: () => [...datos.keys()].filter((k) => vigente(k)),
    WatchError,
  };
}

module.exports = { crearRedisFalso, WatchError };
