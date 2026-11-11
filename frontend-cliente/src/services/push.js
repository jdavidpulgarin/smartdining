import { obtenerSesion } from '../utils/sesion';
import { urlsServidor } from '../utils/urlsServidor';

export const CLAVE_YA_PREGUNTO_PUSH = 'smartdining_push_pregunto';

function advertirDev(mensaje, detalle) {
  if (import.meta.env?.DEV) {
    if (detalle !== undefined) {
      console.warn(`[push] ${mensaje}`, detalle);
    } else {
      console.warn(`[push] ${mensaje}`);
    }
  }
}

/**
 * Detecta si el dispositivo es iPhone, iPad o iPod (incluyendo iPadOS 13+ que
 * reporta MacIntel con pantalla táctil).
 */
export function esDispositivoIos({
  userAgent = '',
  platform = '',
  maxTouchPoints = 0,
} = {}) {
  const ua = String(userAgent || '');
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }
  const plat = String(platform || '');
  if (
    (plat === 'MacIntel' || /Macintosh/i.test(ua)) &&
    Number(maxTouchPoints) > 1
  ) {
    return true;
  }
  return false;
}

/**
 * Determina el estado de soporte de Web Push en el navegador actual:
 * - 'ios_sin_instalar': iPhone o iPad fuera de modo standalone (sin instalar en inicio)
 * - 'ok': navegador con ServiceWorker, PushManager y Notification disponibles
 * - 'sin_soporte': cualquier otro caso sin las APIs necesarias
 *
 * Se puede inyectar `entorno` en los tests para probar todos los casos de forma pura.
 */
export function soportePush(entorno) {
  const env =
    entorno ??
    (() => {
      const tieneWin = typeof window !== 'undefined';
      const tieneNav = typeof navigator !== 'undefined';
      let displayStandalone = false;
      try {
        if (tieneWin && typeof window.matchMedia === 'function') {
          displayStandalone = Boolean(
            window.matchMedia('(display-mode: standalone)')?.matches
          );
        }
      } catch {
        displayStandalone = false;
      }

      return {
        userAgent: tieneNav ? navigator.userAgent || '' : '',
        platform: tieneNav ? navigator.platform || '' : '',
        maxTouchPoints: tieneNav ? Number(navigator.maxTouchPoints) || 0 : 0,
        navigatorStandalone: tieneNav ? Boolean(navigator.standalone) : false,
        displayModeStandalone: displayStandalone,
        tieneServiceWorker: tieneNav && 'serviceWorker' in navigator,
        tienePushManager: tieneWin && 'PushManager' in window,
        tieneNotification: tieneWin && 'Notification' in window,
      };
    })();

  const esIos = esDispositivoIos({
    userAgent: env.userAgent,
    platform: env.platform,
    maxTouchPoints: env.maxTouchPoints,
  });
  const enStandalone = Boolean(
    env.navigatorStandalone || env.displayModeStandalone
  );

  if (esIos && !enStandalone) {
    return 'ios_sin_instalar';
  }

  if (
    Boolean(env.tieneServiceWorker) &&
    Boolean(env.tienePushManager) &&
    Boolean(env.tieneNotification)
  ) {
    return 'ok';
  }

  return 'sin_soporte';
}

/**
 * Decide si se debe mostrar la tarjeta para pedir permiso de notificaciones:
 * solo con soporte 'ok', permiso 'default', sin haber preguntado en esta sesión
 * y con al menos un pedido confirmado.
 */
export function puedePedirPermiso({
  soporte,
  permiso,
  yaPregunto = false,
  tienePedidoConfirmado = false,
} = {}) {
  return (
    soporte === 'ok' &&
    permiso === 'default' &&
    !yaPregunto &&
    Boolean(tienePedidoConfirmado)
  );
}

