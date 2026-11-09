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
 * La carta con su disponibilidad (D-17 PR 3)
 * -------------------------------------------------------------------------- */

/**
 * Qué decide qué: la vista `v_carta_disponible` (script 27) ya resuelve
 * `disponible_efectivo`, `motivo` y `tiene_receta`, así que aquí NO se recalcula
 * nada. Lo único que se añade con un JOIN son los datos que el panel necesita
 * para agrupar y que la vista no trae: la categoría del plato, y de qué plato y
 * de qué paso es cada opción del constructor.
 *
 * Las dos consultas están escritas completas y los filtros van como parámetros
 * ($1, $2): ninguna sentencia de este repo se arma pegando texto, y los
 * identificadores nunca son dinámicos (lo vigila `tests/inyeccion-sql.test.js`).
 * `q` entra por `ILIKE`, con los comodines puestos en SQL.
 */
const SQL_CARTA_PLATOS = `
  SELECT v.id, v.nombre, c.nombre AS categoria, p.personalizable,
         v.disponible, v.stock_suficiente, v.disponible_efectivo, v.motivo, v.tiene_receta
    FROM v_carta_disponible v
    JOIN platos p ON p.id_plato = v.id
    LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
   WHERE v.tipo = 'plato'
     AND ($1::BOOLEAN IS NULL OR v.tiene_receta = $1)
     AND ($2::TEXT IS NULL OR v.nombre ILIKE '%' || $2 || '%')
   ORDER BY c.nombre ASC NULLS FIRST, v.nombre ASC`;

const SQL_CARTA_INGREDIENTES = `
  SELECT v.id, v.nombre,
         pc.id_plato, pl.nombre AS plato, pc.id_paso, pc.nombre AS paso, pc.orden AS paso_orden,
         v.disponible, v.stock_suficiente, v.disponible_efectivo, v.motivo, v.tiene_receta
    FROM v_carta_disponible v
    JOIN ingredientes i ON i.id_ingrediente = v.id
    JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
    JOIN platos pl ON pl.id_plato = pc.id_plato
   WHERE v.tipo = 'ingrediente'
     AND ($1::BOOLEAN IS NULL OR v.tiene_receta = $1)
     AND ($2::TEXT IS NULL OR v.nombre ILIKE '%' || $2 || '%')
   ORDER BY pl.nombre ASC, pc.orden ASC, v.nombre ASC`;

/** Los ids pueden llegar como texto según el tipo de la columna: a número. */
function aEntero(valor) {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : null;
}

/**
 * Una fila de plato, con los ids ya como números.
 *
 * `personalizable` va porque explica un `tiene_receta: false` que NO es un
 * olvido: un Bowl o una Arepa Rellena consumen por sus OPCIONES, cada una con
 * su propia receta, así que el plato no tiene receta propia y está bien así.
 * Sin ese campo, el panel los pintaría como "falta configurar".
 */
const filaPlato = (f) => ({
  id: aEntero(f.id),
  nombre: f.nombre,
  categoria: f.categoria ?? null,
  personalizable: f.personalizable,
  disponible: f.disponible,
  stock_suficiente: f.stock_suficiente,
  disponible_efectivo: f.disponible_efectivo,
  motivo: f.motivo ?? null,
  tiene_receta: f.tiene_receta,
});

/**
 * Una fila de opción del constructor, con su plato y su paso.
 *
 * `paso_orden` es el orden del paso DENTRO de su plato, y hace falta porque el
 * nombre del paso se repite entre platos ("Elige tu Salsa" está en varios): sin
 * él, el panel no puede ordenar los pasos como los ve el comensal ni distinguir
 * dos pasos homónimos de platos distintos.
 */
const filaIngrediente = (f) => ({
  id: aEntero(f.id),
  nombre: f.nombre,
  id_plato: aEntero(f.id_plato),
  plato: f.plato,
  id_paso: aEntero(f.id_paso),
  paso: f.paso,
  paso_orden: aEntero(f.paso_orden),
  disponible: f.disponible,
  stock_suficiente: f.stock_suficiente,
  disponible_efectivo: f.disponible_efectivo,
  motivo: f.motivo ?? null,
  tiene_receta: f.tiene_receta,
});

