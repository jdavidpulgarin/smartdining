/**
 * D-19 parte B: la tabla `clientes` (script 36).
 *
 * Las columnas que salen hacia afuera son SIEMPRE las de COLUMNAS_PUBLICAS:
 * nunca `password_hash`. El hash solo lo lee `buscarParaLogin`, que no se
 * devuelve tal cual a ninguna respuesta.
 */

const pool = require('../config/db');

/** Lo que el contrato llama `cliente`: { id_cliente, nombre, email, telefono, verificado }. */
const COLUMNAS_PUBLICAS = 'id_cliente, nombre, email, telefono, verificado';

/** Constraint del email único (sobre lower(email)), para traducir la carrera del registro. */
const UQ_EMAIL = 'uq_clientes_email';

/** El objeto `cliente` de las respuestas, a partir de una fila. */
function clientePublico(fila) {
  return {
    id_cliente: fila.id_cliente,
    nombre: fila.nombre,
    email: fila.email,
    telefono: fila.telefono,
    verificado: fila.verificado,
  };
}

/**
 * Para el login: la fila con el hash y `activo`. El email ya viene normalizado
 * (trim + minúsculas) y se compara con lower(email), que es lo que indexa
 * uq_clientes_email.
 */
async function buscarParaLogin(email, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_PUBLICAS}, activo, password_hash
       FROM clientes WHERE lower(email) = $1::text`,
    [email]
  );
  return rows[0] || null;
}

/** Crea el cliente. Un email repetido sale como 23505 de uq_clientes_email. */
async function insertar({ nombre, email, telefono, password_hash }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO clientes (nombre, email, telefono, password_hash)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar)
     RETURNING ${COLUMNAS_PUBLICAS}`,
    [nombre, email, telefono, password_hash]
  );
  return rows[0];
}

/** ¿Es el 23505 del email único? (la carrera de dos registros con el mismo email). */
function esEmailRepetido(err) {
  return Boolean(err) && err.code === '23505' && err.constraint === UQ_EMAIL;
}

async function obtener(idCliente, db = pool) {
  const { rows } = await db.query(
    `SELECT ${COLUMNAS_PUBLICAS} FROM clientes WHERE id_cliente = $1::int`,
    [idCliente]
  );
  return rows[0] || null;
}

/** id y activo, para el middleware de sesión (H-09 aplicado a clientes). */
async function buscarEstado(idCliente, db = pool) {
  const { rows } = await db.query(
    'SELECT id_cliente, activo FROM clientes WHERE id_cliente = $1::int',
    [idCliente]
  );
  return rows[0] || null;
}

/**
 * PATCH /clientes/yo. `datos` ya viene validado y solo con las claves que se
 * cambian (nombre y/o telefono); las columnas salen de una lista fija, nunca
 * del cuerpo.
 */
async function actualizarPerfil(idCliente, datos, db = pool) {
  const columnas = [
    ['nombre', '::varchar'],
    ['telefono', '::varchar'],
  ].filter(([col]) => Object.prototype.hasOwnProperty.call(datos, col));

  const params = [idCliente];
  const sets = columnas.map(([col, tipo]) => {
    params.push(datos[col]);
    return `${col} = $${params.length}${tipo}`;
  });

  const { rows } = await db.query(
    `UPDATE clientes SET ${sets.join(', ')}, actualizado_en = now()
      WHERE id_cliente = $1::int
      RETURNING ${COLUMNAS_PUBLICAS}`,
    params
  );
  return rows[0] || null;
}

module.exports = {
  COLUMNAS_PUBLICAS,
  UQ_EMAIL,
  clientePublico,
  buscarParaLogin,
  insertar,
  esEmailRepetido,
  obtener,
  buscarEstado,
  actualizarPerfil,
};
