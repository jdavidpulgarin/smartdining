/**
 * Traducción de los errores de inventario de la base (D-17, P-19).
 *
 * `database/scripts/27_inventario.sql` lanza dos SQLSTATE propios y mantiene un
 * `RAISE EXCEPTION` genérico anterior. Sin traducirlos, los dos primeros caen en
 * el 500 genérico del manejador central: el cliente no distingue "falta queso"
 * de "se cayó el servidor", y no sabe si quitar algo del carrito o reintentar.
 *
 *   - **SD001 "sin stock"** → 409 `sin_stock` con la lista de qué quitar.
 *   - **SD002 "stock negativo"** → 400 `movimiento_invalido` con el stock actual.
 *   - **`El ingrediente "X" está agotado`** (P0001) → 409 `ingrediente_agotado`.
 *
 * Vive aparte del manejador central y no dentro de él porque el PR 2 (CRUD de
 * insumos y movimientos) necesita la MISMA traducción de SD002 desde sus propias
 * rutas: dos copias acabarían contestando cosas distintas al mismo error.
 *
 * La convención de errores de esta API es `{ error, motivo }` (decisión de
 * Jarrison): `motivo` es el código estable que el cliente compara y `error` el
 * texto para leer. **No se usa `codigo`.**
 *
 * Qué sale y qué no: de `faltantes` solo viajan `tipo`, `id` y `nombre`, que es
 * lo que la app necesita para dejar quitar el plato o la opción del carrito.
 * `id_insumo`, `insumo`, `necesita` y `hay` se quedan en el log del servidor: un
 * pedido lo puede hacer un comensal anónimo desde su teléfono, y las cantidades
 * de bodega no son asunto suyo.
 */

/** SQLSTATE propios del inventario (27_inventario.sql). */
const SQLSTATE_SIN_STOCK = 'SD001';
const SQLSTATE_MOVIMIENTO_INVALIDO = 'SD002';

/** El P0001 genérico del interruptor manual de una opción, anterior a P-19. */
const PG_RAISE_EXCEPTION = 'P0001';

const MOTIVO_SIN_STOCK = 'sin_stock';
const MOTIVO_MOVIMIENTO_INVALIDO = 'movimiento_invalido';
const MOTIVO_INGREDIENTE_AGOTADO = 'ingrediente_agotado';

/**
 * El mensaje EXACTO de `fn_tr_validar_detalle_ingrediente` cuando la opción está
 * apagada a mano (`'El ingrediente "%" está agotado'`).
 *
 * Estricta a propósito —ancladas las dos puntas y comparando solo con P0001—
 * porque esa misma función lanza otros cinco P0001 ("no pertenece al plato", "no
 * es personalizable", "el pedido ya está en estado X"…) y un `includes` los
 * marcaría todos como `ingrediente_agotado`. El cliente actuaría sobre el
 * ingrediente cuando el problema es otro.
 */
const RE_INGREDIENTE_AGOTADO = /^El ingrediente "[^"]*" está agotado$/;

/** ¿Ese mensaje es el del interruptor manual de una opción? */
function esIngredienteAgotado(err) {
  return Boolean(
    err
      && err.code === PG_RAISE_EXCEPTION
      && typeof err.message === 'string'
      && RE_INGREDIENTE_AGOTADO.test(err.message)
  );
}

/**
 * El DETAIL de la base, ya parseado, o null.
 *
 * Nunca lanza: un DETAIL ilegible no puede convertir un 409 que el cliente sabe
 * atender en un 500. Se pierde el detalle, no la respuesta.
 */
function detalleDeLaBase(err) {
  if (!err || typeof err.detail !== 'string' || !err.detail) return null;
  try {
    const valor = JSON.parse(err.detail);
    return valor && typeof valor === 'object' ? valor : null;
  } catch {
    return null;
  }
}

/** ¿Es un entero que puede ser el id de un plato o de una opción? */
function esId(valor) {
  return Number.isInteger(valor) && valor > 0;
}

