import { aliasDelToken } from '../services/clienteMesa';
import { leerMesaDelQr } from './qr';
import {
  calcularClaveSesion,
  cargarUltimoPedidoGuardado,
  resumenPedidosActivos,
} from './seguimiento';

export const CLAVE_SESION = 'smartdining_sesion';

const REGEX_CARACTERES_PERMITIDOS = /^[\p{L}\p{N}\s._'-]+$/u;
const REGEX_AL_MENOS_ALFANUMERICO = /[\p{L}\p{N}]/u;

export function validarNombre(texto) {
  const recortado = typeof texto === 'string' ? texto.trim() : '';

  if (recortado.length < 2) {
    return {
      valido: false,
      nombre: recortado,
      error: 'Escribe un nombre de entre 2 y 40 caracteres.',
    };
  }

  if (recortado.length > 40) {
    return {
      valido: false,
      nombre: recortado,
      error: 'El nombre no puede tener más de 40 caracteres.',
    };
  }

  if (!REGEX_CARACTERES_PERMITIDOS.test(recortado)) {
    return {
      valido: false,
      nombre: recortado,
      error: "Solo se permiten letras, números, espacios y . _ ' -",
    };
  }

  if (!REGEX_AL_MENOS_ALFANUMERICO.test(recortado)) {
    return {
      valido: false,
      nombre: recortado,
      error: 'El nombre debe incluir al menos una letra o un número.',
    };
  }

  return {
    valido: true,
    nombre: recortado,
    error: null,
  };
}

export function leerExpiracionJwt(token) {
  if (typeof token !== 'string' || !token.trim()) {
    return null;
  }

  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1]) {
    return null;
  }

  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const conPadding = base64 + '='.repeat(padLen);
    const json = atob(conPadding);
    const payload = JSON.parse(json);

    if (typeof payload?.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export function tienePedidosActivosGuardados(comensal, idMesa, token) {
  try {
    const claveSesion = idMesa ? calcularClaveSesion(idMesa, token) : null;
    const pedidos = cargarUltimoPedidoGuardado(comensal, claveSesion);
    if (!pedidos || pedidos.length === 0) return false;
    const resumen = resumenPedidosActivos(pedidos);
    return Boolean(resumen && resumen.cantidad > 0);
  } catch {
    return false;
  }
}

/**
 * Determina el flujo o redirección al cargar la pantalla de Inicio:
 * - 'redirigir': hay sesión vigente sin token o en la misma mesa
 * - 'confirmar_reutilizar': hay sesión vigente, hay token pero no se puede saber la mesa sin unirse
 * - 'unirse_nueva_mesa': hay token para otra mesa distinta a la sesión guardada
 * - 'pide_nombre': no hay sesión y hay token
 * - 'sin_sesion': no hay sesión y no hay token
 *
 * @param {object} params
 * @param {string|null} [params.tokenUrl] - Token QR de la URL
 * @param {object|null} [params.sesion] - Sesión vigente almacenada ({ token, idMesa, numeroMesa, comensal })
 * @param {boolean} [params.tienePedidosActivos=false] - Si el comensal tiene pedidos activos
 * @returns {{ accion: string, ruta?: string, mesaQr?: number|null }}
 */
export function decidirDestinoInicio({
  tokenUrl = null,
  sesion = null,
  tienePedidosActivos = false,
} = {}) {
  const tieneSesionValida = Boolean(sesion && sesion.token && sesion.idMesa);
  const tokenLimpio =
    typeof tokenUrl === 'string' && tokenUrl.trim() ? tokenUrl.trim() : null;

  // Caso 1: Sin token en URL
  if (!tokenLimpio) {
    if (tieneSesionValida) {
      return {
        accion: 'redirigir',
        ruta: tienePedidosActivos ? '/seguimiento' : '/menu',
      };
    }
    return { accion: 'sin_sesion' };
  }

  // Caso 2: Con token en URL y sin sesión previa
  if (!tieneSesionValida) {
    return { accion: 'pide_nombre', mesaQr: leerMesaDelQr(tokenLimpio) };
  }

  // Caso 3: Con token en URL Y con sesión previa vigente
  const mesaQr = leerMesaDelQr(tokenLimpio);

  if (mesaQr !== null) {
    const esMismaMesa =
      Number(mesaQr) === Number(sesion.idMesa) ||
      Number(mesaQr) === Number(sesion.numeroMesa);

    if (esMismaMesa) {
      return {
        accion: 'redirigir',
        ruta: tienePedidosActivos ? '/seguimiento' : '/menu',
        mesaQr,
      };
    }

    // Es otra mesa diferente
    return {
      accion: 'unirse_nueva_mesa',
      mesaQr,
    };
  }

  // No se puede saber la mesa del QR sin unirse (token opaco o simulado sin v1)
  return {
    accion: 'confirmar_reutilizar',
    mesaQr: null,
  };
}

export function borrarSesionDeStorages(
  storageLocal = typeof window !== 'undefined' ? window.localStorage : null,
  storageSession = typeof window !== 'undefined' ? window.sessionStorage : null
) {
  try {
    storageLocal?.removeItem(CLAVE_SESION);
  } catch {
    // Ignorar
  }
  try {
    storageSession?.removeItem(CLAVE_SESION);
  } catch {
    // Ignorar
  }
}

export function migrarSesionStorage(
  storageLocal = typeof window !== 'undefined' ? window.localStorage : null,
  storageSession = typeof window !== 'undefined' ? window.sessionStorage : null
) {
  try {
    if (!storageLocal || !storageSession) return;
    const sesionLocal = storageLocal.getItem(CLAVE_SESION);
    const sesionSession = storageSession.getItem(CLAVE_SESION);
    if (!sesionLocal && sesionSession) {
      storageLocal.setItem(CLAVE_SESION, sesionSession);
      storageSession.removeItem(CLAVE_SESION);
    }
  } catch {
    // Ignorar errores de acceso a storage
  }
}

export function leerSesionAlmacenada(
  storageLocal = typeof window !== 'undefined' ? window.localStorage : null,
  storageSession = typeof window !== 'undefined' ? window.sessionStorage : null
) {
  try {
    let local = storageLocal;
    let session = storageSession;
    if (!local && typeof window !== 'undefined' && window.localStorage) local = window.localStorage;
    if (!session && typeof window !== 'undefined' && window.sessionStorage) session = window.sessionStorage;
    migrarSesionStorage(local, session);

    const crudo = local?.getItem(CLAVE_SESION) || session?.getItem(CLAVE_SESION);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!datos || !datos.token || !datos.idMesa) {
      borrarSesionDeStorages(local, session);
      return null;
    }

    const expMs = leerExpiracionJwt(datos.token);
    if (expMs !== null && expMs <= Date.now()) {
      borrarSesionDeStorages(local, session);
      return null;
    }

    const aliasJwt = aliasDelToken(datos.token);

    return {
      token: datos.token,
      comensal: aliasJwt || datos.comensal || '',
      idMesa: Number(datos.idMesa),
      numeroMesa: Number(datos.numeroMesa ?? datos.idMesa),
      expiraEn: datos.expiraEn || null,
    };
  } catch {
    return null;
  }
}

export function obtenerSesion(
  storageLocal = typeof window !== 'undefined' ? window.localStorage : null,
  storageSession = typeof window !== 'undefined' ? window.sessionStorage : null
) {
  try {
    let local = storageLocal;
    let session = storageSession;
    if (!local && typeof window !== 'undefined' && window.localStorage) {
      local = window.localStorage;
    }
    if (!session && typeof window !== 'undefined' && window.sessionStorage) {
      session = window.sessionStorage;
    }
    migrarSesionStorage(local, session);

    const raw = local?.getItem(CLAVE_SESION) || session?.getItem(CLAVE_SESION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token) {
      borrarSesionDeStorages(local, session);
      return null;
    }
    const expMs = leerExpiracionJwt(parsed.token);
    if (expMs !== null && expMs <= Date.now()) {
      borrarSesionDeStorages(local, session);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export default {
  CLAVE_SESION,
  validarNombre,
  leerExpiracionJwt,
  obtenerSesion,
  borrarSesionDeStorages,
  migrarSesionStorage,
};
