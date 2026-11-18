/**
 * D-19 parte B: las direcciones del cliente (`direcciones`, script 36).
 *
 * Todo va SIEMPRE con el id del cliente del JWT: una dirección de otro cliente
 * es indistinguible de una que no existe (404 en las dos).
 *
 * UNA SOLA PRINCIPAL. La base lo garantiza con uq_direcciones_principal (índice
 * único parcial sobre id_cliente WHERE principal); aquí se respeta sin chocar
 * con él:
 *   - cada escritura bloquea primero la fila del CLIENTE (`FOR UPDATE`), así
 *     que dos cambios del mismo cliente a la vez se ponen en fila y nunca hay
 *     dos principales ni un 23505 por la carrera;
 *   - marcar una como principal desmarca la anterior en la MISMA transacción,
 *     antes de marcar la nueva.
 *
 * Decisiones donde el contrato no dice (docs/api-spec.md, "Direcciones"):
 *   - la primera dirección de un cliente nace principal aunque llegue con
 *     `principal: false` (eso sí lo dice el contrato);
 *   - `principal: false` sobre LA principal da 409 `principal_requerida`: para
 *     cambiarla se marca otra como principal. Así, mientras el cliente tenga
 *     direcciones, siempre hay exactamente una principal;
 *   - al borrar la principal, pasa a ser principal la más reciente de las que
 *     quedan (por creado_en, y por id si empatan). Si no queda ninguna, no hay
 *     principal.
 */

const pool = require('../config/db');
const { errorConMotivo } = require('../utils/error-con-motivo');

const COLUMNAS = 'id_direccion, direccion, barrio, referencia, lat, lng, principal, creado_en';

const MOTIVO_NO_ENCONTRADO = 'no_encontrado';
const MOTIVO_PRINCIPAL_REQUERIDA = 'principal_requerida';
const MENSAJE_NO_ENCONTRADA = 'Dirección no encontrada';
const MENSAJE_PRINCIPAL_REQUERIDA =
  'Siempre tiene que haber una dirección principal: marca otra como principal en vez de desmarcar esta';

const noEncontrada = () => errorConMotivo(404, MOTIVO_NO_ENCONTRADO, MENSAJE_NO_ENCONTRADA);

/** Columnas que se pueden escribir, con su tipo explícito. Nunca salen del cuerpo. */
const TIPOS = Object.freeze({
  direccion: '::varchar',
  barrio: '::varchar',
  referencia: '::varchar',
  lat: '::numeric',
  lng: '::numeric',
  principal: '::boolean',
});

async function listar(idCliente, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} FROM direcciones
      WHERE id_cliente = $1::int
      ORDER BY principal DESC, creado_en DESC, id_direccion DESC`,
    [idCliente]
  );
  return rows;
}

/**
 * Abre una transacción con la fila del cliente bloqueada y ejecuta `trabajo`.
 * Si el cliente ya no existe, 404 (no debería pasar: el middleware lo comprobó).
 */
async function conClienteBloqueado(idCliente, trabajo) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id_cliente FROM clientes WHERE id_cliente = $1::int FOR UPDATE',
      [idCliente]
    );
    if (rows.length === 0) throw noEncontrada();
    const resultado = await trabajo(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const desmarcarPrincipal = (db, idCliente) =>
  db.query('UPDATE direcciones SET principal = FALSE WHERE id_cliente = $1::int AND principal', [idCliente]);

async function crear(idCliente, datos) {
  return conClienteBloqueado(idCliente, async (db) => {
    const { rows: cuenta } = await db.query(
      'SELECT count(*)::int AS n FROM direcciones WHERE id_cliente = $1::int',
      [idCliente]
    );
    const principal = cuenta[0].n === 0 || datos.principal === true;
    if (principal) await desmarcarPrincipal(db, idCliente);

    const { rows } = await db.query(
      `INSERT INTO direcciones (id_cliente, direccion, barrio, referencia, lat, lng, principal)
       VALUES ($1::int, $2::varchar, $3::varchar, $4::varchar, $5::numeric, $6::numeric, $7::boolean)
       RETURNING ${COLUMNAS}`,
      [
        idCliente,
        datos.direccion,
        datos.barrio,
        datos.referencia ?? null,
        datos.lat ?? null,
        datos.lng ?? null,
        principal,
      ]
    );
    return rows[0];
  });
}

async function actualizar(idCliente, idDireccion, datos) {
  return conClienteBloqueado(idCliente, async (db) => {
    const { rows: actuales } = await db.query(
      `SELECT ${COLUMNAS} FROM direcciones
        WHERE id_direccion = $1::int AND id_cliente = $2::int
          FOR UPDATE`,
      [idDireccion, idCliente]
    );
    const actual = actuales[0];
    if (!actual) throw noEncontrada();

    if (datos.principal === false && actual.principal) {
      throw errorConMotivo(409, MOTIVO_PRINCIPAL_REQUERIDA, MENSAJE_PRINCIPAL_REQUERIDA);
    }
    if (datos.principal === true && !actual.principal) await desmarcarPrincipal(db, idCliente);

    const params = [idDireccion, idCliente];
    const sets = Object.keys(TIPOS)
      .filter((col) => Object.prototype.hasOwnProperty.call(datos, col))
      .map((col) => {
        params.push(datos[col]);
        return `${col} = $${params.length}${TIPOS[col]}`;
      });

    const { rows } = await db.query(
      `UPDATE direcciones SET ${sets.join(', ')}
        WHERE id_direccion = $1::int AND id_cliente = $2::int
        RETURNING ${COLUMNAS}`,
      params
    );
    return rows[0];
  });
}

async function eliminar(idCliente, idDireccion) {
  return conClienteBloqueado(idCliente, async (db) => {
    const { rows } = await db.query(
      `DELETE FROM direcciones
        WHERE id_direccion = $1::int AND id_cliente = $2::int
        RETURNING principal`,
      [idDireccion, idCliente]
    );
    if (rows.length === 0) throw noEncontrada();

    if (rows[0].principal) {
      await db.query(
        `UPDATE direcciones SET principal = TRUE
          WHERE id_direccion = (SELECT id_direccion FROM direcciones
                                 WHERE id_cliente = $1::int
                                 ORDER BY creado_en DESC, id_direccion DESC
                                 LIMIT 1)`,
        [idCliente]
      );
    }
  });
}

module.exports = {
  COLUMNAS,
  MOTIVO_PRINCIPAL_REQUERIDA,
  MENSAJE_NO_ENCONTRADA,
  listar,
  crear,
  actualizar,
  eliminar,
};
