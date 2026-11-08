const pool = require('../config/db');

// Tabla usuarios (docs/modelo-er.md): id_usuario, nombre, email, password_hash,
// rol, activo, creado_en. No tiene telefono.

async function buscarPorEmail(email) {
  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Lee lo mínimo para decidir si un token sigue sirviendo (H-09).
 *
 * Se piden solo tres columnas y no `SELECT *`: esto se consulta en cada
 * petición del personal (con caché, pero igual), y el hash de la contraseña no
 * tiene por qué pasearse por ahí.
 */
async function buscarPorId(idUsuario) {
  const result = await pool.query(
    'SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1',
    [idUsuario]
  );
  return result.rows[0] || null;
}

async function crear({ nombre, email, password_hash, rol }) {
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, creado_en)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id_usuario, nombre, email, rol, activo`,
    [nombre, email, password_hash, rol]
  );
  return result.rows[0];
}

/* ========================================================================== *
 * Administración de usuarios (D-16): listar, editar y cambiar la clave.
 *
 * Las columnas son las del schema.sql y nada más: id_usuario, nombre, email,
 * password_hash, rol, activo, creado_en. No hay `telefono` ni `actualizado_en`.
 *
 * `password_hash` NO sale de aquí en ninguna de estas funciones: el panel no lo
 * necesita para nada y un hash en una respuesta acaba en la caché del navegador,
 * en los logs del proxy y en la pestaña de red de quien tenga el portátil
 * abierto. Las lecturas piden las columnas una por una, nunca `SELECT *`, para
 * que agregar una columna sensible a la tabla no la publique sola.
 *
 * ROL EN MINÚSCULAS: los valores válidos son los del CHECK de la tabla y los
 * mismos que ya usa el registro (ROLES_STAFF del middleware de auth).
 * ========================================================================== */

/** SQLSTATE de unicidad: aquí solo puede ser el email, que es el único UNIQUE. */
const PG_UNIQUE = '23505';

/** Las columnas que el panel ve. Una sola definición para no desalinearlas. */
const COLUMNAS_PUBLICAS = 'u.id_usuario, u.nombre, u.email, u.rol, u.activo, u.creado_en';

const MENSAJE_ULTIMO_ADMIN =
  'No se puede dejar el sistema sin ningún admin activo: asciende o activa a otro antes.';
const MENSAJE_A_SI_MISMO =
  'No puedes desactivarte ni cambiarte el rol a ti mismo: pídeselo a otro admin.';
const MENSAJE_EMAIL_EN_USO = 'Ese email ya está registrado';

/** Error de negocio con status, que es la primera rama de errores.middleware. */
function errorDeNegocio(status, message) {
  return { status, message };
}

/**
 * Todos los usuarios del personal, para el panel de administración.
 *
 * Ordenados por id y no por nombre: es el orden en que se dieron de alta, que es
 * estable (dos personas pueden llamarse igual) y el que espera quien acaba de
 * crear una cuenta y la busca al final de la lista.
 */
async function listar() {
  const result = await pool.query(
    `SELECT ${COLUMNAS_PUBLICAS} FROM usuarios u ORDER BY u.id_usuario`
  );
  return result.rows;
}

/**
 * ¿Quedaría algún admin activo si este usuario deja de serlo?
 *
 * Se pregunta DENTRO de la transacción y con la fila del usuario ya bloqueada,
 * porque si no dos admins podrían desactivarse a la vez: cada petición vería al
 * otro como activo, las dos pasarían la comprobación y el sistema se quedaría
 * sin ningún admin y sin forma de volver a entrar a arreglarlo.
 */
async function quedaOtroAdminActivo(client, idUsuario) {
  const result = await client.query(
    `SELECT count(*)::int AS admins
       FROM usuarios u
      WHERE u.rol = 'admin' AND u.activo = TRUE AND u.id_usuario <> $1`,
    [idUsuario]
  );
  return (result.rows[0] ? result.rows[0].admins : 0) > 0;
}

/**
 * Lee y BLOQUEA la fila del usuario. Devuelve null si no existe.
 *
 * El `FOR UPDATE` es lo que hace fiables las reglas de negocio de abajo: sin él,
 * entre la comprobación y el UPDATE cabe otra petición que cambie justo lo que
 * se acaba de verificar.
 */
async function bloquearUsuario(client, idUsuario) {
  const result = await client.query(
    `SELECT ${COLUMNAS_PUBLICAS} FROM usuarios u WHERE u.id_usuario = $1 FOR UPDATE`,
    [idUsuario]
  );
  return result.rows[0] || null;
}

/**
 * PATCH /api/usuarios/:id — nombre, rol y activo.
 *
 * Reglas, todas comprobadas con la fila bloqueada:
 *   - 404 si el usuario no existe.
 *   - un admin NO puede desactivarse ni cambiarse el rol A SÍ MISMO (409). No es
 *     por paternalismo: es el error que deja a alguien fuera de su propio panel
 *     con la sesión abierta y sin forma de deshacerlo. Otro admin sí puede.
 *   - tiene que quedar AL MENOS UN admin activo (409). Sin esto, el último admin
 *     se puede borrar a sí mismo del rol y no queda nadie que pueda volver a
 *     repartir permisos: habría que entrar a la base a mano.
 *
 * Los campos que no vienen no se tocan (`COALESCE`), así que el panel puede
 * mandar solo lo que cambió y no reescribe el resto sin querer.
 *
 * @param {number} id
 * @param {{nombre?: string, rol?: string, activo?: boolean}} cambios
 * @param {{idUsuarioQuePide: number}} contexto quién manda la petición.
 * @returns {Promise<object|null>} el usuario actualizado, o null si no existe.
 */
async function actualizar(id, cambios, { idUsuarioQuePide } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await bloquearUsuario(client, id);
    if (!actual) {
      await client.query('ROLLBACK');
      return null;
    }

    const seDesactiva = cambios.activo === false && actual.activo === true;
    const cambiaDeRol = cambios.rol !== undefined && cambios.rol !== actual.rol;

    // Number(): el id del usuario viene del JWT y el de la URL es texto.
    const esElMismo = Number(idUsuarioQuePide) === Number(actual.id_usuario);
    if (esElMismo && (seDesactiva || cambiaDeRol)) {
      await client.query('ROLLBACK');
      throw errorDeNegocio(409, MENSAJE_A_SI_MISMO);
    }

    // Deja de haber un admin activo aquí si se desactiva uno, o si uno deja de
    // ser admin. Reponer el rol o reactivar nunca quita admins, así que no se
    // comprueba en esos casos.
    const dejaDeSerAdminActivo =
      actual.rol === 'admin'
      && actual.activo === true
      && (seDesactiva || (cambiaDeRol && cambios.rol !== 'admin'));

    if (dejaDeSerAdminActivo && !(await quedaOtroAdminActivo(client, actual.id_usuario))) {
      await client.query('ROLLBACK');
      throw errorDeNegocio(409, MENSAJE_ULTIMO_ADMIN);
    }

    const result = await client.query(
      `UPDATE usuarios
          SET nombre = COALESCE($2, nombre),
              rol    = COALESCE($3, rol),
              activo = COALESCE($4, activo)
        WHERE id_usuario = $1
        RETURNING id_usuario, nombre, email, rol, activo, creado_en`,
      [id, cambios.nombre ?? null, cambios.rol ?? null, cambios.activo ?? null]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    // Un ROLLBACK ya hecho arriba hace que este falle en silencio; se intenta
    // igual porque un error de la base (o del UPDATE) deja la transacción
    // abierta y hay que cerrarla antes de devolver la conexión al pool.
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada: no hay nada que deshacer.
    }
    if (err && err.code === PG_UNIQUE) throw errorDeNegocio(409, MENSAJE_EMAIL_EN_USO);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * POST /api/usuarios/:id/clave — guarda un hash nuevo.
 *
 * El hash lo calcula el controller con el MISMO bcrypt y el mismo costo que el
 * registro: aquí solo se guarda. Así no hay dos formas de hashear en el
 * proyecto, que es como acaban existiendo contraseñas que el login no reconoce.
 *
 * Devuelve el usuario sin el hash: la respuesta de un cambio de clave no tiene
 * ninguna razón para llevar la clave, ni nueva ni vieja.
 *
 * @returns {Promise<object|null>} null si el usuario no existe.
 */
async function cambiarClave(id, passwordHash) {
  const result = await pool.query(
    `UPDATE usuarios SET password_hash = $2
      WHERE id_usuario = $1
      RETURNING id_usuario, nombre, email, rol, activo, creado_en`,
    [id, passwordHash]
  );
  return result.rows[0] || null;
}

module.exports = {
  buscarPorEmail,
  buscarPorId,
  crear,
  listar,
  actualizar,
  cambiarClave,
  MENSAJE_ULTIMO_ADMIN,
  MENSAJE_A_SI_MISMO,
  MENSAJE_EMAIL_EN_USO,
};
