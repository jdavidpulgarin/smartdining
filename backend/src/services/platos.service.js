const pool = require('../config/db');
const { traducirAutorInexistente } = require('./autor-inexistente');

/**
 * La FK de la categoria (ISSUE #132, afinado en el review de #139).
 *
 * Un 23503 al crear o actualizar un plato se traduce a un 409 que dice QUE
 * falta, porque el 409 generico del manejador central ("La operacion choca con
 * otro registro relacionado") no lo dice y no trae `motivo`.
 *
 * PERO se mira el NOMBRE del constraint, no solo el SQLSTATE: al actualizar un
 * plato no hay una sola FK en juego. El trigger `tr_historial_precio_plato`
 * (database/scripts/26_configuracion.sql) escribe en `historial_precios`, que
 * tiene su propia `fk_historial_precios_usuario` contra `usuarios`: si el
 * usuario del token ya no existe, ese 23503 saldria como "Esa categoria no
 * existe" y mandaria a buscar el problema al sitio equivocado.
 *
 * Cualquier otro 23503 sube tal cual y el manejador central lo da como el 409
 * generico de clave ajena, que es lo correcto cuando no se sabe cual choco.
 */
const PG_FK = '23503';
const FK_CATEGORIA = 'fk_platos_categoria';
const MOTIVO_CATEGORIA_INEXISTENTE = 'categoria_inexistente';
const MENSAJE_CATEGORIA_INEXISTENTE = 'Esa categoria no existe';

/**
 * Traduce SOLO el 23503 de `fk_platos_categoria`; cualquier otro error —otra FK
 * o otro codigo— sube como venia.
 */
function traducirCategoria(err) {
  if (err && err.code === PG_FK && err.constraint === FK_CATEGORIA) {
    return {
      status: 409,
      message: MENSAJE_CATEGORIA_INEXISTENTE,
      motivo: MOTIVO_CATEGORIA_INEXISTENTE,
    };
  }
  return err;
}

/**
 * Las dos traducciones de un 23503 al crear o editar un plato, en orden
 * (review de #144).
 *
 * Primero la del AUTOR —`fk_historial_precios_usuario`, que dispara el trigger
 * del historial de precios cuando el usuario del token ya se borró— y después
 * la de la categoría. Son dos problemas distintos y cada uno dice qué hacer:
 * uno pide volver a iniciar sesión, el otro elegir otra categoría. Si no es
 * ninguno de los dos, el error sube tal cual.
 */
function traducirFkDePlato(err) {
  return traducirAutorInexistente(err) || traducirCategoria(err);
}

// Tabla platos (docs/modelo-er.md): id_plato, id_categoria, nombre, descripcion,
// precio, url_imagen, disponible, tiempo_preparacion_estimado, creado_en.
// El modelo NO tiene personalizaciones ni alergenos.

async function listar(idCategoria) {
  const result = idCategoria
    ? await pool.query('SELECT * FROM platos WHERE id_categoria = $1 ORDER BY id_plato', [idCategoria])
    : await pool.query('SELECT * FROM platos ORDER BY id_plato');
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM platos WHERE id_plato = $1', [id]);
  return result.rows[0] || null;
}

/**
 * Valores por defecto de las columnas, repetidos aquí a propósito (ISSUE #132).
 *
 * `tiempo_preparacion_estimado` es `NOT NULL DEFAULT 15 CHECK (> 0)`
 * (database/schema.sql:105) y `personalizable` es `NOT NULL DEFAULT FALSE`
 * (database/scripts/13_constructor.sql:33). El INSERT manda las columnas por
 * nombre, así que un parámetro en NULL **pisa el DEFAULT** en vez de dejarlo
 * actuar: con el tiempo en NULL, PostgreSQL rechazaba la fila con 23502 y
 * `POST /api/platos` **sin tiempo daba 500**.
 *
 * Se resuelve con `COALESCE($n, <constante>)`: la constante lleva el valor de la
 * columna y un comentario que apunta al esquema, para que se vea que hay dos
 * sitios que mantener. La alternativa —armar la lista de columnas según lo que
 * venga— metería identificadores dinámicos en el SQL, que es justo lo que no se
 * hace en este repo (tests/inyeccion-sql.test.js).
 *
 * `calorias` NO lleva constante: la columna es nullable y `null` significa "no
 * se sabe", que es distinto de 0, así que ahí el NULL es el valor correcto.
 */
