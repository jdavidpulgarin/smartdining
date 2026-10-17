const URL_WIDGET_WOMPI = 'https://checkout.wompi.co/widget.js';
const SCRIPT_ID = 'smartdining-wompi-widget-script';

let promesaCarga = null;

/**
 * Inyecta el script del Widget de Wompi de forma asíncrona una sola vez.
 * En modo simulado, esta función no hace nada y resuelve de inmediato.
 *
 * @returns {Promise<any>} Objeto window.WidgetCheckout cuando esté disponible
 */
export function cargarWidget() {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (window.WidgetCheckout) {
    return Promise.resolve(window.WidgetCheckout);
  }

  if (promesaCarga) {
    return promesaCarga;
  }

  promesaCarga = new Promise((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID);

    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = URL_WIDGET_WOMPI;
      script.async = true;
      document.body.appendChild(script);
    }

    script.onload = () => {
      resolve(window.WidgetCheckout);
    };

    script.onerror = () => {
      promesaCarga = null;
      reject(new Error('No se pudo cargar el Widget de Wompi.'));
    };
  });

  return promesaCarga;
}

/**
 * Abre la pasarela de Wompi Checkout con la intención firmada por el servidor.
 *
 * IMPORTANTE: La confirmación definitiva del pago NO la define el callback del widget;
 * la fuente de verdad es exclusivamente el evento payment:confirmed recibido por WebSocket.
 *
 * @param {object} intencion - Datos de la intención retornados por POST /pagos/intencion
 * @param {Function} [onResultado] - Callback opcional para monitorear el resultado local del modal
 * @returns {Promise<any>}
 */
export async function abrirCheckout(intencion, onResultado = null) {
  if (!intencion) {
    throw new Error('Se requiere una intención de pago válida');
  }

  const WidgetCheckout = await cargarWidget();
  if (!WidgetCheckout) {
    throw new Error('El Widget de Wompi no está disponible en este entorno');
  }

  const checkout = new WidgetCheckout({
    currency: intencion.moneda || 'COP',
    amountInCents: intencion.monto_en_centavos,
    reference: intencion.referencia,
    publicKey: intencion.llave_publica,
    signature: {
      integrity: intencion.firma_integridad,
    },
    expirationTime: intencion.expira_en,
    redirectUrl: `${window.location.origin}/pago`,
  });

  checkout.open((resultado) => {
    if (typeof onResultado === 'function') {
      onResultado(resultado);
    }
  });

  return checkout;
}

export default {
  cargarWidget,
  abrirCheckout,
};
