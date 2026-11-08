const pool = require('../config/db');

/**
 * Configuración del restaurante (D-16 parte B, tabla `configuracion_restaurante`).
 *
 * Es UNA sola fila, con `id = 1` fijado por un CHECK
 * (`ck_configuracion_fila_unica`, en database/scripts/26_configuracion.sql): no
 * hay nada que crear ni que borrar, solo leer y actualizar. El script ya inserta
 * la fila con los valores por defecto, así que el backend nunca hace INSERT.
 *
 * Columnas, tal como están en el script: `nombre`, `telefono`, `direccion`,
 * `url_logo`, `horario` (JSONB), `propina_sugerida_pct` (NUMERIC(4,2)), `moneda`
 * (CHAR(3)), `actualizado_en` y `actualizado_por`.
 *
 * `actualizado_en` y `actualizado_por` NO los escribe el backend: los pone el
 * trigger `tr_configuracion_actualizada` en cada UPDATE, y el autor sale de
 * `app.id_usuario`.
 */

/** La fila única. El CHECK de la tabla no admite otra. */
const ID_CONFIGURACION = 1;

/**
 * Columnas que el backend sabe actualizar, en el orden en que se arma el UPDATE.
 * `actualizado_en`/`actualizado_por` quedan fuera a propósito: son del trigger.
 */
const CAMPOS_EDITABLES = [
  'nombre',
  'telefono',
  'direccion',
  'url_logo',
  'horario',
  'propina_sugerida_pct',
  'moneda',
];

/** Toda la fila, como la ve un admin. */
async function obtener() {
  const result = await pool.query(
    `SELECT id, nombre, telefono, direccion, url_logo, horario,
            propina_sugerida_pct, moneda, actualizado_en, actualizado_por
       FROM configuracion_restaurante
      WHERE id = $1`,
    [ID_CONFIGURACION]
  );
  return result.rows[0] || null;
}

/**
 * Actualiza solo los campos que vengan en `cambios` (PUT parcial).
 *
 * Va en una TRANSACCIÓN y lo primero que hace es
 * `set_config('app.id_usuario', <id>, true)`, con el tercer argumento en `true`
 * (`is_local`): el valor vive solo hasta el fin de la transacción. Es lo que lee
 * `fn_usuario_de_sesion()` para llenar `actualizado_por`, y sin eso ese campo
 * quedaría en NULL y no se sabría quién cambió la configuración del local.
 *
 * `set_config` y no `SET LOCAL` porque solo la primera admite parámetros ($1):
 * con `SET LOCAL` habría que interpolar el id en el texto del SQL.
 *
 * El UPDATE se arma solo con las columnas enviadas, así que un PUT que manda el
 * teléfono no reescribe el horario con un valor viejo que el cliente ni vio.
 *
 * @param {object} cambios
 * @param {{idUsuario?: number|null}} contexto
 * @returns {Promise<object|null>} la fila completa ya actualizada.
 */
async function actualizar(cambios, { idUsuario = null } = {}) {
  const columnas = CAMPOS_EDITABLES.filter((c) => Object.hasOwn(cambios, c));
  if (columnas.length === 0) return obtener();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El autor del cambio, para el trigger. Va DENTRO de la transacción: con
    // `is_local = true` el valor no se filtra a la siguiente petición que use
    // esta misma conexión del pool.
    await client.query('SELECT set_config($1, $2, true)', [
      'app.id_usuario',
      idUsuario === null || idUsuario === undefined ? '' : String(idUsuario),
    ]);

    // $1 es el id; los valores empiezan en $2.
    const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const valores = columnas.map((c) => {
      // `horario` es JSONB: se manda como texto JSON y se castea, que es lo que
      // espera el driver para un objeto.
      if (c === 'horario') return JSON.stringify(cambios[c]);
      return cambios[c];
    });

    const result = await client.query(
      `UPDATE configuracion_restaurante
          SET ${asignaciones}
        WHERE id = $1
        RETURNING id, nombre, telefono, direccion, url_logo, horario,
                  propina_sugerida_pct, moneda, actualizado_en, actualizado_por`,
      [ID_CONFIGURACION, ...valores]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada: no hay nada que deshacer.
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { obtener, actualizar, ID_CONFIGURACION, CAMPOS_EDITABLES };
