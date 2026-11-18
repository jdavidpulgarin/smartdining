// Lo compartido por sala-inventario.test.js y sala-inventario-errores.test.js
// (se dividió para que cada archivo quede lejos del límite de 10 s).
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, tokenComensal, tokenPantalla, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

// POST /internal/inventario-alerta → inventario:alerta solo a room:admin (EVENTS.md §5.5).

const RUTA = '/internal/inventario-alerta';
const EVENTO = 'inventario:alerta';
const CAMPOS = ['agotado', 'emitidoEn', 'eventId', 'id_insumo', 'nombre', 'stock_actual', 'stock_minimo', 'unidad'];

// Un cuerpo de tipo string se manda tal cual (para probar JSON malformado).
const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${RUTA}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const aviso = (extra = {}) => ({
  id_insumo: 12, nombre: 'Queso costeño', unidad: 'g', stock_actual: 450, stock_minimo: 500, eventId: randomUUID(), ...extra,
});

// Cada prueba corre con el registro de idempotencia en memoria y con el doble de Redis.
const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({ falso: null, deps: {} }),
  redis: () => {
    const falso = crearRedisFalso();
    return { falso, deps: { redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso }) } };
  },
};

/** Personal de sala (admin, mesero, cajero), cocina, un comensal en su mesa y la pantalla de esa mesa. */
async function escenario(t, almacen, env = {}) {
  const { falso, deps } = ALMACENES[almacen]();
  const s = await levantar(env, deps);
  t.after(() => s.cerrar());
  const comensal = await s.conectar(tokenComensal(5));
  await emitir(comensal, 'join:table', {});
  const pantalla = await s.conectar(tokenPantalla(5));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const cajero = await s.conectar(tokenPersonal('cajero'));
  return { s, falso, comensal, pantalla, cocina, admin, mesero, cajero };
}

/** Hace fallar UNA vez el emit de inventario:alerta (socket.io no exporta BroadcastOperator). */
function fallarEmisionUnaVez(t, s) {
  const proto = Object.getPrototypeOf(s.io.to('room:ninguna'));
  const original = proto.emit;
  let pendiente = true;
  proto.emit = function emit(evento, ...args) {
    if (evento === EVENTO && pendiente) {
      pendiente = false;
      throw new Error('falla simulada al emitir');
    }
    return original.call(this, evento, ...args);
  };
  t.after(() => { proto.emit = original; });
}

module.exports = {
  RUTA, EVENTO, CAMPOS, avisar, aviso, ALMACENES, escenario, fallarEmisionUnaVez,
};