/**
 * La carta para la pestaña de Recetas: `{ platos, ingredientes }`.
 *
 * Dos listas y no una con un `tipo`, aunque la vista las devuelva juntas: un
 * plato y una opción no se pintan igual (la opción cuelga de un paso de su
 * plato) y el panel las muestra en dos tablas.
 *
 * Con `tipo` se pide solo una, pero la otra viaja **vacía** y no se omite: así
 * el cliente no tiene que comprobar si la clave existe.
 *
 * ORDEN FIJO, que es parte del contrato: los platos por categoría y luego
 * nombre; las opciones por plato, luego `paso_orden` y luego nombre. Es el
 * orden en que el panel las pinta, así que no tiene que reordenar nada.
 *
 * @param {{tipo?: 'plato'|'ingrediente', sinReceta?: boolean, q?: string}} filtros
 */
async function obtenerCarta({ tipo, sinReceta, q } = {}) {
  // `sin_receta=true` busca `tiene_receta = false`: es la lista de "falta
  // configurar" de la pestaña. Sin el filtro, null, que la consulta lee como
  // "no filtres".
  const tieneReceta = sinReceta === undefined ? null : !sinReceta;
  const parametros = [tieneReceta, q || null];

  const platos = tipo === 'ingrediente'
    ? []
    : (await pool.query(SQL_CARTA_PLATOS, parametros)).rows.map(filaPlato);

  const ingredientes = tipo === 'plato'
    ? []
    : (await pool.query(SQL_CARTA_INGREDIENTES, parametros)).rows.map(filaIngrediente);

  return { platos, ingredientes };
}

/* -------------------------------------------------------------------------- *
 * Dónde se usa un insumo (D-17 PR 3, P2)
 * -------------------------------------------------------------------------- */

/**
 * Qué platos y qué opciones del constructor llevan ese insumo en su receta, y
 * cuánto.
 *
 * Es la pregunta de antes de tocar un insumo: "si lo desactivo o cambio su
 * unidad, ¿qué se cae?". La respuesta la tiene la base en `recetas_plato` y
 * `recetas_ingrediente`; aquí solo se leen las dos, con el mismo orden que la
 * carta para que el panel las pinte igual.
 */
const SQL_USOS_PLATOS = `
  SELECT r.id_plato AS id, p.nombre, r.cantidad
    FROM recetas_plato r
    JOIN platos p ON p.id_plato = r.id_plato
   WHERE r.id_insumo = $1
   ORDER BY p.nombre ASC`;

const SQL_USOS_INGREDIENTES = `
  SELECT r.id_ingrediente AS id, i.nombre,
         pc.id_plato, pl.nombre AS plato, pc.id_paso, pc.nombre AS paso, pc.orden AS paso_orden,
         r.cantidad
    FROM recetas_ingrediente r
    JOIN ingredientes i ON i.id_ingrediente = r.id_ingrediente
    JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
    JOIN platos pl ON pl.id_plato = pc.id_plato
   WHERE r.id_insumo = $1
   ORDER BY pl.nombre ASC, pc.orden ASC, i.nombre ASC`;

/**
 * @returns {Promise<null | {id_insumo: number, nombre: string, platos: Array, ingredientes: Array}>}
 *   null si el insumo no existe (la ruta responde 404; una lista vacía
 *   significaría "no se usa en ninguna receta", que es otra cosa).
 */
async function usosDeInsumo(idInsumo) {
  const insumo = await obtenerInsumo(idInsumo);
  if (!insumo) return null;

  const [platos, ingredientes] = await Promise.all([
    pool.query(SQL_USOS_PLATOS, [idInsumo]),
    pool.query(SQL_USOS_INGREDIENTES, [idInsumo]),
  ]);

  return {
    id_insumo: insumo.id_insumo,
    nombre: insumo.nombre,
    platos: platos.rows.map((f) => ({
      id: aEntero(f.id),
      nombre: f.nombre,
      cantidad: f.cantidad,
    })),
    ingredientes: ingredientes.rows.map((f) => ({
      id: aEntero(f.id),
      nombre: f.nombre,
      id_plato: aEntero(f.id_plato),
      plato: f.plato,
      id_paso: aEntero(f.id_paso),
      paso: f.paso,
      paso_orden: aEntero(f.paso_orden),
      cantidad: f.cantidad,
    })),
  };
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
  obtenerCarta,
  usosDeInsumo,
  aEntero,
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
