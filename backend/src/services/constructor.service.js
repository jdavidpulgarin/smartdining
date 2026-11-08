const pool = require('../config/db');

/**
 * Pasos e ingredientes del constructor de platos (D-04).
 *
 * Tablas de database/scripts/13_constructor.sql. La base es la fuente de verdad
 * y aquí NO se replica su lógica: los CHECK (min_sel <= max_sel, obligatorio =>
 * min_sel >= 1, orden > 0, precio_extra >= 0) y los UNIQUE los impone ella. El
 * controller valida antes para dar un 400 con un mensaje útil, pero si algo se
 * cuela, la base lo rechaza igual y aquí se traduce.
 *
 * TRADUCCIÓN DE ERRORES: el manejador central (errores.middleware.js) convierte
 * 23505, 23503 y 23514 en un 500 genérico a propósito, para no filtrar el
 * esquema. Esas tres situaciones aquí SÍ son del usuario —ya existe un paso con
 * ese orden, ese ingrediente ya se vendió—, así que se capturan por código y se
 * relanzan como { status, message }, que es la primera rama del manejador. No se
 * toca el middleware: el cambio sería transversal a todas las rutas (eso es
 * H-11, aparte).
 */

// SQLSTATE de PostgreSQL que aquí tienen un significado de negocio.
const PG_UNIQUE = '23505';
const PG_FK = '23503';
const PG_CHECK = '23514';

// Nombres de los constraints de 13_constructor.sql. Se distinguen para poder
// decir QUÉ choca: "ya hay un paso en esa posición" no es lo mismo que "ya hay
// un paso con ese nombre".
const UQ_PASO_ORDEN = 'uq_pasos_plato_orden';
const UQ_PASO_NOMBRE = 'uq_pasos_plato_nombre';
const UQ_INGREDIENTE_NOMBRE = 'uq_ingredientes_paso_nombre';

const MENSAJE_PASO_VENDIDO =
  'Ese paso tiene ingredientes que ya se usaron en pedidos: no se puede borrar, '
  + 'marca sus ingredientes como no disponibles';
const MENSAJE_INGREDIENTE_VENDIDO =
  'Ese ingrediente ya se usó en pedidos: no se puede borrar, márcalo como no disponible';

/**
 * Traduce un error de PostgreSQL a un error de negocio con su status.
 *
 * `constraint` viene en el error de pg, así que no hay que adivinar por el
 * texto del mensaje (que además está en el idioma del servidor).
 *
 * @param {Error & {code?: string, constraint?: string}} err
 * @param {{alBorrar?: 'paso'|'ingrediente'}} contexto
 */
