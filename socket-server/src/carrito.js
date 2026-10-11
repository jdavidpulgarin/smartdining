const { exito, fallo, manejar } = require('./ack');
const { ROL_COMENSAL } = require('./auth');
const { esEventIdValido } = require('./idempotencia');
const { resolverMesa, estaEnMesa, salaMesa, esIdValido } = require('./salas');

const ROLES_CARRITO = ['comensal', 'mesero', 'admin'];
const MAX_ITEMS_POR_MESA = 200; // tope para que una mesa no consuma memoria sin límite
const MAX_APODO = 40;
const MAX_NOTAS = 200;
// Un plato armable tiene base, proteína, toppings y salsas: 30 sobra para un
// plato real y acota cuánto puede crecer una línea del carrito en memoria.
const MAX_INGREDIENTES = 30;
const PORCIONES = ['ligera', 'normal', 'extra'];

// isSafeInteger y no isInteger: 2^53 "es entero" pero ya no se distingue de
// 2^53 + 1, y la base lo rechazaría (o peor, lo confundiría con otro id).
const esIdIngredienteValido = (v) => Number.isSafeInteger(v) && v > 0;

const esObjetoPlano = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype;

/**
 * Valida la lista de ingredientes de un plato armable. Devuelve un mensaje de
 * error o null. Solo se miran id_ingrediente y porcion: cualquier otro campo
 * (en especial precio_aplicado) se descarta al normalizar, porque el precio lo
 * calcula el backend con los datos de la base, nunca el cliente.
 */
function validarIngredientes(lista) {
  if (!Array.isArray(lista)) return 'ingredientes debe ser un arreglo';
  if (lista.length > MAX_INGREDIENTES) return `ingredientes admite como máximo ${MAX_INGREDIENTES} elementos`;
  const vistos = new Set();
  for (const ing of lista) {
    if (!esObjetoPlano(ing)) return 'cada ingrediente debe ser un objeto { id_ingrediente, porcion }';
    if (!esIdIngredienteValido(ing.id_ingrediente)) return 'id_ingrediente debe ser un entero positivo';
    if (!PORCIONES.includes(ing.porcion)) return `porcion debe ser una de: ${PORCIONES.join(', ')}`;
    // Repetir un ingrediente es ambiguo (¿qué porción vale?) y es la forma
    // barata de inflar la línea: se rechaza en vez de elegir una en silencio.
    if (vistos.has(ing.id_ingrediente)) return 'id_ingrediente repetido en ingredientes';
    vistos.add(ing.id_ingrediente);
  }
  return null;
}

/** Copia solo los campos permitidos; null si el plato no es armable. */
function normalizarIngredientes(lista) {
  if (lista === undefined || lista === null) return null;
  return lista.map(({ id_ingrediente, porcion }) => ({ id_ingrediente, porcion }));
}

/**
 * Lógica del carrito grupal de una mesa, sin estado propio: recibe el carrito
 * actual ({ version, items }) y devuelve el siguiente. Es la MISMA para el
 * almacén en memoria y para el de Redis, así ambos se comportan igual.
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
 *
 * @returns {{ carrito: {version:number, items:object[]} } | { error: string }}
 */
function aplicarOperacion(actual, op) {
  let items = actual.items.slice();
  if (op.accion === 'set') {
    const linea = {
      id_linea: op.id_linea,
      comensal: op.comensal,
      id_plato: op.id_plato,
      cantidad: op.cantidad,
      notas: op.notas ?? null,
      ingredientes: normalizarIngredientes(op.ingredientes),
    };
    const i = items.findIndex((x) => x.id_linea === op.id_linea);
    if (i >= 0) {
      items[i] = linea; // edición: conserva la posición de la línea
    } else {
      // El tope solo aplica a líneas NUEVAS: editar una línea existente nunca
      // debe bloquearse por el máximo.
      if (items.length >= MAX_ITEMS_POR_MESA) return { error: 'El carrito de la mesa alcanzó el máximo de ítems' };
      items.push(linea);
    }
  } else if (op.accion === 'remove') {
    items = items.filter((x) => x.id_linea !== op.id_linea);
  } else if (op.accion === 'clear') {
    items = [];
  }
  return { carrito: { version: actual.version + 1, items } };
}

