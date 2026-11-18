const pool = require('../config/db');
const socketNotifier = require('./socket.notifier');

/**
 * T12: avisa mesa-actualizada (EVENTS.md §5.7) con la mesa YA CONFIRMADA.
 *
 * Se llama dentro de la cadena de avisos (socketNotifier.encadenarAvisos),
 * DESPUÉS del COMMIT: la respuesta HTTP no la espera y un fallo del
 * socket-server (o de esta lectura) no la rompe. Nunca lanza.
 *
 * La fila se vuelve a leer por id, así el aviso lleva el estado que de verdad
 * quedó en la base (en las liberaciones automáticas, quien libera solo tiene el
 * id_mesa). La consulta NO selecciona token_qr: solo si hay sesión abierta. Vive
 * aparte del notifier porque mesas.service ya importa el notifier y leer la mesa
 * desde él armaría un ciclo.
 */
const SQL_MESA_PARA_AVISO = `
  SELECT id_mesa, numero, capacidad, estado, ubicacion, activa,
         (token_qr IS NOT NULL) AS sesion_abierta
    FROM mesas WHERE id_mesa = $1::int`;

/**
 * @param {number} idMesa
 * @param {string} motivo  socketNotifier.MOTIVOS_MESA_ACTUALIZADA (no 'eliminada')
 */
async function avisarMesaActualizada(idMesa, motivo) {
  try {
    const { rows } = await pool.query(SQL_MESA_PARA_AVISO, [idMesa]);
    if (!rows[0]) return { ok: false, motivo: 'MESA_INEXISTENTE' };
    return await socketNotifier.notificarMesaActualizada(rows[0], motivo);
  } catch (err) {
    // Solo el código: nada de datos de la mesa en el log.
    console.error(`[socket] mesa-actualizada: no se pudo leer la mesa (${err && err.code})`);
    return { ok: false, motivo: 'ERROR_LECTURA' };
  }
}

/** Borrado: la fila ya no existe, el aviso va solo con el id. */
function avisarMesaEliminada(idMesa) {
  return socketNotifier.notificarMesaActualizada(
    { id_mesa: Number(idMesa) },
    socketNotifier.MOTIVOS_MESA_ACTUALIZADA.eliminada
  );
}

/**
 * Atajo para los controllers: encola el aviso en la cadena (no se espera).
 * Devuelve la cadena para las pruebas.
 */
function encolarMesaActualizada(idMesa, motivo) {
  return socketNotifier.encadenarAvisos([() => avisarMesaActualizada(idMesa, motivo)]);
}

module.exports = { avisarMesaActualizada, avisarMesaEliminada, encolarMesaActualizada, SQL_MESA_PARA_AVISO };
