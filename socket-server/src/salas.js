const { exito, fallo, manejar } = require('./ack');
const { ROL_COMENSAL } = require('./auth');

// Sala por mesa. El prefijo fijo evita colisiones con las salas de personal
// y con la sala privada que Socket.io crea por cada socket (su propio id).
const salaMesa = (idMesa) => `room:mesa-${idMesa}`;
const SALA_KDS = 'room:kds';
const SALA_ADMIN = 'room:admin';

const ROLES_KDS = ['cocina', 'admin'];
const ROLES_ADMIN = ['admin', 'mesero', 'cajero'];

const esIdValido = (v) => Number.isInteger(v) && v > 0;

/**
 * Resuelve a qué mesa se refiere el evento, aplicando el aislamiento:
 * - Comensal: la mesa sale SIEMPRE de su JWT. Si el payload trae otra, es un
 *   intento de espiar otra mesa y se rechaza (no se "corrige" en silencio).
 * - Personal: debe indicar la mesa explícitamente.
 */
function resolverMesa(identidad, idPayload) {
  if (identidad.rol === ROL_COMENSAL) {
    if (idPayload !== undefined && idPayload !== identidad.id_mesa) {
      return { error: fallo('NO_AUTORIZADO', 'No puedes acceder a otra mesa') };
    }
    return { idMesa: identidad.id_mesa };
  }
  if (!esIdValido(idPayload)) {
    return { error: fallo('PAYLOAD_INVALIDO', 'id_mesa debe ser un entero positivo') };
  }
  return { idMesa: idPayload };
}

/**
 * Registra las salas de personal (automáticas según el rol) y los eventos
 * join:table / leave:table.
 *
 * `obtenerSnapshot(idMesa)` permite que el ack de join:table incluya el
 * carrito actual; se inyecta para no acoplar este módulo al del carrito.
 */
function registrarSalas(socket, { obtenerSnapshot } = {}) {
  const identidad = socket.data.identidad;

  // Las pantallas de personal escuchan sus salas desde que conectan: no
  // dependen de que el frontend recuerde emitir un evento de unión.
  if (ROLES_KDS.includes(identidad.rol)) socket.join(SALA_KDS);
  if (ROLES_ADMIN.includes(identidad.rol)) socket.join(SALA_ADMIN);

  socket.on('join:table', manejar('join:table', (payload) => {
    if (identidad.rol === 'cocina') {
      return fallo('NO_AUTORIZADO', 'La cocina no se une a salas de mesa');
    }
    const { idMesa, error } = resolverMesa(identidad, payload.id_mesa);
    if (error) return error;

    socket.join(salaMesa(idMesa));
    const respuesta = { id_mesa: idMesa, sala: salaMesa(idMesa) };
    if (obtenerSnapshot) respuesta.carrito = obtenerSnapshot(idMesa);
    return exito(respuesta);
  }));

  socket.on('leave:table', manejar('leave:table', (payload) => {
    const { idMesa, error } = resolverMesa(identidad, payload.id_mesa);
    if (error) return error;
    socket.leave(salaMesa(idMesa));
    return exito();
  }));
}

/** ¿Este socket está dentro de la sala de esa mesa? (guarda para cart:update, etc.) */
function estaEnMesa(socket, idMesa) {
  return socket.rooms.has(salaMesa(idMesa));
}

module.exports = {
  registrarSalas, estaEnMesa, resolverMesa, salaMesa, SALA_KDS, SALA_ADMIN, esIdValido,
};