const CARRITO_VACIO = Object.freeze({ version: 0, items: Object.freeze([]) });
const copiar = (c) => ({ version: c.version, items: c.items.map((i) => ({ ...i })) });

/**
 * Almacén del carrito en memoria (desarrollo y pruebas, sin REDIS_URL).
 *
 * `aplicarUnaVez` comprueba el eventId y aplica en el mismo paso síncrono:
 * en memoria eso ya es atómico porque nada se intercala entre ambos.
 * Interfaz común con almacen/carritos-redis.js (allí todo devuelve promesas;
 * quien llama siempre usa await, que también funciona con valores directos).
 */
function crearAlmacenCarritos({ registro } = {}) {
  const mesas = new Map(); // idMesa -> { version, items: [] }

  const snapshot = (idMesa) => copiar(mesas.get(idMesa) || CARRITO_VACIO);

  /** Devuelve { snapshot } o { error } si se excede el tope. */
  function aplicar(idMesa, op) {
    const r = aplicarOperacion(mesas.get(idMesa) || CARRITO_VACIO, op);
    if (r.error) return r;
    mesas.set(idMesa, r.carrito);
    return { snapshot: copiar(r.carrito) };
  }

  /**
   * Aplica la operación solo si `claveIdem` no se procesó antes.
   * @returns {{ duplicado: boolean, snapshot } | { error: string }}
   */
  function aplicarUnaVez(idMesa, op, claveIdem) {
    if (claveIdem && registro && registro.obtener(claveIdem)) return { duplicado: true, snapshot: snapshot(idMesa) };
    const r = aplicar(idMesa, op);
    if (r.error) return r;
    if (claveIdem && registro) registro.guardar(claveIdem, true);
    return { duplicado: false, snapshot: r.snapshot };
  }

  const vaciar = (idMesa) => aplicar(idMesa, { accion: 'clear' }).snapshot;

  return { snapshot, aplicar, aplicarUnaVez, vaciar };
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
    // Opcional: sin ingredientes la línea es un plato simple.
    if (p.ingredientes !== undefined && p.ingredientes !== null) {
      const error = validarIngredientes(p.ingredientes);
      if (error) return error;
    }
  }
  return null;
}

function registrarCarrito(socket, { carritos }) {
  const identidad = socket.data.identidad;

  socket.on('cart:update', manejar('cart:update', async (p) => {
    const eventId = p.eventId;
    if (!esEventIdValido(eventId)) return fallo('PAYLOAD_INVALIDO', 'eventId debe ser un UUID');
    if (!ROLES_CARRITO.includes(identidad.rol)) {
      return fallo('NO_AUTORIZADO', 'Tu rol no puede modificar el carrito', { eventId });
    }
    // Vaciar TODA la mesa es una acción de sala, no de un comensal: un
    // comensal solo puede quitar sus propias líneas una por una con `remove`.
    if (p.accion === 'clear' && identidad.rol === ROL_COMENSAL) {
      return fallo('NO_AUTORIZADO', 'Solo el personal puede vaciar el carrito de la mesa', { eventId });
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
    // Comprobar el eventId y aplicar ocurren en UN paso atómico del almacén:
    // con Redis, dos reenvíos simultáneos no pueden aplicarse ambos.
    const claveEvento = `${identidad.rol}:cart:${idMesa}:${eventId}`;
    const resultado = await carritos.aplicarUnaVez(idMesa, p, claveEvento);
    if (resultado.error) return fallo('PAYLOAD_INVALIDO', resultado.error, { eventId });
    if (resultado.duplicado) return exito({ eventId, duplicado: true, carrito: resultado.snapshot });

    // A los demás; el emisor ya recibe el snapshot en su ack.
    socket.to(salaMesa(idMesa)).emit('cart:updated', {
      eventId,
      origen: typeof p.comensal === 'string' ? p.comensal : null,
      carrito: resultado.snapshot,
    });
    return exito({ eventId, duplicado: false, carrito: resultado.snapshot });
  }));
}

module.exports = {
  aplicarOperacion, crearAlmacenCarritos, CARRITO_VACIO, registrarCarrito, validarOperacion, validarIngredientes, normalizarIngredientes, MAX_INGREDIENTES, PORCIONES,
};
