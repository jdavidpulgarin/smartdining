/**
 * D-19 parte B: zonas de entrega (`zonas_envio`, script 36).
 *
 * Cotizar NO reimplementa la normalización de barrios: llama a
 * `cotizar_zona(barrio)` de la base, que compara `fn_clave_barrio` contra
 * `fn_clave_barrio` (sin tildes, minúsculas, espacios colapsados). Así
 * "  Los   Álamos " y "los alamos" son el mismo barrio en la app, en la API y
 * en la base, y la regla vive en un solo lugar.
 */

const pool = require('../config/db');

/** Solo las activas, con lo que el contrato publica. */
async function listarActivas(db = pool) {
  const { rows } = await db.query(
    `SELECT id_zona, nombre, barrios, costo_envio, tiempo_estimado_min
       FROM zonas_envio
      WHERE activa
      ORDER BY id_zona`
  );
  return rows;
}

/**
 * La zona de una dirección DEL CLIENTE. Devuelve:
 *   - null si la dirección no existe o no es suya (el controller responde 404);
 *   - `{ zona: null }` si no cae en ninguna zona activa (422);
 *   - `{ zona, costo_envio }` si cae en una.
 */
async function cotizar(idCliente, idDireccion, db = pool) {
  const { rows } = await db.query(
    `SELECT d.id_direccion, z.id_zona, z.nombre, z.costo_envio, z.tiempo_estimado_min
       FROM direcciones d
       LEFT JOIN LATERAL cotizar_zona(d.barrio::text) z ON TRUE
      WHERE d.id_direccion = $1::int AND d.id_cliente = $2::int`,
    [idDireccion, idCliente]
  );
  const fila = rows[0];
  if (!fila) return null;
  if (fila.id_zona === null || fila.id_zona === undefined) return { zona: null };
  return {
    zona: { id_zona: fila.id_zona, nombre: fila.nombre, tiempo_estimado_min: fila.tiempo_estimado_min },
    costo_envio: fila.costo_envio,
  };
}

/* -------------------------------------------------------------------------- *
 * D-20a: las zonas para el ADMIN (/zonas-envio). Todas, también las inactivas.
 * No se borran: se desactivan (`activa: false`), porque pedidos_domicilio las
 * referencia con ON DELETE RESTRICT.
 * -------------------------------------------------------------------------- */

const { errorConMotivo } = require('../utils/error-con-motivo');

const COLUMNAS_ADMIN =
  'id_zona, nombre, barrios, costo_envio, tiempo_estimado_min, activa, creado_en, actualizado_en';

/** Columnas que el admin puede escribir, con su tipo explícito. Nunca salen del cuerpo. */
const TIPOS_ZONA = Object.freeze({
  nombre: '::varchar',
  barrios: '::text[]',
  costo_envio: '::numeric',
  tiempo_estimado_min: '::int',
  activa: '::boolean',
});

const MOTIVOS_ZONA = Object.freeze({
  barrioEnOtraZona: 'barrio_en_otra_zona',
  barrioRepetido: 'barrio_repetido',
  zonaDuplicada: 'zona_duplicada',
});

/** Mensajes del trigger fn_tr_validar_zona_envio (script 36): son fijos. */
const PATRON_BARRIO_EN_OTRA = /^El barrio "(.*)" ya está en la zona activa "(.*)"$/;
const PATRON_BARRIO_REPETIDO = /^El barrio "(.*)" está repetido en la zona/;

/**
 * Traduce los choques de una zona a `{ status, motivo }`. Solo se toma del
 * mensaje del trigger el barrio y la zona con la que choca (datos que el admin
 * ya ve en GET /zonas-envio); nunca el `detail` ni el contexto de PostgreSQL.
 */
function traducirErrorZona(err) {
  if (!err || err.code !== '23505') return null;
  if (err.constraint === 'zonas_envio_nombre_key') {
    return errorConMotivo(409, MOTIVOS_ZONA.zonaDuplicada, 'Ya existe una zona con ese nombre');
  }
  const otra = PATRON_BARRIO_EN_OTRA.exec(err.message || '');
  if (otra) {
    const e = errorConMotivo(
      409,
      MOTIVOS_ZONA.barrioEnOtraZona,
      `El barrio "${otra[1]}" ya está en otra zona activa ("${otra[2]}")`
    );
    e.extra = { barrio: otra[1], zona: otra[2] };
    return e;
  }
  const repetido = PATRON_BARRIO_REPETIDO.exec(err.message || '');
  if (repetido) {
    const e = errorConMotivo(400, MOTIVOS_ZONA.barrioRepetido, `El barrio "${repetido[1]}" está dos veces en la zona`);
    e.extra = { barrio: repetido[1] };
    return e;
  }
  return null;
}

async function listarTodas(db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_ADMIN} FROM zonas_envio ORDER BY id_zona`
  );
  return rows;
}

async function crearZona(datos, db = pool) {
  try {
    const { rows } = await db.query(
      `INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min, activa)
       VALUES ($1::varchar, $2::text[], $3::numeric, $4::int, $5::boolean)
       RETURNING ${COLUMNAS_ADMIN}`,
      [datos.nombre, datos.barrios, datos.costo_envio, datos.tiempo_estimado_min, datos.activa ?? true]
    );
    return rows[0];
  } catch (err) {
    throw traducirErrorZona(err) || err;
  }
}

/** Devuelve la zona editada, o null si no existe. */
async function actualizarZona(idZona, datos, db = pool) {
  const params = [idZona];
  const sets = Object.keys(TIPOS_ZONA)
    .filter((col) => Object.prototype.hasOwnProperty.call(datos, col))
    .map((col) => {
      params.push(datos[col]);
      return `${col} = $${params.length}${TIPOS_ZONA[col]}`;
    });
  try {
    const { rows } = await db.query(
      `UPDATE zonas_envio SET ${sets.join(', ')}
        WHERE id_zona = $1::int
        RETURNING ${COLUMNAS_ADMIN}`,
      params
    );
    return rows[0] || null;
  } catch (err) {
    throw traducirErrorZona(err) || err;
  }
}

module.exports = {
  listarActivas,
  cotizar,
  listarTodas,
  crearZona,
  actualizarZona,
  traducirErrorZona,
  MOTIVOS_ZONA,
};
