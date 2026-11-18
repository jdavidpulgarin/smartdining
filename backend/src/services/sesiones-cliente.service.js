/**
 * D-19 parte B: los refresh tokens de los clientes (`refresh_tokens_cliente`,
 * scripts 36 y 37).
 *
 * Cada login o registro abre una FAMILIA nueva (uuid). Cada /refresh rota: el
 * token viejo queda con `reemplazado_por` y `rotado_en`, y se emite uno nuevo en
 * la misma familia. En la base solo está el SHA-256 de cada token.
 *
 * El orden de /refresh es el del contrato (docs/api-spec.md, "La ventana de
 * gracia del refresh"), en UNA transacción:
 *   1. (el formato del cuerpo lo valida el controller: 400 cuerpo_invalido)
 *   2. SELECT ... FOR UPDATE por hash; no existe -> 401 refresh_invalido
 *   3. vencido -> 401 refresh_invalido, sin revocar nada
 *   3b. cliente inactivo -> 401 refresh_invalido, sin revocar nada (el contrato
 *       no lo dice; un cliente desactivado no renueva su sesión)
 *   4. revocado -> se revoca la familia y 401 sesion_revocada
 *   5. rotado -> se bloquea también el reemplazo (siempre viejo -> nuevo) y:
 *        con gracia (rotado hace <= REFRESH_CLIENTE_GRACIA_SEGUNDOS, medido con
 *        now() de la base, y reemplazo sin usar ni revocar): se revoca el
 *        reemplazo, se emite un par nuevo en la familia y el viejo apunta a él,
 *        SIN tocar rotado_en (la ventana no se alarga);
 *        sin gracia: se revoca la familia y 401 sesion_revocada
 *   6. vigente -> rotación normal: primero el INSERT del nuevo, después el
 *      UPDATE del viejo con reemplazado_por y rotado_en = now().
 *
 * El 401 de los pasos 4 y 5 se responde DESPUÉS del COMMIT: la revocación de la
 * familia tiene que quedar guardada.
 *
 * El trigger tr_refresh_rotacion (script 37) no deja mover rotado_en una vez
 * puesto ni apuntar a un reemplazo de otro cliente u otra familia; este
 * servicio nunca intenta ninguna de las dos cosas.
 */

const crypto = require('crypto');
const pool = require('../config/db');
const { diasRefresh, graciaSegundos } = require('../config/clientes');
const { generarRefreshToken, hashDeRefresh } = require('../utils/refresh-token');
const { errorConMotivo } = require('../utils/error-con-motivo');

const MOTIVO_REFRESH_INVALIDO = 'refresh_invalido';
const MOTIVO_SESION_REVOCADA = 'sesion_revocada';

const MENSAJES = {
  [MOTIVO_REFRESH_INVALIDO]: 'La sesión no es válida o ya venció: inicia sesión de nuevo',
  [MOTIVO_SESION_REVOCADA]: 'La sesión fue cerrada por seguridad: inicia sesión de nuevo',
};

const SQL = Object.freeze({
  insertar: `INSERT INTO refresh_tokens_cliente (id_cliente, hash, familia, expira_en)
             VALUES ($1::int, $2::char(64), $3::uuid, now() + ($4::int * interval '1 day'))
             RETURNING id`,
  buscarPorHash: `SELECT r.id, r.id_cliente, r.familia, r.reemplazado_por,
                         (r.revocado_en IS NOT NULL) AS revocado,
                         (r.expira_en <= now()) AS vencido,
                         (r.rotado_en IS NOT NULL
                          AND now() - r.rotado_en <= make_interval(secs => $2::int)) AS en_gracia,
                         c.activo AS cliente_activo
                    FROM refresh_tokens_cliente r
                    JOIN clientes c ON c.id_cliente = r.id_cliente
                   WHERE r.hash = $1::char(64)
                     FOR UPDATE OF r`,
  bloquearReemplazo: `SELECT id, reemplazado_por, (revocado_en IS NOT NULL) AS revocado
                        FROM refresh_tokens_cliente
                       WHERE id = $1::bigint
                         FOR UPDATE`,
  revocarFamilia: `UPDATE refresh_tokens_cliente SET revocado_en = now()
                    WHERE familia = $1::uuid AND revocado_en IS NULL`,
  revocarUno: `UPDATE refresh_tokens_cliente SET revocado_en = now()
                WHERE id = $1::bigint AND revocado_en IS NULL`,
  rotar: `UPDATE refresh_tokens_cliente SET reemplazado_por = $2::bigint, rotado_en = now()
           WHERE id = $1::bigint`,
  reapuntar: `UPDATE refresh_tokens_cliente SET reemplazado_por = $2::bigint
               WHERE id = $1::bigint`,
  logout: `UPDATE refresh_tokens_cliente SET revocado_en = now()
            WHERE hash = $1::char(64) AND revocado_en IS NULL`,
});

