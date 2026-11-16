const socketNotifier = require('./socket.notifier');

/**
 * Avisa al socket-server que cambió la carta (EVENTS.md §5.8) para que la PWA
 * del comensal vuelva a pedir GET /api/menu sin recargar.
 *
 * Quien la llama ya hizo el COMMIT y ya invalidó la caché del menú: en ese
 * orden, porque un comensal que reaccione al aviso pidiendo el menú recibiría
 * la copia vieja si la caché siguiera ahí.
 *
 * No se espera: el cambio ya está guardado y el tiempo real es un extra, así
 * que la respuesta HTTP sale enseguida. notificarMenuActualizado nunca lanza;
 * se encadena para que las pruebas puedan esperarlo con esperarAvisos().
 *
 * @param {string} accion  una de socketNotifier.ACCIONES_MENU
 * @param {number|string|null} [idPlato]  null si no se sabe (o con una categoría)
 */
function avisarMenuActualizado(accion, idPlato = null) {
  return socketNotifier.encadenarAvisos([
    () => socketNotifier.notificarMenuActualizado(accion, idPlato),
  ]);
}

module.exports = { avisarMenuActualizado };