/**
 * Resuelve qué debe mostrar (o hacer en silencio) la tarjeta de permiso push
 * en la pantalla de seguimiento tras confirmar un pedido:
 * - 'pedir': mostrar "¿Te avisamos cuando tu plato esté listo?"
 * - 'ios_sin_instalar': mostrar guía para agregar a pantalla de inicio en iPhone
 * - 'suscribir_silencio': permiso ya concedido -> suscribir sin UI
 * - 'oculto': no mostrar nada
 */
export function estadoTarjetaPush({
  soporte,
  permiso,
  yaPregunto = false,
  tienePedidoConfirmado = false,
} = {}) {
  if (!tienePedidoConfirmado) return 'oculto';

  if (soporte === 'ok') {
    if (permiso === 'granted') return 'suscribir_silencio';
    if (
      puedePedirPermiso({
        soporte,
        permiso,
        yaPregunto,
        tienePedidoConfirmado,
      })
    ) {
      return 'pedir';
    }
    return 'oculto';
  }

  if (soporte === 'ios_sin_instalar') {
    return yaPregunto ? 'oculto' : 'ios_sin_instalar';
  }

  return 'oculto';
}

/**
 * Convierte una clave pública VAPID en formato base64url a Uint8Array
 * para pasarla como `applicationServerKey` a `pushManager.subscribe`.
 */
export function urlBase64AUint8Array(clave) {
  if (typeof clave !== 'string' || !clave.trim()) {
    throw new Error('La clave pública VAPID debe ser un texto no vacío');
  }
  const limpia = clave.trim();
  const relleno = '='.repeat((4 - (limpia.length % 4)) % 4);
  const base64 = (limpia + relleno).replace(/-/g, '+').replace(/_/g, '/');

  let binario;
  if (typeof atob === 'function') {
    binario = atob(base64);
  } else if (typeof Buffer !== 'undefined') {
    binario = Buffer.from(base64, 'base64').toString('binary');
  } else {
    throw new Error('No hay decodificador base64 disponible');
  }

  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) {
    salida[i] = binario.charCodeAt(i);
  }
  return salida;
}

export function yaPreguntoPushEnSesion(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
) {
  try {
    return storage?.getItem(CLAVE_YA_PREGUNTO_PUSH) === '1';
  } catch {
    return false;
  }
}

export function marcarPreguntoPushEnSesion(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
) {
  try {
    storage?.setItem(CLAVE_YA_PREGUNTO_PUSH, '1');
  } catch {
    // Ignorar errores de sessionStorage
  }
}

function obtenerUrlSocket(socketUrlExplicita) {
  if (typeof socketUrlExplicita === 'string' && socketUrlExplicita.trim()) {
    return socketUrlExplicita.trim().replace(/\/+$/, '');
  }
  return urlsServidor().socket || 'http://localhost:4001';
}

async function obtenerRegistroServiceWorker(swContainer) {
  if (!swContainer) return null;
  let reg = null;
  if (typeof swContainer.getRegistration === 'function') {
    reg = await swContainer.getRegistration();
  }
  if (!reg && typeof swContainer.register === 'function') {
    reg = await swContainer.register('/sw-push.js', { scope: '/' });
  }
  if ((!reg || !reg.active) && swContainer.ready) {
    reg = (await swContainer.ready) || reg;
  }
  return reg;
}

/**
 * Obtiene la clave pública VAPID desde `GET /push/clave-publica`.
 */
export async function obtenerClavePublicaPush({
  fetchFn = typeof fetch === 'function' ? fetch : null,
  socketUrl,
} = {}) {
  if (!fetchFn) return null;
  const base = obtenerUrlSocket(socketUrl);
  const res = await fetchFn(`${base}/push/clave-publica`, {
    method: 'GET',
  });
  if (!res.ok) {
    if (res.status === 503) {
      advertirDev('Servidor sin claves VAPID configuradas (503)');
    } else {
      advertirDev(`No se pudo obtener la clave pública (${res.status})`);
    }
    return null;
  }
  const data = await res.json();
  return typeof data?.clave === 'string' && data.clave.trim()
    ? data.clave.trim()
    : null;
}

