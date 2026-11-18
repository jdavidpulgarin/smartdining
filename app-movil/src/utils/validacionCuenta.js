/**
 * Validación local para los formularios de Cuenta (login y registro).
 */

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarCorreo(correo = '') {
  const limpio = String(correo).trim();
  if (!limpio) return 'Ingresa tu correo electrónico.';
  if (!RE_CORREO.test(limpio)) return 'Ingresa un correo válido (ej: nombre@dominio.com).';
  return null;
}

export function validarPassword(password = '') {
  const texto = String(password);
  if (!texto) return 'Ingresa tu contraseña.';
  if (texto.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  return null;
}

export function validarNombreCuenta(nombre = '') {
  const limpio = String(nombre).trim();
  if (!limpio) return 'Ingresa tu nombre.';
  if (limpio.length < 2) return 'Tu nombre debe tener al menos 2 caracteres.';
  return null;
}

export function validarFormularioCuenta({ modo, nombre, correo, password }) {
  const errores = {};
  if (modo === 'registro') {
    const errNombre = validarNombreCuenta(nombre);
    if (errNombre) errores.nombre = errNombre;
  }
  const errCorreo = validarCorreo(correo);
  if (errCorreo) errores.correo = errCorreo;

  const errPassword = validarPassword(password);
  if (errPassword) errores.password = errPassword;

  return {
    valido: Object.keys(errores).length === 0,
    errores,
  };
}