/** Inserta un token nuevo y devuelve `{ id, refreshToken }` (el valor solo vive aquí). */
async function emitir(db, idCliente, familia, dias) {
  const refreshToken = generarRefreshToken();
  const { rows } = await db.query(SQL.insertar, [idCliente, hashDeRefresh(refreshToken), familia, dias]);
  return { id: rows[0].id, refreshToken };
}

/** Familia nueva: la de un login o un registro. */
function abrirSesion(db, idCliente, { env = process.env } = {}) {
  return emitir(db, idCliente, crypto.randomUUID(), diasRefresh(env));
}

/**
 * Pasos 2 a 6, dentro de una transacción ya abierta. Devuelve
 * `{ idCliente, refreshToken, via }` o `{ motivo }`.
 */
async function refrescarEnTransaccion(db, hash, { gracia, dias }) {
  const { rows } = await db.query(SQL.buscarPorHash, [hash, gracia]);
  const fila = rows[0];
  if (!fila) return { motivo: MOTIVO_REFRESH_INVALIDO };
  if (fila.vencido) return { motivo: MOTIVO_REFRESH_INVALIDO };
  if (!fila.cliente_activo) return { motivo: MOTIVO_REFRESH_INVALIDO };

  if (fila.revocado) {
    await db.query(SQL.revocarFamilia, [fila.familia]);
    return { motivo: MOTIVO_SESION_REVOCADA };
  }

  if (fila.reemplazado_por !== null && fila.reemplazado_por !== undefined) {
    const { rows: bloqueado } = await db.query(SQL.bloquearReemplazo, [fila.reemplazado_por]);
    const reemplazo = bloqueado[0];
    const conGracia =
      gracia > 0 &&
      fila.en_gracia === true &&
      Boolean(reemplazo) &&
      !reemplazo.revocado &&
      (reemplazo.reemplazado_por === null || reemplazo.reemplazado_por === undefined);

    if (!conGracia) {
      await db.query(SQL.revocarFamilia, [fila.familia]);
      return { motivo: MOTIVO_SESION_REVOCADA };
    }

    await db.query(SQL.revocarUno, [reemplazo.id]);
    const nuevo = await emitir(db, fila.id_cliente, fila.familia, dias);
    await db.query(SQL.reapuntar, [fila.id, nuevo.id]);
    return { idCliente: fila.id_cliente, refreshToken: nuevo.refreshToken, via: 'gracia' };
  }

  const nuevo = await emitir(db, fila.id_cliente, fila.familia, dias);
  await db.query(SQL.rotar, [fila.id, nuevo.id]);
  return { idCliente: fila.id_cliente, refreshToken: nuevo.refreshToken, via: 'rotacion' };
}

/**
 * POST /auth/clientes/refresh. Lanza un 401 con su motivo, o devuelve
 * `{ idCliente, refreshToken, via }`.
 */
async function refrescar(refreshToken, { env = process.env } = {}) {
  const hash = hashDeRefresh(refreshToken);
  const opciones = { gracia: graciaSegundos(env), dias: diasRefresh(env) };

  const client = await pool.connect();
  let resultado;
  try {
    await client.query('BEGIN');
    resultado = await refrescarEnTransaccion(client, hash, opciones);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (resultado.motivo) throw errorConMotivo(401, resultado.motivo, MENSAJES[resultado.motivo]);
  return resultado;
}

/** POST /auth/clientes/logout: revoca ESE token si aún no lo estaba. Nunca falla por el estado del token. */
async function cerrarSesion(refreshToken) {
  await pool.query(SQL.logout, [hashDeRefresh(refreshToken)]);
}

module.exports = {
  SQL,
  MOTIVO_REFRESH_INVALIDO,
  MOTIVO_SESION_REVOCADA,
  MENSAJES,
  emitir,
  abrirSesion,
  refrescarEnTransaccion,
  refrescar,
  cerrarSesion,
};