/**
 * Registra o reutiliza la suscripción Web Push del navegador y la envía
 * a `POST /push/suscripcion` con `Authorization: Bearer <JWT del comensal>`.
 *
 * Nunca lanza excepciones hacia la UI: ante falta de soporte, permiso denegado
 * o 503 (sin VAPID), falla en silencio y solo deja `console.warn` en DEV.
 */
export async function suscribir({
  token: tokenExplicito,
  socketUrl,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  swContainer = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : null,
  permisoActual = typeof Notification !== 'undefined'
    ? Notification.permission
    : 'default',
  entornoSoporte,
} = {}) {
  try {
    const soporte = soportePush(entornoSoporte);
    if (soporte !== 'ok') {
      advertirDev(`Push no disponible (${soporte})`);
      return { ok: false, motivo: soporte };
    }

    if (permisoActual === 'denied') {
      advertirDev('Permiso de notificaciones denegado');
      return { ok: false, motivo: 'permiso_denegado' };
    }

    const token = tokenExplicito ?? obtenerSesion()?.token;
    if (!token) {
      advertirDev('No hay token de sesión de comensal para suscribir push');
      return { ok: false, motivo: 'sin_sesion' };
    }

    if (!fetchFn) {
      return { ok: false, motivo: 'sin_fetch' };
    }

    const registro = await obtenerRegistroServiceWorker(swContainer);
    if (!registro || !registro.pushManager) {
      advertirDev('No se encontró un Service Worker con pushManager');
      return { ok: false, motivo: 'sin_service_worker' };
    }

    let suscripcion = await registro.pushManager.getSubscription();

    if (!suscripcion) {
      const clavePublica = await obtenerClavePublicaPush({
        fetchFn,
        socketUrl,
      });
      if (!clavePublica) {
        return { ok: false, motivo: 'sin_vapid' };
      }

      const applicationServerKey = urlBase64AUint8Array(clavePublica);
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    const payloadSuscripcion =
      typeof suscripcion?.toJSON === 'function'
        ? suscripcion.toJSON()
        : suscripcion;

    const base = obtenerUrlSocket(socketUrl);
    const respuesta = await fetchFn(`${base}/push/suscripcion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        subscription: payloadSuscripcion,
      }),
    });

    if (!respuesta.ok) {
      advertirDev(`POST /push/suscripcion respondió ${respuesta.status}`);
      return {
        ok: false,
        motivo: respuesta.status === 503 ? 'sin_vapid' : 'error_servidor',
        status: respuesta.status,
      };
    }

    return { ok: true, subscription: payloadSuscripcion };
  } catch (err) {
    advertirDev('No se pudo completar la suscripción push', err);
    return { ok: false, motivo: 'error' };
  }
}

/**
 * Elimina la suscripción activa del servidor (`DELETE /push/suscripcion`).
 */
export async function desuscribir({
  endpoint: endpointExplicito,
  token: tokenExplicito,
  socketUrl,
  fetchFn = typeof fetch === 'function' ? fetch : null,
  swContainer = typeof navigator !== 'undefined'
    ? navigator.serviceWorker
    : null,
} = {}) {
  try {
    const token = tokenExplicito ?? obtenerSesion()?.token;
    if (!token || !fetchFn) return { ok: false };

    let endpoint = endpointExplicito;
    if (!endpoint && swContainer) {
      const reg = await obtenerRegistroServiceWorker(swContainer);
      const sub = await reg?.pushManager?.getSubscription();
      endpoint = sub?.endpoint;
    }
    if (!endpoint) return { ok: false };

    const base = obtenerUrlSocket(socketUrl);
    const res = await fetchFn(`${base}/push/suscripcion`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint }),
    });
    return { ok: res.ok };
  } catch (err) {
    advertirDev('Error al eliminar suscripción push', err);
    return { ok: false };
  }
}

export default {
  soportePush,
  puedePedirPermiso,
  estadoTarjetaPush,
  urlBase64AUint8Array,
  suscribir,
  desuscribir,
  yaPreguntoPushEnSesion,
  marcarPreguntoPushEnSesion,
};
