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
 * Determina la URL de redirección para Wompi (J-15).
 * CloudFront de Wompi bloquea peticiones con redirect-url en http o localhost (403 Request blocked).
 * Solo se debe enviar redirectUrl si el origen es seguro (https) y no es localhost.
 *
 * @param {string|null} origen - Origen de la aplicación (ej. window.location.origin)
 * @param {string} [ruta='/pago'] - Ruta de retorno
 * @returns {string|null} URL completa de redirección o null
 */
export function urlRedireccionWompi(origen, ruta = '/pago') {
  if (!origen || typeof origen !== 'string') return null;

  const origenTrim = origen.trim();
  const lower = origenTrim.toLowerCase();

  // Debe ser https://
  if (!lower.startsWith('https://')) return null;

  // No localhost ni 127.0.0.1
  const sinProtocolo = lower.slice('https://'.length);
  if (sinProtocolo.startsWith('localhost') || sinProtocolo.startsWith('127.0.0.1')) {
    return null;
  }

  const rutaNorm = ruta ? (ruta.startsWith('/') ? ruta : `/${ruta}`) : '';
  const origenBase = origenTrim.replace(/\/+$/, '');
  return `${origenBase}${rutaNorm}`;
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

  const redirectUrl = urlRedireccionWompi(
    typeof window !== 'undefined' ? window.location?.origin : null,
    '/pago'
  );

  const opciones = {
    currency: intencion.moneda || 'COP',
    amountInCents: intencion.monto_en_centavos,
    reference: intencion.referencia,
    publicKey: intencion.llave_publica,
    signature: {
      integrity: intencion.firma_integridad,
    },
    expirationTime: intencion.expira_en,
  };

  if (redirectUrl) {
    opciones.redirectUrl = redirectUrl;
  }

  const checkout = new WidgetCheckout(opciones);

  checkout.open((resultado) => {
    if (typeof onResultado === 'function') {
      onResultado(resultado);
    }
  });

  return checkout;
}

/**
 * Remueve cualquier overlay, modal o iframe inyectado en el DOM por el widget de Wompi (J-15).
 */
export function cerrarWidget() {
  if (typeof document === 'undefined') return;
  const selectores = [
    '.waybox-backdrop',
    '.waybox-modal',
    'iframe[src*="wompi"]',
    'iframe[name*="wompi"]',
    '#smartdining-wompi-widget-container',
  ];
  selectores.forEach((sel) => {
    try {
      const elementos = document.querySelectorAll(sel);
      elementos.forEach((el) => {
        try {
          el.remove();
        } catch {
          // Elemento ya removido
        }
      });
    } catch {
      // Ignorar selector no soportado
    }
  });
  if (document.body?.classList) {
    document.body.classList.remove('no-scroll');
  }
}

export default {
  cargarWidget,
  abrirCheckout,
  urlRedireccionWompi,
  cerrarWidget,
};
