// Lo compartido por mesa-actualizada.test.js y mesa-actualizada-errores.test.js.
// POST /internal/mesa-actualizada → mesa:actualizada solo a room:admin (EVENTS.md §5.7).
const { randomUUID } = require('node:crypto');
const { CLAVE_INTERNA } = require('./helpers');
// Mismo escenario (personal de sala, cocina, comensal y pantalla de la mesa 5)
// y los mismos dos almacenes de idempotencia que inventario-alerta.
const { ALMACENES, escenario } = require('./sala-inventario-helpers');

const RUTA = '/internal/mesa-actualizada';
const EVENTO = 'mesa:actualizada';
const CAMPOS = ['capacidad', 'emitidoEn', 'estado', 'eventId', 'id_mesa', 'numero', 'ubicacion'];

// Un cuerpo de tipo string se manda tal cual (para probar JSON malformado).
const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${RUTA}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const mesa = (extra = {}) => ({
  eventId: randomUUID(), id_mesa: 5, numero: 5, estado: 'ocupada', capacidad: 4, ubicacion: 'Terraza', ...extra,
});

/** Hace fallar UNA vez el emit de mesa:actualizada (socket.io no exporta BroadcastOperator). */
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
  RUTA, EVENTO, CAMPOS, avisar, mesa, ALMACENES, escenario, fallarEmisionUnaVez,
};
