const pool = require('../config/db');
const { traducirAutorInexistente } = require('./autor-inexistente');

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
 * (CHAR(3)), `actualizado_en` y `actualizado_por`; y del script 29, `correo`
 * (VARCHAR(254), opcional) y `redes` (JSONB, NOT NULL, '{}' = ninguna).
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
  // Script 29 (P-21): contacto del local para el sitio público.
  'correo',
  'redes',
];

/**
 * Tipo de cada parámetro del UPDATE, explícito: un mismo $N siempre con el
 * mismo tipo, sin dejar que PostgreSQL lo deduzca. `horario` y `redes` son
 * JSONB y viajan como texto JSON.
 */
const TIPO_COLUMNA = {
  nombre: 'text',
  telefono: 'text',
  direccion: 'text',
  url_logo: 'text',
  horario: 'jsonb',
  propina_sugerida_pct: 'numeric',
  moneda: 'text',
  correo: 'text',
  redes: 'jsonb',
};

/** Columnas JSONB: el valor se manda como texto JSON. */
const COLUMNAS_JSON = ['horario', 'redes'];

/**
 * Los CHECK del script 29, traducidos a 400 con su motivo. El esquema del PUT
 * ya aplica las mismas reglas, así que esto solo salta si alguna vez difieren;
 * aun así, un dato rechazado por la base no es un 500 ni un 422 genérico.
 */
const CHECKS_DE_CONTACTO = {
  ck_configuracion_correo: { motivo: 'correo_invalido', mensaje: 'El correo no tiene la forma nombre@dominio.com' },
  ck_configuracion_redes: { motivo: 'redes_invalidas', mensaje: 'Alguna red no tiene un enlace o número válido' },
};

function traducirCheckDeContacto(err) {
  if (!err || err.code !== '23514') return null;
  const regla = CHECKS_DE_CONTACTO[err.constraint];
  return regla ? { status: 400, message: regla.mensaje, motivo: regla.motivo } : null;
}

/** Toda la fila, como la ve un admin. */
async function obtener() {
  const result = await pool.query(
    `SELECT id, nombre, telefono, direccion, url_logo, horario,
            propina_sugerida_pct, moneda, correo, redes, actualizado_en, actualizado_por
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
    const asignaciones = columnas.map((c, i) => `${c} = $${i + 2}::${TIPO_COLUMNA[c]}`).join(', ');
    const valores = columnas.map((c) => {
      // `horario` y `redes` son JSONB: se mandan como texto JSON y se castean,
      // que es lo que espera el driver para un objeto. `redes` REEMPLAZA el
      // objeto entero (no se mezcla con el que había): {} deja sin redes.
      if (COLUMNAS_JSON.includes(c)) return JSON.stringify(cambios[c]);
      return cambios[c];
    });

    const result = await client.query(
      `UPDATE configuracion_restaurante
          SET ${asignaciones}
        WHERE id = $1
        RETURNING id, nombre, telefono, direccion, url_logo, horario,
                  propina_sugerida_pct, moneda, correo, redes, actualizado_en, actualizado_por`,
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
    // El AUTOR (review de #144): `tr_configuracion_actualizada` escribe
    // `actualizado_por` con el id del JWT, y la columna tiene su
    // `fk_configuracion_actualizado_por` contra `usuarios`. Si ese usuario ya se
    // borró, el 23503 salía como el 409 genérico de clave ajena, que no dice que
    // el problema sea la sesión de quien está editando.
    throw traducirAutorInexistente(err) || traducirCheckDeContacto(err) || err;
  } finally {
    client.release();
  }
}

module.exports = {
  obtener, actualizar, ID_CONFIGURACION, CAMPOS_EDITABLES, CHECKS_DE_CONTACTO, traducirCheckDeContacto,
};
