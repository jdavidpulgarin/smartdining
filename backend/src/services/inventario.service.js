const pool = require('../config/db');

/**
 * Inventario: insumos, movimientos y recetas (D-17 PR 2).
 *
 * Las tablas, la función y las vistas son de `database/scripts/27_inventario.sql`
 * (P-19, Jarrison). Este servicio solo lee y escribe; las reglas son de la base:
 *
 *   - `insumos.stock_actual` **no se escribe nunca desde aquí**. Lo mueven la
 *     reserva de los pedidos y `registrar_movimiento_inventario`, porque la
 *     regla del libro es `SUM(movimientos.cantidad) = stock_actual` y un UPDATE
 *     directo la rompería para siempre.
 *   - La disponibilidad (`platos.stock_suficiente`,
 *     `ingredientes.stock_suficiente`) la recalculan los triggers del script 27
 *     al cambiar el stock, al activar o desactivar un insumo y al tocar una
 *     receta. Lo que cambie sale por el canal `inventario`, que ya escucha
 *     `services/inventario-avisos.js` (PR 1). Aquí no se recalcula nada a mano.
 *   - El autor de un movimiento sale de `app.id_usuario`
 *     (`fn_usuario_de_sesion()`), así que la escritura va en una transacción con
 *     `set_config(..., true)` antes de llamar a la función.
 *
 * Los `NUMERIC` llegan como números JS: `src/config/db.js` registra el parser
 * del OID 1700. Por eso `stock_actual` o `cantidad` no se convierten aquí.
 */

/** Unidades que admite el CHECK de `insumos.unidad`. */
const UNIDADES = ['porcion', 'unidad', 'g', 'ml'];

/**
 * Tipos de movimiento que puede pedir el personal.
 *
 * `reserva` y `devolucion` NO están: los escribe la base al confirmar o cancelar
 * un pedido, con su `id_detalle`, y dejarlos aquí permitiría descuadrar el libro
 * a mano. La propia función de la base solo acepta estos tres.
 */
const TIPOS_MOVIMIENTO = ['entrada', 'ajuste', 'merma'];

/** Topes de las listas. Defensivos, no reglas de negocio. */
const MAX_INSUMOS = 200;
const MAX_MOVIMIENTOS = 200;
const LIMITE_INSUMOS_POR_OMISION = 100;
const LIMITE_MOVIMIENTOS_POR_OMISION = 50;

/** Cuántas entradas puede tener una receta. */
const MAX_ENTRADAS_RECETA = 50;

/** SQLSTATE que esta API traduce por su cuenta, con un mensaje que nombra qué choca. */
const PG_UNIQUE = '23505';
const PG_FK = '23503';
const PG_NO_DATA = 'P0002';

const MOTIVO_NOMBRE_EN_USO = 'nombre_en_uso';
const MOTIVO_INSUMO_INEXISTENTE = 'insumo_inexistente';

const MENSAJE_NOMBRE_EN_USO = 'Ya hay un insumo con ese nombre';
const MENSAJE_INSUMO_INEXISTENTE = 'Alguno de los insumos de la receta no existe';

/** Error de negocio con status, que es la primera rama de errores.middleware. */
function errorDeInventario(status, message, motivo) {
  return motivo ? { status, message, motivo } : { status, message };
}

/**
 * Las columnas de un insumo, más `bajo` y `agotado` calculados EN SQL.
 *
 * Se calculan en la consulta y no en JavaScript para que la señal sea la misma
 * que la de `v_stock_bajo` (`activo AND stock_actual <= stock_minimo`): dos
 * comparaciones en dos lenguajes acabarían discrepando en los bordes.
 */
const COLUMNAS_INSUMO = `
  s.id_insumo, s.nombre, s.unidad, s.stock_actual, s.stock_minimo, s.activo,
  (s.activo AND s.stock_actual <= s.stock_minimo) AS bajo,
  (s.stock_actual = 0) AS agotado,
  s.actualizado_en`;

/**
 * Lista de insumos.
 *
 * Con `estado: 'bajo'` se lee la VISTA `v_stock_bajo` y no la tabla: es la
 * definición de "bajo" de Jarrison (y ya trae su `agotado`), así que el panel y
 * el aviso `inventario:alerta` hablan exactamente de lo mismo.
 *
 * @param {{estado?: 'todos'|'bajo', activo?: boolean, q?: string, limite?: number}} filtros
 */
