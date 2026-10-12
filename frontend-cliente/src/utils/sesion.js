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

export default {
  CLAVE_SESION,
  validarNombre,
  leerExpiracionJwt,
};
