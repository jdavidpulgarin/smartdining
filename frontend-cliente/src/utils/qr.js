/**
 * Decodifica de forma segura el número de mesa incluido en el payload de un token QR.
 *
 * Formato del token: v1.<payload base64url>.<firma>
 * Payload esperado: { m: id_mesa, iat, exp, sid }
 *
 * @param {string} token
 * @returns {number|null} El número de mesa si es un entero positivo válido, o null en cualquier otro caso.
 */
export function leerMesaDelQr(token) {
  if (typeof token !== 'string') return null;

  const partes = token.trim().split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return null;

  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );

    let jsonStr = '';
    if (typeof atob === 'function') {
      jsonStr = atob(padded);
    } else if (typeof Buffer !== 'undefined') {
      jsonStr = Buffer.from(padded, 'base64').toString('utf-8');
    } else {
      return null;
    }

    const payload = JSON.parse(jsonStr);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const m = payload.m;
    if (typeof m === 'number' && Number.isInteger(m) && m > 0) {
      return m;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Valida si un texto leído por el escáner QR corresponde a una URL válida de mesa SmartDining.
 *
 * Reglas de seguridad:
 * - Debe ser una URL absoluta válida.
 * - En producción/staging solo acepta protocolo https:
 * - Acepta http: únicamente si el origen es localhost o 127.0.0.1 (desarrollo).
 * - El origen de la URL debe coincidir EXACTAMENTE con el origen actual (window.location.origin).
 * - La ruta debe ser la raíz ('/').
 * - Debe contener el parámetro 'token' en formato válido (token v1 con número de mesa).
 *
 * @param {string} texto - Contenido escaneado del QR
 * @param {string} [origenActual] - Origen actual de la PWA (por defecto window.location.origin)
 * @returns {{ ok: true, ruta: string } | { ok: false }}
 */
export function validarUrlQrMesa(
  texto,
  origenActual = typeof window !== 'undefined' ? window.location?.origin : ''
) {
  if (typeof texto !== 'string' || !texto.trim()) {
    return { ok: false };
  }
  if (!origenActual || typeof origenActual !== 'string') {
    return { ok: false };
  }

  let url;
  let origenEsp;
  try {
    url = new URL(texto.trim());
    origenEsp = new URL(origenActual.trim()).origin;
  } catch {
    return { ok: false };
  }

  // Protocolo: solo http o https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false };
  }

  const esLocalhost =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';

  // http solo si es localhost en desarrollo
  if (url.protocol === 'http:' && !esLocalhost) {
    return { ok: false };
  }

  // El ORIGEN debe coincidir exactamente con el origen actual
  if (url.origin !== origenEsp) {
    return { ok: false };
  }

  // La ruta debe ser exactamente '/'
  if (url.pathname !== '/') {
    return { ok: false };
  }

  // Parámetro token obligatorio y con formato válido
  const token = url.searchParams.get('token');
  if (!token || !token.trim()) {
    return { ok: false };
  }

  const mesa = leerMesaDelQr(token.trim());
  const tokenValido =
    mesa !== null || (esLocalhost && token.trim() === 'simulado');
  if (!tokenValido) {
    return { ok: false };
  }

  const tokenLimpio = token.trim();
  return {
    ok: true,
    ruta: `/?token=${encodeURIComponent(tokenLimpio)}`,
  };
}

/**
 * Clasifica un error de acceso a la cámara en una categoría clara y amigable (T9 / Escaneo QR).
 *
 * @param {Error|object|string} [error]
 * @returns {{ tipo: 'sin_camara' | 'permiso_denegado' | 'error_desconocido', mensaje: string }}
 */
export function clasificarErrorCamara(error) {
  if (!error) {
    return {
      tipo: 'error_desconocido',
      mensaje: 'No pudimos iniciar la cámara. Intenta de nuevo.',
    };
  }

  const nombre =
    typeof error === 'string'
      ? error
      : (error.name || error.codigo || '');
  const mensajeError = String(error.message || '').toLowerCase();

  // 1. Sin cámara disponible
  if (
    nombre === 'NotFoundError' ||
    nombre === 'DevicesNotFoundError' ||
    nombre === 'OverconstrainedError' ||
    nombre === 'sin_camara' ||
    mensajeError.includes('not found') ||
    mensajeError.includes('no camera')
  ) {
    return {
      tipo: 'sin_camara',
      mensaje: 'No encontramos una cámara en este dispositivo.',
    };
  }

  // 2. Permiso denegado por el usuario o seguridad
  if (
    nombre === 'NotAllowedError' ||
    nombre === 'PermissionDeniedError' ||
    nombre === 'SecurityError' ||
    nombre === 'permiso_denegado' ||
    mensajeError.includes('permission') ||
    mensajeError.includes('denied') ||
    mensajeError.includes('notallowed')
  ) {
    return {
      tipo: 'permiso_denegado',
      mensaje: 'Necesitamos permiso para usar la cámara. Actívalo en los ajustes del navegador o del teléfono.',
    };
  }

  // 3. Otro error genérico
  return {
    tipo: 'error_desconocido',
    mensaje: 'No pudimos iniciar la cámara. Intenta de nuevo.',
  };
}

/**
 * Diagnostica el estado de acceso a la cámara antes de inicializar librerías de escaneo.
 * Resuelve el problema donde librerías como qr-scanner capturan y ocultan errores reales
 * (como NotAllowedError de getUserMedia) transformándolos en "Camera not found.".
 *
 * @param {object} [opciones]
 * @param {Permissions} [opciones.permissions] - API navigator.permissions (inyectable para tests)
 * @param {MediaDevices} [opciones.mediaDevices] - API navigator.mediaDevices (inyectable para tests)
 * @returns {Promise<'ok' | 'permiso_denegado' | 'sin_camara' | 'error_desconocido'>}
 */
export async function diagnosticarCamara({
  permissions = typeof navigator !== 'undefined' ? navigator.permissions : undefined,
  mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
} = {}) {
  // a) Si existe navigator.permissions.query, consulta { name: 'camera' }
  if (permissions && typeof permissions.query === 'function') {
    try {
      const status = await permissions.query({ name: 'camera' });
      if (status && status.state === 'denied') {
        return 'permiso_denegado';
      }
    } catch {
      // Safari viejo o navegadores que no soportan name: 'camera' lanzan excepción; continuar con getUserMedia
    }
  }

  // c) Si no existe mediaDevices.getUserMedia → 'sin_camara'
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return 'sin_camara';
  }

  // b) Si no hay Permissions API o no fue concluyente: prueba getUserMedia
  try {
    const stream = await mediaDevices.getUserMedia({ video: true });
    if (stream) {
      try {
        const tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : [];
        for (const t of tracks) {
          if (typeof t.stop === 'function') {
            t.stop();
          }
        }
      } catch {
        // Ignorar errores al detener pistas
      }
    }
    return 'ok';
  } catch (error) {
    const nombre = error?.name || error?.codigo || '';
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError' || nombre === 'PermissionDeniedError') {
      return 'permiso_denegado';
    }
    if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError' || nombre === 'DevicesNotFoundError') {
      return 'sin_camara';
    }
    return 'error_desconocido';
  }
}

export default {
  leerMesaDelQr,
  validarUrlQrMesa,
  clasificarErrorCamara,
  diagnosticarCamara,
};
