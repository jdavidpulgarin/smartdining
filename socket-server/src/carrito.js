const { exito, fallo, manejar } = require('./ack');
const { esEventIdValido } = require('./idempotencia');
const { resolverMesa, estaEnMesa, salaMesa, esIdValido } = require('./salas');

const ROLES_CARRITO = ['comensal', 'mesero', 'admin'];
const MAX_ITEMS_POR_MESA = 200; // tope para que una mesa no consuma memoria sin límite
const MAX_APODO = 40;
const MAX_NOTAS = 200;

/**
 * Almacén del carrito grupal de cada mesa (en memoria).
 *
 * Cada ítem se identifica por su `id_linea` (UUID que genera el cliente una
 * sola vez por línea añadida) y `set` guarda la cantidad/notas FINALES de esa
 * línea. Por eso aplicar dos veces la misma operación deja el mismo estado:
 * el carrito converge aunque un evento llegue repetido tras una reconexión.
 * Repetir `set` sobre el mismo `id_linea` es una EDICIÓN de esa línea (sirve
 * para cambiar cantidad o notas), no crea una línea nueva; dos líneas con el
 * mismo (comensal, id_plato) pero distinto id_linea conviven sin pisarse
 * (p. ej. dos hamburguesas del mismo comensal con términos distintos).
 * `version` sube en cada cambio real para que los clientes descarten
 * snapshots que lleguen desordenados.
 */
function crearAlmacenCarritos() {
  const mesas = new Map(); // idMesa -> { version, items: Map<id_linea, item> }

  const obtener = (idMesa) => {
    if (!mesas.has(idMesa)) mesas.set(idMesa, { version: 0, items: new Map() });
    return mesas.get(idMesa);
  };

  function snapshot(idMesa) {
    const c = mesas.get(idMesa);
    if (!c) return { version: 0, items: [] };
    return { version: c.version, items: [...c.items.values()].map((i) => ({ ...i })) };
  }

  /** Devuelve el snapshot resultante o { error } si se excede el tope. */
  function aplicar(idMesa, op) {
    const c = obtener(idMesa);
    if (op.accion === 'set') {
      // El tope de ítems solo aplica a líneas NUEVAS: editar una línea
      // existente (mismo id_linea) nunca debe bloquearse por el máximo.
      if (!c.items.has(op.id_linea) && c.items.size >= MAX_ITEMS_POR_MESA) {
        return { error: 'El carrito de la mesa alcanzó el máximo de ítems' };
      }
      c.items.set(op.id_linea, {
        id_linea: op.id_linea, comensal: op.comensal, id_plato: op.id_plato, cantidad: op.cantidad, notas: op.notas ?? null,
      });
    } else if (op.accion === 'remove') {
      c.items.delete(op.id_linea);
    } else if (op.accion === 'clear') {
      c.items.clear();
    }
    c.version += 1;
    return { snapshot: snapshot(idMesa) };
  }

  function vaciar(idMesa) {
    return aplicar(idMesa, { accion: 'clear' }).snapshot;
  }

  return { snapshot, aplicar, vaciar };
}

/** Valida el payload de cart:update. Devuelve un mensaje de error o null. */
function validarOperacion(p) {
  if (!['set', 'remove', 'clear'].includes(p.accion)) return 'accion debe ser set, remove o clear';
  if (p.accion === 'clear') return null;
  // id_linea identifica la línea en set y en remove; en remove ya no hace
  // falta id_plato (se borra por id_linea), pero comensal se sigue exigiendo.
  if (!esEventIdValido(p.id_linea)) return 'id_linea debe ser un UUID';
  if (typeof p.comensal !== 'string' || !p.comensal.trim() || p.comensal.length > MAX_APODO) {
    return `comensal debe ser un texto de 1 a ${MAX_APODO} caracteres`;
  }
  if (p.accion === 'set') {
    if (!esIdValido(p.id_plato)) return 'id_plato debe ser un entero positivo';
    if (!Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 99) {
      return 'cantidad debe ser un entero entre 1 y 99';
    }
    if (p.notas !== undefined && p.notas !== null && (typeof p.notas !== 'string' || p.notas.length > MAX_NOTAS)) {
      return `notas debe ser un texto de hasta ${MAX_NOTAS} caracteres`;
    }
  }
  return null;
}

function registrarCarrito(socket, { carritos, registro }) {
  const identidad = socket.data.identidad;

  socket.on('cart:update', manejar('cart:update', (p) => {
    const eventId = p.eventId;
    if (!esEventIdValido(eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
    if (!ROLES_CARRITO.includes(identidad.rol)) {
      return fallo('NO_AUTORIZADO', 'Tu rol no puede modificar el carrito', { eventId });
    }

    const { idMesa, error } = resolverMesa(identidad, p.id_mesa);
    if (error) return { ...error, eventId };
    // Emitir sin haber hecho join:table sería escribir en una mesa cuya sala
    // no escuchamos: no recibiríamos el resto de cambios y quedaríamos
    // desincronizados sin darnos cuenta.
    if (!estaEnMesa(socket, idMesa)) {
      return fallo('SIN_SALA', 'Haz join:table antes de modificar el carrito', { eventId });
    }

    const errorPayload = validarOperacion(p);
    if (errorPayload) return fallo('PAYLOAD_INVALIDO', errorPayload, { eventId });

    // Duplicado (reenvío tras reconexión): no se reaplica; se responde con el
    // snapshot VIGENTE, que es lo que el cliente necesita para resincronizarse.
    const claveEvento = `cart:${idMesa}:${eventId}`;
    if (registro.obtener(claveEvento)) {
      return exito({ eventId, duplicado: true, carrito: carritos.snapshot(idMesa) });
    }

    const resultado = carritos.aplicar(idMesa, p);
    if (resultado.error) return fallo('PAYLOAD_INVALIDO', resultado.error, { eventId });

    registro.guardar(claveEvento, true);
    // A los demás; el emisor ya recibe el snapshot en su ack.
    socket.to(salaMesa(idMesa)).emit('cart:updated', {
      eventId,
      origen: typeof p.comensal === 'string' ? p.comensal : null,
      carrito: resultado.snapshot,
    });
    return exito({ eventId, duplicado: false, carrito: resultado.snapshot });
  }));
}

module.exports = { crearAlmacenCarritos, registrarCarrito, validarOperacion };
