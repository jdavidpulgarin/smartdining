import { aliasDelToken } from '../services/clienteMesa';

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