/**
 * Los faltantes que SÍ van al cliente: `tipo`, `id` y `nombre`, sin repetir.
 *
 * Se deduplica por `tipo` + `id` porque la base los arma por INSUMO: un plato al
 * que le faltan tres insumos aparece tres veces en el DETAIL, y al cliente eso
 * le diría tres veces que quite el mismo plato. Se conserva el ORDEN de la
 * primera aparición (el de la base, por `id_insumo`), que es estable.
 *
 * Una fila sin `tipo` o con un `id` que no es un entero positivo se descarta: no
 * sirve para quitar nada del carrito y mandarla a medias es peor que no
 * mandarla. Si no queda ninguna, la lista va vacía y el `motivo` sigue diciendo
 * qué pasó.
 *
 * T5: con `disponibles` (el Map "tipo:id" -> entero que calcula
 * services/disponible-sin-stock.js después del error), cada faltante lleva
 * además `disponible`: cuántas unidades de ese plato u opción se pueden pedir.
 * Sin el Map (la consulta falló o no se llamó), o sin entrada para ese faltante
 * (no tiene receta), la fila sale como siempre, sin el campo. Nunca salen
 * id_insumo, el nombre del insumo ni cantidades de bodega.
 */
function faltantesParaElCliente(detalle, disponibles = null) {
  const filas = detalle && Array.isArray(detalle.faltantes) ? detalle.faltantes : [];
  const vistos = new Set();
  const limpios = [];

  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') continue;
    if (typeof fila.tipo !== 'string' || !fila.tipo) continue;
    if (!esId(fila.id)) continue;

    const llave = `${fila.tipo}:${fila.id}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);

    const limpio = {
      tipo: fila.tipo,
      id: fila.id,
      nombre: typeof fila.nombre === 'string' ? fila.nombre : null,
    };
    const disponible = disponibles instanceof Map ? disponibles.get(llave) : undefined;
    if (Number.isInteger(disponible) && disponible >= 0) limpio.disponible = disponible;
    limpios.push(limpio);
  }

  return limpios;
}

/**
 * El stock actual del DETAIL de SD002, como número, o null.
 *
 * El DETAIL es un JSON que arma la base con `json_build_object`, así que el
 * NUMERIC ya viene como número JSON; se acepta también el texto por si alguna
 * versión del script lo encomilla, y se descarta cualquier otra cosa antes de
 * ponerlo en una respuesta.
 */
function stockActualDe(detalle) {
  if (!detalle) return null;
  const valor = detalle.stock_actual;
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const numero = Number(valor);
    if (Number.isFinite(numero)) return numero;
  }
  return null;
}

/**
 * Traduce un error de inventario, o devuelve null si no es de inventario.
 *
 * @returns {null | {status: number, cuerpo: object, log: string}}
 *   `log` es lo que conviene registrar en el servidor (incluidos los campos de
 *   bodega que NO salen en `cuerpo`). Quien llama decide dónde lo escribe.
 */
function traducirErrorInventario(err) {
  if (!err) return null;

  if (err.code === SQLSTATE_SIN_STOCK) {
    const detalle = detalleDeLaBase(err);
    // T5: err.disponibles lo anota pedidos.service al fallar (ver
    // services/disponible-sin-stock.js); si no está, los faltantes salen sin él.
    const faltantes = faltantesParaElCliente(detalle, err.disponibles);
    return {
      status: 409,
      cuerpo: { error: err.message, motivo: MOTIVO_SIN_STOCK, faltantes },
      // El DETAIL completo, con insumo, necesita y hay: es lo que permite saber
      // de qué hay que reponer, y no lleva ningún dato personal.
      log: `sin stock: ${err.detail || '(sin detalle)'}`,
    };
  }

  if (err.code === SQLSTATE_MOVIMIENTO_INVALIDO) {
    const detalle = detalleDeLaBase(err);
    const cuerpo = { error: err.message, motivo: MOTIVO_MOVIMIENTO_INVALIDO };
    // Solo si se pudo leer: un `stock_actual: null` no le dice nada a quien
    // llama, y el MESSAGE de la base ya trae el stock en lenguaje de usuario.
    const stock = stockActualDe(detalle);
    if (stock !== null) cuerpo.stock_actual = stock;
    return {
      status: 400,
      cuerpo,
      log: `movimiento invalido: ${err.detail || '(sin detalle)'}`,
    };
  }

  if (esIngredienteAgotado(err)) {
    return {
      status: 409,
      cuerpo: { error: err.message, motivo: MOTIVO_INGREDIENTE_AGOTADO },
      log: 'ingrediente agotado (interruptor manual de la cocina)',
    };
  }

  return null;
}

module.exports = {
  traducirErrorInventario,
  faltantesParaElCliente,
  stockActualDe,
  detalleDeLaBase,
  esIngredienteAgotado,
  SQLSTATE_SIN_STOCK,
  SQLSTATE_MOVIMIENTO_INVALIDO,
  MOTIVO_SIN_STOCK,
  MOTIVO_MOVIMIENTO_INVALIDO,
  MOTIVO_INGREDIENTE_AGOTADO,
  RE_INGREDIENTE_AGOTADO,
};