async function listarInsumos({ estado = 'todos', activo, q, limite } = {}) {
  const tope = Math.min(Math.max(Number(limite) || LIMITE_INSUMOS_POR_OMISION, 1), MAX_INSUMOS);

  if (estado === 'bajo') {
    // La vista ya filtra por activo, así que `activo: false` no tiene nada que
    // devolver aquí: lo inactivo no está en la lista de faltantes.
    if (activo === false) return [];
    const result = await pool.query(
      `SELECT id_insumo, nombre, unidad, stock_actual, stock_minimo, agotado
         FROM v_stock_bajo
        WHERE ($1::TEXT IS NULL OR nombre ILIKE '%' || $1 || '%')
        ORDER BY agotado DESC, nombre ASC
        LIMIT $2`,
      [q || null, tope]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT ${COLUMNAS_INSUMO}
       FROM insumos s
      WHERE ($1::BOOLEAN IS NULL OR s.activo = $1)
        AND ($2::TEXT IS NULL OR s.nombre ILIKE '%' || $2 || '%')
      ORDER BY s.nombre ASC
      LIMIT $3`,
    [activo === undefined ? null : activo, q || null, tope]
  );
  return result.rows;
}

/** Un insumo, o null. Un insumo desactivado SÍ se devuelve: la baja no lo esconde. */
async function obtenerInsumo(idInsumo) {
  const result = await pool.query(
    `SELECT ${COLUMNAS_INSUMO} FROM insumos s WHERE s.id_insumo = $1`,
    [idInsumo]
  );
  return result.rows[0] || null;
}

/**
 * Crea el insumo y, si viene `stock_inicial`, lo mete como un movimiento
 * `entrada` en la MISMA transacción.
 *
 * El insumo nace con `stock_actual = 0` (el DEFAULT de la columna) y el stock
 * inicial entra por el libro: si se escribiera en la columna,
 * `SUM(movimientos.cantidad) = stock_actual` fallaría desde la primera fila y
 * ningún informe de inventario cuadraría nunca.
 *
 * @returns {Promise<{insumo: object, movimiento: object|null}>}
 */
async function crearInsumo({ nombre, unidad = 'porcion', stock_minimo = 0, stock_inicial },
  { idUsuario = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarAutor(client, idUsuario);

    const creado = await client.query(
      `INSERT INTO insumos (nombre, unidad, stock_minimo)
       VALUES ($1, $2, $3)
       RETURNING id_insumo`,
      [nombre, unidad, stock_minimo]
    );
    const idInsumo = creado.rows[0].id_insumo;

    let movimiento = null;
    if (stock_inicial !== undefined && stock_inicial !== null) {
      const mov = await client.query(
        'SELECT * FROM registrar_movimiento_inventario($1, $2, $3, $4) AS m',
        [idInsumo, 'entrada', stock_inicial, 'Stock inicial']
      );
      movimiento = mov.rows[0];
    }

    const insumo = await leerInsumo(client, idInsumo);
    await client.query('COMMIT');
    return { insumo, movimiento };
  } catch (err) {
    await deshacer(client);
    if (err && err.code === PG_UNIQUE) {
      throw errorDeInventario(409, MENSAJE_NOMBRE_EN_USO, MOTIVO_NOMBRE_EN_USO);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Campos que el PUT sabe actualizar. `stock_actual` NO está: solo se mueve con movimientos. */
const CAMPOS_INSUMO = ['nombre', 'unidad', 'stock_minimo', 'activo'];

/**
 * Actualiza los campos enviados de un insumo (PUT parcial). Devuelve el insumo
 * ya actualizado, o null si no existe.
 *
 * Desactivar (`activo: false`) es la baja: no hay DELETE, porque las recetas y
 * los movimientos referencian el insumo con `ON DELETE RESTRICT` y borrarlo
 * sería borrar el libro. Para la base, un insumo inactivo cuenta como "no hay",
 * así que al desactivarlo los platos y las opciones que lo usan pasan a no
 * disponibles (lo hace `fn_recalcular_disponibilidad` por trigger).
 */
async function actualizarInsumo(idInsumo, cambios, { idUsuario = null } = {}) {
  const columnas = CAMPOS_INSUMO.filter((c) => Object.hasOwn(cambios, c));
  if (columnas.length === 0) return obtenerInsumo(idInsumo);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarAutor(client, idUsuario);

    const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const result = await client.query(
      `UPDATE insumos SET ${asignaciones} WHERE id_insumo = $1 RETURNING id_insumo`,
      [idInsumo, ...columnas.map((c) => cambios[c])]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const insumo = await leerInsumo(client, idInsumo);
    await client.query('COMMIT');
    return insumo;
  } catch (err) {
    await deshacer(client);
    if (err && err.code === PG_UNIQUE) {
      throw errorDeInventario(409, MENSAJE_NOMBRE_EN_USO, MOTIVO_NOMBRE_EN_USO);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Registra un movimiento con `registrar_movimiento_inventario`.
 *
 * La función es la que manda: bloquea el insumo (`FOR UPDATE`), comprueba que no
 * quede negativo (SD002, que el manejador central traduce a 400
 * `movimiento_invalido`), escribe la fila del libro y actualiza el stock. El
 * backend no hace ningún UPDATE de `stock_actual`.
 *
 * El autor sale del JWT, vía `set_config('app.id_usuario', ..., true)` en esta
 * misma transacción: `fn_usuario_de_sesion()` lo lee ahí dentro, y con
 * `is_local` el valor no se filtra a la siguiente petición que use esa conexión
 * del pool.
 *
 * @returns {Promise<{movimiento: object, stock_actual: number}|null>} null si el
 *   insumo no existe.
 */
async function registrarMovimiento(idInsumo, { tipo, cantidad, motivo = null },
  { idUsuario = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarAutor(client, idUsuario);

    const result = await client.query(
      'SELECT * FROM registrar_movimiento_inventario($1, $2, $3, $4) AS m',
      [idInsumo, tipo, cantidad, motivo]
    );
    const movimiento = result.rows[0];

    await client.query('COMMIT');
    return { movimiento, stock_actual: movimiento.stock_resultante };
  } catch (err) {
    await deshacer(client);
    // La función lanza `no_data_found` cuando el insumo no existe; para esta API
    // eso es un 404 y no un 500.
    if (err && err.code === PG_NO_DATA) return null;
    throw err;
  } finally {
    client.release();
  }
}

/**
 * El libro de un insumo, lo más reciente primero.
 *
 * Salen TODOS los tipos, incluidos los que escribe la base al pedir (`reserva`,
 * `devolucion` y la `merma` con `id_detalle`): sin ellos la lista no cuadraría
 * con el stock, y es justo lo que hace falta para auditar un descuadre.
 */
async function listarMovimientos(idInsumo, { limite, desde } = {}) {
  const tope = Math.min(
    Math.max(Number(limite) || LIMITE_MOVIMIENTOS_POR_OMISION, 1),
    MAX_MOVIMIENTOS
  );
  const result = await pool.query(
    `SELECT id, id_insumo, tipo, cantidad, stock_resultante, id_detalle, id_usuario,
            motivo, creado_en
       FROM movimientos_inventario
      WHERE id_insumo = $1
        AND ($2::TIMESTAMPTZ IS NULL OR creado_en >= $2)
      ORDER BY creado_en DESC, id DESC
      LIMIT $3`,
    [idInsumo, desde || null, tope]
  );
  return result.rows;
}

/* -------------------------------------------------------------------------- *
 * Recetas
 *
 * Dos tablas gemelas: `recetas_plato` (consumo por UNIDAD de plato) y
 * `recetas_ingrediente` (consumo de una opción en porción NORMAL, que la base
 * multiplica por `factores_porcion`). La lógica es la misma, así que las
 * funciones la comparten y reciben QUÉ sentencias usar.
 *
 * Cada receta trae sus cuatro sentencias **escritas completas**, no un nombre de
 * tabla que se interpole: ninguna consulta de este repo se arma pegando texto
 * (es lo que vigila `tests/inyeccion-sql.test.js`), y así las cuatro se leen tal
 * como salen hacia PostgreSQL. Los identificadores son fijos y los valores
 * siempre van como parámetros.
 * -------------------------------------------------------------------------- */

const RECETA_PLATO = {
  clave: 'id_plato',
  existe: 'SELECT 1 FROM platos WHERE id_plato = $1',
  leer: `SELECT r.id_insumo, s.nombre, s.unidad, r.cantidad, s.stock_actual, s.activo
           FROM recetas_plato r
           JOIN insumos s ON s.id_insumo = r.id_insumo
          WHERE r.id_plato = $1
          ORDER BY s.nombre ASC`,
  borrar: 'DELETE FROM recetas_plato WHERE id_plato = $1',
  insertar: `INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
             VALUES ($1, $2, $3)`,
};

const RECETA_INGREDIENTE = {
  clave: 'id_ingrediente',
  existe: 'SELECT 1 FROM ingredientes WHERE id_ingrediente = $1',
  leer: `SELECT r.id_insumo, s.nombre, s.unidad, r.cantidad, s.stock_actual, s.activo
           FROM recetas_ingrediente r
           JOIN insumos s ON s.id_insumo = r.id_insumo
          WHERE r.id_ingrediente = $1
          ORDER BY s.nombre ASC`,
  borrar: 'DELETE FROM recetas_ingrediente WHERE id_ingrediente = $1',
  insertar: `INSERT INTO recetas_ingrediente (id_ingrediente, id_insumo, cantidad)
             VALUES ($1, $2, $3)`,
};

/** ¿Existe ese plato o esa opción? Una sola consulta por clave primaria. */
async function existeDueno(receta, id, ejecutor = pool) {
  const result = await ejecutor.query(receta.existe, [id]);
  return result.rows.length > 0;
}

/**
 * La receta, con el nombre y el stock de cada insumo: es lo que el panel
 * necesita para pintar la fila sin una segunda llamada por insumo.
 */
async function obtenerReceta(receta, id, ejecutor = pool) {
  const result = await ejecutor.query(receta.leer, [id]);
  return result.rows;
}

/**
 * Reemplaza la receta COMPLETA en una transacción: se borra la anterior y se
 * insertan las entradas nuevas.
 *
 * Es un reemplazo y no un parche porque una receta a medias no significa nada:
 * si el borrado entrara y las inserciones no, el plato se quedaría sin control
 * de inventario sin que nadie lo pidiera. Una lista vacía deja el plato SIN
 * receta, que es la forma de quitarla.
 *
 * Al guardar, los triggers `tr_receta_plato` y `tr_receta_ingrediente`
 * recalculan la disponibilidad con la receta nueva, así que el plato puede
 * quedar no disponible en este mismo PUT (y sale su aviso por el canal).
 *
 * @returns {Promise<Array|null>} la receta guardada, o null si el dueño no existe.
 */
async function reemplazarReceta(receta, id, insumos, { idUsuario = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fijarAutor(client, idUsuario);

    if (!(await existeDueno(receta, id, client))) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(receta.borrar, [id]);

    for (const entrada of insumos) {
      await client.query(receta.insertar, [id, entrada.id_insumo, entrada.cantidad]);
    }

    const guardada = await obtenerReceta(receta, id, client);
    await client.query('COMMIT');
    return guardada;
  } catch (err) {
    await deshacer(client);
    // La FK de la receta apunta a `insumos` con ON DELETE RESTRICT: un 23503
    // aquí solo puede ser un id_insumo que no existe.
    if (err && err.code === PG_FK) {
      throw errorDeInventario(409, MENSAJE_INSUMO_INEXISTENTE, MOTIVO_INSUMO_INEXISTENTE);
    }
    throw err;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- *
 * Auxiliares
 * -------------------------------------------------------------------------- */

/**
 * Fija el autor de la transacción para `fn_usuario_de_sesion()` (script 26).
 *
 * `set_config` y no `SET LOCAL` porque solo la primera admite parámetros: con
 * `SET LOCAL` habría que interpolar el id en el texto del SQL. El tercer
 * argumento en `true` (`is_local`) hace que el valor viva solo hasta el fin de
 * la transacción.
 */
function fijarAutor(client, idUsuario) {
  return client.query('SELECT set_config($1, $2, true)', [
    'app.id_usuario',
    idUsuario === null || idUsuario === undefined ? '' : String(idUsuario),
  ]);
}

/** Un insumo leído DENTRO de la transacción, con las mismas columnas que el GET. */
async function leerInsumo(client, idInsumo) {
  const result = await client.query(
    `SELECT ${COLUMNAS_INSUMO} FROM insumos s WHERE s.id_insumo = $1`,
    [idInsumo]
  );
  return result.rows[0] || null;
}

/** ROLLBACK que no puede tapar el error de verdad. */
async function deshacer(client) {
  try {
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('[inventario] el ROLLBACK fallo tras un error:', err && err.message);
  }
}

module.exports = {
  listarInsumos,
  obtenerInsumo,
  crearInsumo,
  actualizarInsumo,
  registrarMovimiento,
  listarMovimientos,
  obtenerReceta,
  reemplazarReceta,
  existeDueno,
  RECETA_PLATO,
  RECETA_INGREDIENTE,
  UNIDADES,
  TIPOS_MOVIMIENTO,
  MAX_INSUMOS,
  MAX_MOVIMIENTOS,
  MAX_ENTRADAS_RECETA,
  MOTIVO_NOMBRE_EN_USO,
  MOTIVO_INSUMO_INEXISTENTE,
  MENSAJE_NOMBRE_EN_USO,
  MENSAJE_INSUMO_INEXISTENTE,
};
