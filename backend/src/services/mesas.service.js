const pool = require('../config/db');
const socketNotifier = require('./socket.notifier');

// Tabla mesas (docs/modelo-er.md): id_mesa, numero, capacidad, ubicacion,
// estado, token_qr, actualizado_en.
//
// Este servicio solo lee/expone lo que está guardado en la columna token_qr.
// El socket-server de Roberto no usa Redis ni esta columna: emite tokens QR
// firmados con HMAC, con la expiración dentro del propio token. Los dos modelos
// conviven por ahora; la decisión de cuál queda es del equipo (docs/api-spec.md).

// Valores exactos del CHECK de mesas.estado en el schema.sql de Jarrison.
const ESTADOS_MESA = ['disponible', 'ocupada', 'reservada', 'mantenimiento'];
const ESTADO_MESA_LIBRE = 'disponible';

async function listar() {
  const result = await pool.query('SELECT * FROM mesas ORDER BY numero ASC');
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM mesas WHERE id_mesa = $1', [id]);
  return result.rows[0] || null;
}

async function obtenerPorToken(token) {
  const result = await pool.query('SELECT * FROM mesas WHERE token_qr = $1', [token]);
  return result.rows[0] || null;
}

async function crear({ numero, capacidad, ubicacion, estado, token_qr }) {
  // capacidad, ubicacion y actualizado_en tienen DEFAULT en el schema: si no
  // vienen, se deja que la base ponga el suyo.
  const result = await pool.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
     VALUES ($1, COALESCE($2, 4), COALESCE($3, 'Principal'), $4, $5) RETURNING *`,
    [numero, capacidad ?? null, ubicacion || null, estado || ESTADO_MESA_LIBRE, token_qr || null]
  );
  return result.rows[0];
}

async function actualizarEstado(id, estado) {
  // actualizado_en y version_control los maneja el trigger tr_control_concurrencia_mesa.
  const result = await pool.query(
    `UPDATE mesas SET estado = COALESCE($1, estado) WHERE id_mesa = $2 RETURNING *`,
    [estado, id]
  );
  return result.rows[0] || null;
}

/**
 * Abre la sesión de la mesa y devuelve el token del QR que hay que imprimir.
 *
 * Es idempotente: si la mesa ya tiene un token_qr y el socket-server dice que
 * sigue vigente, se devuelve ese mismo. Solo se pide uno nuevo si no hay o el
 * que había caducó.
 *
 * Todo ocurre con la fila de la mesa bloqueada (SELECT ... FOR UPDATE) para que
 * dos meseros pulsando "abrir" a la vez no generen dos QR distintos y se pisen
 * el token. Contrapartida asumida: el bloqueo se mantiene durante la llamada
 * HTTP al socket-server, por eso el timeout de ese cliente es corto.
 *
 * El JWT del mesero se reenvía a /qr/generar: es el socket-server quien decide
 * si ese rol puede generar QR.
 *
 * @returns uno de: { mesa, token, reutilizado } | { noExiste: true }
 *          | { socketCaido: true, motivo } | { rechazado: true, status, mensaje }
 */
async function abrirSesion(idMesa, { jwtStaff, socket = socketNotifier } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query('SELECT * FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }
    const mesa = bloqueada.rows[0];

    if (mesa.token_qr) {
      const vigente = await socket.validarTokenQr(mesa.token_qr);
      if (!vigente.alcanzado) {
        await client.query('ROLLBACK');
        return { socketCaido: true, motivo: vigente.motivo };
      }
      if (vigente.valido) {
        await client.query('COMMIT');
        return { mesa, token: mesa.token_qr, reutilizado: true };
      }
    }

    const generado = await socket.generarTokenQr(idMesa, jwtStaff);
    if (!generado.alcanzado) {
      await client.query('ROLLBACK');
      return { socketCaido: true, motivo: generado.motivo };
    }
    if (!generado.token) {
      await client.query('ROLLBACK');
      return { rechazado: true, status: generado.status, mensaje: generado.mensaje };
    }

    const actualizada = await client.query(
      `UPDATE mesas SET token_qr = $1, estado = 'ocupada' WHERE id_mesa = $2 RETURNING *`,
      [generado.token, idMesa]
    );

    await client.query('COMMIT');
    return { mesa: actualizada.rows[0], token: generado.token, reutilizado: false };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cierra la sesión de la mesa: la deja 'disponible' y borra su token_qr, con lo
 * que el QR impreso deja de valer y las sesiones de comensal de ese grupo caen
 * (el middleware compara el sid del JWT contra la columna).
 *
 * Avisar al socket-server es del controller, DESPUÉS del commit: si ese aviso
 * falla no se debe revertir la liberación.
 */
async function liberarSesion(idMesa) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bloqueada = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);
    if (bloqueada.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const actualizada = await client.query(
      `UPDATE mesas SET estado = $1, token_qr = NULL WHERE id_mesa = $2 RETURNING *`,
      [ESTADO_MESA_LIBRE, idMesa]
    );

    await client.query('COMMIT');
    return actualizada.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Libera la mesa si ya no le quedan pedidos abiertos. Se usa DENTRO de la
 * transacción que acaba de cerrar un pedido (pagado o cancelado), con el client
 * de esa transacción.
 *
 * El SELECT ... FOR UPDATE sobre la mesa serializa los cierres simultáneos: si
 * dos pedidos de la misma mesa se liquidan a la vez, el segundo espera al
 * primero y ve el estado ya actualizado, así la mesa se libera una sola vez.
 *
 * @returns {Promise<boolean>} true si esta llamada fue la que la liberó.
 */
async function liberarSiNoQuedanPedidosAbiertos(client, idMesa) {
  await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [idMesa]);

  const abiertos = await client.query(
    `SELECT count(*)::int AS n FROM pedidos
     WHERE id_mesa = $1 AND estado NOT IN ('pagado', 'cancelado')`,
    [idMesa]
  );
  // Si por alguna razón no se puede leer el conteo, NO se libera: es más
  // seguro dejar la mesa ocupada que soltarla con pedidos vivos.
  const fila = abiertos.rows[0];
  if (!fila || typeof fila.n !== 'number' || fila.n > 0) return false;

  const liberada = await client.query(
    `UPDATE mesas SET estado = $1, token_qr = NULL
     WHERE id_mesa = $2 AND (estado <> $1 OR token_qr IS NOT NULL)
     RETURNING id_mesa`,
    [ESTADO_MESA_LIBRE, idMesa]
  );
  return liberada.rows.length > 0;
}

/** token_qr vigente de la mesa, o null. Lo usa el middleware de sesión. */
async function tokenQrDeMesa(idMesa) {
  const result = await pool.query('SELECT token_qr FROM mesas WHERE id_mesa = $1', [idMesa]);
  return (result.rows[0] && result.rows[0].token_qr) || null;
}

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM mesas WHERE id_mesa = $1 RETURNING id_mesa',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  ESTADOS_MESA,
  ESTADO_MESA_LIBRE,
  abrirSesion,
  liberarSesion,
  liberarSiNoQuedanPedidosAbiertos,
  tokenQrDeMesa,
  listar,
  obtenerPorId,
  obtenerPorToken,
  crear,
  actualizarEstado,
  eliminar,
};