function traducirError(err, contexto = {}) {
  if (!err || typeof err.code !== 'string') return err;

  if (err.code === PG_UNIQUE) {
    if (err.constraint === UQ_PASO_ORDEN) {
      return { status: 409, message: 'Ya hay otro paso de este plato en esa posición' };
    }
    if (err.constraint === UQ_PASO_NOMBRE) {
      return { status: 409, message: 'Ya hay otro paso de este plato con ese nombre' };
    }
    if (err.constraint === UQ_INGREDIENTE_NOMBRE) {
      return { status: 409, message: 'Ya hay otro ingrediente de este paso con ese nombre' };
    }
    return { status: 409, message: 'Ese valor ya está en uso' };
  }

  // RESTRICT de detalles_ingredientes: un ingrediente ya vendido no se borra,
  // así los pedidos históricos conservan su composición (lo decide el esquema).
  // Al borrar un PASO la cascada hacia ingredientes se topa con ese mismo
  // RESTRICT, así que el paso queda protegido de rebote y llega el mismo código.
  if (err.code === PG_FK && contexto.alBorrar) {
    return {
      status: 409,
      message: contexto.alBorrar === 'paso' ? MENSAJE_PASO_VENDIDO : MENSAJE_INGREDIENTE_VENDIDO,
    };
  }

  // Red de seguridad: un CHECK que el controller no atajó. 422 como la clase 22.
  if (err.code === PG_CHECK) {
    return { status: 422, message: 'Algún valor está fuera del rango permitido' };
  }

  return err;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Pasos de un plato con sus ingredientes anidados.
 *
 * Misma forma y mismo orden que obtener_menu_completo (13_constructor.sql): por
 * `orden` los pasos y por `id_ingrediente` los ingredientes, para que el panel
 * y el menú del comensal muestren lo mismo. Los ingredientes agotados SÍ se
 * devuelven (con disponible = false): el panel tiene que poder volver a
 * activarlos.
 *
 * Es una sola consulta por plato: los ingredientes vienen con json_agg en el
 * mismo viaje, no una consulta por paso.
 */
const SQL_PASOS_DE_PLATO = `
  SELECT pc.id_paso, pc.id_plato, pc.nombre, pc.orden, pc.min_sel, pc.max_sel,
         pc.obligatorio,
         COALESCE((
           SELECT json_agg(
             json_build_object(
               'id_ingrediente', i.id_ingrediente,
               'id_paso', i.id_paso,
               'nombre', i.nombre,
               'precio_extra', i.precio_extra,
               'calorias', i.calorias,
               'alergenos', i.alergenos,
               'url_imagen', i.url_imagen,
               'disponible', i.disponible
             ) ORDER BY i.id_ingrediente ASC
           )
           FROM ingredientes i
           WHERE i.id_paso = pc.id_paso
         ), '[]'::json) AS ingredientes
  FROM pasos_constructor pc
  WHERE pc.id_plato = $1
  ORDER BY pc.orden ASC`;

async function pasosDePlato(idPlato) {
  const r = await pool.query(SQL_PASOS_DE_PLATO, [idPlato]);
  return r.rows;
}

async function obtenerPaso(idPaso) {
  const r = await pool.query(
    `SELECT pc.* FROM pasos_constructor pc WHERE pc.id_paso = $1`,
    [idPaso]
  );
  return r.rows[0] || null;
}

async function obtenerIngrediente(idIngrediente) {
  const r = await pool.query(
    `SELECT i.* FROM ingredientes i WHERE i.id_ingrediente = $1`,
    [idIngrediente]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Pasos
// ---------------------------------------------------------------------------

/**
 * Crea un paso. `id_plato` viene de la URL, nunca del cuerpo.
 *
 * `calorias` no aplica aquí; en los pasos no hay campos que normalizar más allá
 * de lo que ya hizo el controller.
 */
async function crearPaso(idPlato, datos) {
  try {
    const r = await pool.query(
      `INSERT INTO pasos_constructor (id_plato, nombre, orden, min_sel, max_sel, obligatorio)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id_paso, id_plato, nombre, orden, min_sel, max_sel, obligatorio`,
      [idPlato, datos.nombre, datos.orden, datos.min_sel, datos.max_sel, datos.obligatorio]
    );
    // El panel espera la lista de ingredientes en el paso recién creado; un
    // paso nuevo no tiene ninguno todavía.
    return { ...r.rows[0], ingredientes: [] };
  } catch (err) {
    throw traducirError(err);
  }
}

/**
 * Actualización PARCIAL de un paso, dentro de UNA transacción.
 *
 * La fila se lee con FOR UPDATE y se mezcla y valida con el bloqueo tomado: sin
 * eso, dos PUT simultáneos sobre el mismo paso leen el mismo estado y el
 * segundo puede dejar una combinación que ninguno de los dos pidió (por ejemplo
 * uno sube min_sel y el otro baja max_sel: cada uno valida contra lo que leyó y
 * el resultado viola min_sel <= max_sel). Los CHECK de la base lo atraparían,
 * pero devolviendo un 500 en vez de explicar qué pasó.
 *
 * El try/catch rodea el COMMIT a propósito: uq_pasos_plato_orden es DEFERRABLE
 * INITIALLY DEFERRED, así que un orden duplicado NO falla en el UPDATE sino al
 * confirmar. Si el catch solo cubriera el UPDATE, ese 23505 se escaparía como
 * 500.
 *
 * @param {(fila: object) => void} validar Lanza { status, message } si la
 *        mezcla no cumple las reglas. Lo pone el controller, que es quien tiene
 *        los mensajes de validación.
 */
async function actualizarPaso(idPaso, cambios, validar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      `SELECT pc.* FROM pasos_constructor pc WHERE pc.id_paso = $1 FOR UPDATE`,
      [idPaso]
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const fila = { ...actual.rows[0], ...cambios };
    if (validar) validar(fila);

    const r = await client.query(
      `UPDATE pasos_constructor
          SET nombre = $1, orden = $2, min_sel = $3, max_sel = $4, obligatorio = $5
        WHERE id_paso = $6
        RETURNING id_paso, id_plato, nombre, orden, min_sel, max_sel, obligatorio`,
      [fila.nombre, fila.orden, fila.min_sel, fila.max_sel, fila.obligatorio, idPaso]
    );

    // Dentro del try: aquí es donde salta el UNIQUE diferido del orden.
    await client.query('COMMIT');
    return r.rows[0];
  } catch (err) {
    // Puede fallar si la transacción ya murió en el COMMIT; no importa.
    await client.query('ROLLBACK').catch(() => {});
    throw traducirError(err);
  } finally {
    client.release();
  }
}

/**
 * Borra un paso. Si alguno de sus ingredientes ya se vendió, el RESTRICT de
 * detalles_ingredientes aborta la cascada y esto responde 409.
 */
async function eliminarPaso(idPaso) {
  try {
    const r = await pool.query(
      `DELETE FROM pasos_constructor WHERE id_paso = $1 RETURNING id_paso`,
      [idPaso]
    );
    return r.rows.length > 0;
  } catch (err) {
    throw traducirError(err, { alBorrar: 'paso' });
  }
}

// ---------------------------------------------------------------------------
// Ingredientes
// ---------------------------------------------------------------------------

/**
 * Crea un ingrediente. `id_paso` viene de la URL, nunca del cuerpo.
 *
 * `calorias` se OMITE de la sentencia cuando no viene: la columna es
 * NOT NULL DEFAULT 0 y el panel manda null. Dejar actuar al DEFAULT en vez de
 * escribir un 0 a mano mantiene el valor alineado si Jarrison cambia el default.
 */
async function crearIngrediente(idPaso, datos) {
  const columnas = ['id_paso', 'nombre', 'precio_extra', 'alergenos', 'url_imagen', 'disponible'];
  const valores = [
    idPaso,
    datos.nombre,
    datos.precio_extra,
    datos.alergenos,
    datos.url_imagen,
    datos.disponible,
  ];

  if (datos.calorias !== undefined) {
    columnas.push('calorias');
    valores.push(datos.calorias);
  }

  const marcadores = valores.map((_, i) => `$${i + 1}`).join(', ');

  try {
    const r = await pool.query(
      `INSERT INTO ingredientes (${columnas.join(', ')})
       VALUES (${marcadores})
       RETURNING id_ingrediente, id_paso, nombre, precio_extra, calorias, alergenos,
                 url_imagen, disponible`,
      valores
    );
    return r.rows[0];
  } catch (err) {
    throw traducirError(err);
  }
}

/**
 * Actualización PARCIAL de un ingrediente, con el mismo criterio que el paso:
 * leer con FOR UPDATE, mezclar y escribir en la misma transacción.
 *
 * Aquí no hay constraint diferido, pero el catch rodea el COMMIT igual: cuesta
 * lo mismo y evita que el día que se agregue uno este camino se quede atrás.
 *
 * DEVUELVE `{ ingrediente, anterior }` y no solo la fila nueva, a diferencia de
 * actualizarIngrediente/actualizarPaso del resto del módulo. El motivo es D-05:
 * para avisar al socket-server SOLO cuando `disponible` cambió de verdad hace
 * falta el valor previo, y el único sitio donde existe sin una segunda consulta
 * —y sin carrera con otra edición— es dentro de esta transacción, que ya lee la
 * fila con FOR UPDATE. `anterior` es la fila completa de antes del UPDATE.
 *
 * Sigue devolviendo `null` si el ingrediente no existe.
 */
async function actualizarIngrediente(idIngrediente, cambios, validar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      `SELECT i.* FROM ingredientes i WHERE i.id_ingrediente = $1 FOR UPDATE`,
      [idIngrediente]
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const fila = { ...actual.rows[0], ...cambios };
    if (validar) validar(fila);

    const r = await client.query(
      `UPDATE ingredientes
          SET nombre = $1, precio_extra = $2, calorias = $3, alergenos = $4,
              url_imagen = $5, disponible = $6
        WHERE id_ingrediente = $7
        RETURNING id_ingrediente, id_paso, nombre, precio_extra, calorias, alergenos,
                  url_imagen, disponible`,
      [
        fila.nombre,
        fila.precio_extra,
        fila.calorias,
        fila.alergenos,
        fila.url_imagen,
        fila.disponible,
        idIngrediente,
      ]
    );

    await client.query('COMMIT');
    return { ingrediente: r.rows[0], anterior: actual.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw traducirError(err);
  } finally {
    client.release();
  }
}

async function eliminarIngrediente(idIngrediente) {
  try {
    const r = await pool.query(
      `DELETE FROM ingredientes WHERE id_ingrediente = $1 RETURNING id_ingrediente`,
      [idIngrediente]
    );
    return r.rows.length > 0;
  } catch (err) {
    throw traducirError(err, { alBorrar: 'ingrediente' });
  }
}

module.exports = {
  pasosDePlato,
  obtenerPaso,
  obtenerIngrediente,
  crearPaso,
  actualizarPaso,
  eliminarPaso,
  crearIngrediente,
  actualizarIngrediente,
  eliminarIngrediente,
  MENSAJE_PASO_VENDIDO,
  MENSAJE_INGREDIENTE_VENDIDO,
};
