/**
 * Inicia el refresco periódico de la carta y al volver a tener visibilidad en la pestaña.
 *
 * @param {object} opciones
 * @param {Function} opciones.cargar - Función asíncrona que solicita los datos.
 * @param {number} [opciones.intervaloMs=15000] - Intervalo en milisegundos.
 * @param {Document} [opciones.doc=document] - Objeto Document para escuchar visibilidad.
 * @returns {Function} detener - Función para cancelar el intervalo y oyentes.
 */
export function iniciarRefresco({
  cargar,
  intervaloMs = 15000,
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  let cargando = false;
  let activo = true;

  const ejecutarCarga = async () => {
    if (!activo || cargando) return;
    if (doc && doc.visibilityState !== 'visible') return;

    cargando = true;
    try {
      await cargar?.();
    } catch {
      // Ignorar errores en el refresco en segundo plano
    } finally {
      cargando = false;
    }
  };

  const intervaloId = setInterval(ejecutarCarga, intervaloMs);

  const manejarCambioVisibilidad = () => {
    if (doc && doc.visibilityState === 'visible') {
      ejecutarCarga();
    }
  };

  if (doc?.addEventListener) {
    doc.addEventListener('visibilitychange', manejarCambioVisibilidad);
  }

  return function detener() {
    activo = false;
    clearInterval(intervaloId);
    if (doc?.removeEventListener) {
      doc.removeEventListener('visibilitychange', manejarCambioVisibilidad);
    }
  };
}

export default iniciarRefresco;