const TIEMPO_PREPARACION_POR_OMISION = 15;
const PERSONALIZABLE_POR_OMISION = false;

async function crear(p) {
  try {
    return await insertarPlato(p);
  } catch (err) {
    throw traducirFkDePlato(err);
  }
}

async function insertarPlato(p) {
  const result = await pool.query(
    `INSERT INTO platos
      (id_categoria, nombre, descripcion, precio, url_imagen, disponible,
       tiempo_preparacion_estimado, personalizable, calorias, creado_en)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, ${TIEMPO_PREPARACION_POR_OMISION}),
             COALESCE($8, ${PERSONALIZABLE_POR_OMISION}), $9, NOW())
     RETURNING *`,
    [
      p.id_categoria,
      p.nombre,
      p.descripcion || null,
      p.precio,
      p.url_imagen || null,
      p.disponible ?? true,
      p.tiempo_preparacion_estimado ?? null,
      // D-16 B las dejó solo en el PUT: al crear se perdían en silencio aunque
      // platoSchema las aceptara.
      p.personalizable ?? null,
      p.calorias ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * Actualiza un plato. En una TRANSACCIÓN por el historial de precios (D-16 B).
 *
 * El trigger `tr_historial_precio_plato` (database/scripts/26_configuracion.sql)
 * registra cada cambio de `precio` en `historial_precios`, y el autor lo saca de
 * `app.id_usuario` con `fn_usuario_de_sesion()`. Ese valor se fija con
 * `set_config(..., true)`, que vive **solo hasta el fin de la transacción**: con
 * el `pool.query` de antes, el `set_config` y el `UPDATE` podían salir por
 * conexiones distintas y el historial quedaba con `id_usuario` NULL. De ahí la
 * transacción: no es por atomicidad —es un solo UPDATE— sino para que el
 * `set_config` y el `UPDATE` compartan conexión y transacción.
 *
 * `set_config` y no `SET LOCAL` porque solo la primera admite parámetros ($1).
 *
 * `personalizable` y `calorias` también se escriben aquí: las columnas ya
 * existían (13_constructor.sql) pero el UPDATE no las tocaba, así que un PUT que
 * las mandara las perdía en silencio.
 *
 * @param {number|string} id
 * @param {object} datos la fila completa ya mezclada por el controller.
 * @param {{idUsuario?: number|null}} contexto quién hace el cambio, para el historial.
 */
async function actualizar(id, datos, { idUsuario = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El autor del cambio de precio, para el trigger del historial.
    await client.query('SELECT set_config($1, $2, true)', [
      'app.id_usuario',
      idUsuario === null || idUsuario === undefined ? '' : String(idUsuario),
    ]);

    // Las columnas NOT NULL van con COALESCE (ISSUE #132): el controller manda
    // la fila ya mezclada, así que por HTTP nunca llegan en null, pero llamar al
    // servicio con datos PARCIALES daba un 23502 —y por tanto un 500— en vez de
    // dejar el valor que había. Para una columna NOT NULL, null no puede
    // significar otra cosa que "no lo cambies": no se puede guardar.
    //
    // `descripcion` y `url_imagen` NO llevan COALESCE a propósito: son nullable
    // y poner una en null es una edición válida (quitar la imagen de un plato).
    const result = await client.query(
      `UPDATE platos SET id_categoria = COALESCE($1, id_categoria),
        nombre = COALESCE($2, nombre), descripcion = $3, precio = COALESCE($4, precio),
        url_imagen = $5, disponible = COALESCE($6, disponible),
        tiempo_preparacion_estimado = COALESCE($7, tiempo_preparacion_estimado),
        personalizable = COALESCE($8, personalizable), calorias = COALESCE($9, calorias)
       WHERE id_plato = $10 RETURNING *`,
      [
        datos.id_categoria,
        datos.nombre,
        datos.descripcion,
        datos.precio,
        datos.url_imagen,
        datos.disponible,
        datos.tiempo_preparacion_estimado,
        datos.personalizable ?? null,
        datos.calorias ?? null,
        id,
      ]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada: no hay nada que deshacer.
    }
    // Mismo criterio que al crear: una categoría que no existe es un 409 que
    // dice qué falta, no el genérico de clave ajena (ISSUE #132).
    throw traducirFkDePlato(err);
  } finally {
    client.release();
  }
}

/**
 * Agota (`false`) o repone (`true`) un plato — D-05, PATCH /platos/:id/disponible.
 *
 * Igual que actualizarIngrediente del constructor: una transacción con la fila
 * BLOQUEADA (`FOR UPDATE`), para que dos pulsaciones a la vez desde el panel y
 * desde el KDS no se pisen y el valor anterior que se devuelve sea el de verdad.
 * El UPDATE toca SOLO `disponible`: a diferencia de actualizar(), aquí no se
 * reescribe la fila entera, así que agotar un plato no puede perder por el
 * camino un precio o una descripción que otro acabara de guardar.
 *
 * @returns {Promise<{plato: object, anterior: object}|null>} null si no existe.
 */
async function cambiarDisponibilidad(id, disponible) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT * FROM platos WHERE id_plato = $1 FOR UPDATE',
      [id]
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const r = await client.query(
      'UPDATE platos SET disponible = $1 WHERE id_plato = $2 RETURNING *',
      [disponible, id]
    );

    await client.query('COMMIT');
    return { plato: r.rows[0], anterior: actual.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM platos WHERE id_plato = $1 RETURNING id_plato',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Tope de filas del historial. Es defensivo, no una regla de negocio: un plato
 * con miles de cambios de precio no debería devolver una respuesta de megas.
 */
const MAX_HISTORIAL = 500;

/**
 * Cambios de precio de un plato, los más recientes primero (D-16 B, P2).
 *
 * Sale de `historial_precios`, que llenan los triggers. El índice
 * `idx_historial_precios_referencia` es exactamente `(tipo, id_referencia,
 * cambiado_en DESC)`, así que este orden no cuesta un sort.
 *
 * `id_usuario` puede ser NULL: un cambio hecho antes de D-16 B, por una
 * consulta a mano, o por un usuario que después se borró (la FK es
 * `ON DELETE SET NULL`). Se devuelve tal cual; quien lo muestre decide qué
 * poner.
 */
async function historialPrecios(id, { limite = 100 } = {}) {
  const tope = Math.min(Math.max(Number(limite) || 100, 1), MAX_HISTORIAL);
  const result = await pool.query(
    `SELECT id, tipo, id_referencia, precio_anterior, precio_nuevo, id_usuario, cambiado_en
       FROM historial_precios
      WHERE tipo = 'plato' AND id_referencia = $1
      ORDER BY cambiado_en DESC, id DESC
      LIMIT $2`,
    [id, tope]
  );
  return result.rows;
}

module.exports = {
  listar,
  obtenerPorId,
  crear,
  actualizar,
  cambiarDisponibilidad,
  eliminar,
  historialPrecios,
  MAX_HISTORIAL,
  TIEMPO_PREPARACION_POR_OMISION,
  PERSONALIZABLE_POR_OMISION,
  MOTIVO_CATEGORIA_INEXISTENTE,
  MENSAJE_CATEGORIA_INEXISTENTE,
  FK_CATEGORIA,
  traducirCategoria,
  traducirFkDePlato,
};
