const TEXTOS_POR_ESTADO = {
  en_preparacion: {
    titulo: 'Tu pedido está en preparación',
    cuerpo: (ref) => `${ref}Te avisamos cuando esté listo.`,
  },
  listo: {
    titulo: 'Tu pedido está listo',
    cuerpo: (ref) => `${ref}Ya sale de cocina hacia tu mesa.`,
  },
  cancelado: {
    titulo: 'Tu pedido fue cancelado',
    cuerpo: (ref) => `${ref}Pregúntale al mesero si necesitas ayuda.`,
  },
};

/**
 * Arma título y cuerpo amigables para la notificación push según el estado del
 * pedido. Si el estado no es conocido, conserva `titulo` y `cuerpo` tal cual
 * llegan del servidor.
 *
 * Nota: `public/sw-push.js` corre como service worker clásico con
 * `importScripts`, por lo que mantiene una copia comentada de esta función.
 */
export function formatearNotificacionPush(datos = {}) {
  const payload = datos && typeof datos === 'object' ? datos : {};
  const estado = typeof payload.estado === 'string' ? payload.estado : '';
  const cuerpoCrudo = typeof payload.cuerpo === 'string' ? payload.cuerpo : '';
  const plantilla = TEXTOS_POR_ESTADO[estado];

  if (plantilla) {
    const cuerpoLimpio = cuerpoCrudo.trim();
    const ref = cuerpoLimpio ? `Pedido ${cuerpoLimpio}. ` : '';
    return {
      titulo: plantilla.titulo,
      cuerpo: plantilla.cuerpo(ref),
    };
  }

  const titulo =
    typeof payload.titulo === 'string' && payload.titulo.trim()
      ? payload.titulo.trim()
      : 'SmartDining';
  return {
    titulo,
    cuerpo: cuerpoCrudo,
  };
}
