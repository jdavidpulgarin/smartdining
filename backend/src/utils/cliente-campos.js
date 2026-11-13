/**
 * D-19 parte B: validación de los cuerpos de las rutas de clientes.
 *
 * Las reglas son las de los CHECK de la base (database/scripts/36_multicanal.sql),
 * para que un dato que pasa aquí no rebote después con un 422 genérico:
 *   - nombre:    btrim entre 1 y 80 caracteres (ck_clientes_nombre, VARCHAR(80));
 *   - email:     sin espacios, con @ y un punto en el dominio (ck_clientes_email),
 *                hasta 254 (VARCHAR(254)); se guarda y se busca en minúsculas,
 *                como el índice único sobre lower(email);
 *   - telefono:  ^\+?[0-9]{7,15}$ (ck_clientes_telefono);
 *   - direccion: btrim no vacío, hasta 200; barrio: btrim no vacío, hasta 80;
 *                referencia hasta 200; lat y lng juntos o ninguno, en rango.
 *
 * Cada validador devuelve `{ datos }` o `{ motivo, mensaje }`. Los motivos son
 * los del contrato (docs/api-spec.md, "Errores de las rutas de clientes").
 */

const { z } = require('zod');
const {
  CARACTERES_MINIMOS_CLAVE,
  claveCabeEnBcrypt,
  MENSAJE_CLAVE_CORTA,
  MENSAJE_CLAVE_DEMASIADO_LARGA,
} = require('./clave-bcrypt');

const MAX_NOMBRE = 80;
const MAX_EMAIL = 254;
const MAX_DIRECCION = 200;
const MAX_BARRIO = 80;
const MAX_REFERENCIA = 200;
/** Tope de la clave en el LOGIN: no es la regla de bcrypt, solo un freno a cuerpos absurdos. */
const MAX_CLAVE_LOGIN = 1024;

/**
 * La misma forma que ck_clientes_email. `\s` de JavaScript es la misma lista de
 * espacios que fn_tiene_espacio de la base (script 34).
 */
const PATRON_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;
const PATRON_TELEFONO = /^\+?[0-9]{7,15}$/;

const MOTIVO = Object.freeze({
  CUERPO: 'cuerpo_invalido',
  NOMBRE: 'nombre_invalido',
  EMAIL: 'email_invalido',
  CLAVE_CORTA: 'clave_corta',
  CLAVE_LARGA: 'clave_larga',
  TELEFONO: 'telefono_invalido',
});

const MENSAJE_CUERPO = 'El cuerpo de la petición no es válido';

/** Largo en caracteres como lo cuenta PostgreSQL (puntos de código, no UTF-16). */
const largo = (texto) => [...texto].length;

/** trim() y minúsculas: el mismo valor que compara el índice lower(email). */
function normalizarEmail(email) {
  return String(email).trim().toLowerCase();
}

const esObjetoPlano = (valor) =>
  valor !== null && typeof valor === 'object' && !Array.isArray(valor);

const fallo = (motivo, mensaje = MENSAJE_CUERPO) => ({ motivo, mensaje });

/** Claves que sobran respecto a las permitidas (el `.strict()` del contrato). */
const sobranClaves = (cuerpo, permitidas) => Object.keys(cuerpo).some((k) => !permitidas.includes(k));

function validarNombre(valor) {
  if (typeof valor !== 'string') return null;
  const nombre = valor.trim();
  return largo(nombre) >= 1 && largo(nombre) <= MAX_NOMBRE ? nombre : null;
}

function validarEmail(valor) {
  if (typeof valor !== 'string') return null;
  const email = normalizarEmail(valor);
  return email.length <= MAX_EMAIL && PATRON_EMAIL.test(email) ? email : null;
}

function validarTelefono(valor) {
  return typeof valor === 'string' && PATRON_TELEFONO.test(valor) ? valor : null;
}

/**
 * POST /auth/clientes/registro: `{ nombre, email, password, telefono? }`.
 * Un campo que falta o no sirve da SU motivo; una clave que sobra, o un cuerpo
 * que no es un objeto, `cuerpo_invalido`.
 */
function validarRegistro(cuerpo) {
  const permitidas = ['nombre', 'email', 'password', 'telefono'];
  if (!esObjetoPlano(cuerpo) || sobranClaves(cuerpo, permitidas)) return fallo(MOTIVO.CUERPO);

  const nombre = validarNombre(cuerpo.nombre);
  if (nombre === null) return fallo(MOTIVO.NOMBRE, `El nombre debe tener entre 1 y ${MAX_NOMBRE} caracteres`);

  const email = validarEmail(cuerpo.email);
  if (email === null) return fallo(MOTIVO.EMAIL, 'El email no es válido');

  const { password } = cuerpo;
  if (typeof password !== 'string') return fallo(MOTIVO.CUERPO);
  if ([...password].length < CARACTERES_MINIMOS_CLAVE) return fallo(MOTIVO.CLAVE_CORTA, MENSAJE_CLAVE_CORTA);
  if (!claveCabeEnBcrypt(password)) return fallo(MOTIVO.CLAVE_LARGA, MENSAJE_CLAVE_DEMASIADO_LARGA);

  let telefono = null;
  if (cuerpo.telefono !== undefined && cuerpo.telefono !== null) {
    telefono = validarTelefono(cuerpo.telefono);
    if (telefono === null) return fallo(MOTIVO.TELEFONO, 'El teléfono debe tener entre 7 y 15 dígitos, con + opcional');
  }

  return { datos: { nombre, email, password, telefono } };
}

/**
 * POST /auth/clientes/login: `{ email, password }`.
 *
 * Aquí NO se valida la forma del email: un email mal escrito sigue el camino de
 * uno que no existe (bcrypt contra el hash ficticio y 401), así que la
 * respuesta no dice nada que no diría un email bien escrito. Solo es 400 lo que
 * no es un intento de login: tipos equivocados, vacíos o claves de más.
 */
const esquemaLogin = z
  .object({
    email: z.string().trim().min(1).max(MAX_EMAIL),
    password: z.string().min(1).max(MAX_CLAVE_LOGIN),
  })
  .strict();

function validarLogin(cuerpo) {
  const r = esquemaLogin.safeParse(cuerpo);
  if (!r.success) return fallo(MOTIVO.CUERPO);
  return { datos: { email: normalizarEmail(r.data.email), password: r.data.password } };
}

/** `{ refresh_token }` con el formato exacto (43 caracteres base64url), y nada más. */
const esquemaRefresh = z.object({ refresh_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

function validarCuerpoRefresh(cuerpo) {
  const r = esquemaRefresh.safeParse(cuerpo);
  return r.success ? { datos: r.data } : fallo(MOTIVO.CUERPO);
}

/**
 * PATCH /clientes/yo: `{ nombre?, telefono? }`, al menos uno. `telefono: null`
 * lo borra. El contrato pide `cuerpo_invalido` para todo lo de esta ruta.
 */
function validarPerfil(cuerpo) {
  const permitidas = ['nombre', 'telefono'];
  if (!esObjetoPlano(cuerpo) || sobranClaves(cuerpo, permitidas)) return fallo(MOTIVO.CUERPO);
  if (cuerpo.nombre === undefined && cuerpo.telefono === undefined) return fallo(MOTIVO.CUERPO);

  const datos = {};
  if (cuerpo.nombre !== undefined) {
    const nombre = validarNombre(cuerpo.nombre);
    if (nombre === null) return fallo(MOTIVO.CUERPO, `El nombre debe tener entre 1 y ${MAX_NOMBRE} caracteres`);
    datos.nombre = nombre;
  }
  if (cuerpo.telefono !== undefined) {
    if (cuerpo.telefono === null) {
      datos.telefono = null;
    } else {
      const telefono = validarTelefono(cuerpo.telefono);
      if (telefono === null) return fallo(MOTIVO.CUERPO, 'El teléfono debe tener entre 7 y 15 dígitos, con + opcional');
      datos.telefono = telefono;
    }
  }
  return { datos };
}

/** Texto obligatorio recortado, de 1 a `max` caracteres. */
const textoObligatorio = (max) =>
  z.string().transform((s) => s.trim()).refine((s) => largo(s) >= 1 && largo(s) <= max);

/** Texto opcional: null o vacío quedan en null. */
const textoOpcional = (max) =>
  z
    .string()
    .nullable()
    .transform((s) => (s === null ? null : s.trim() || null))
    .refine((s) => s === null || largo(s) <= max);

const coordenada = (limite) => z.number().finite().min(-limite).max(limite).nullable();

const camposDireccion = {
  direccion: textoObligatorio(MAX_DIRECCION),
  barrio: textoObligatorio(MAX_BARRIO),
  referencia: textoOpcional(MAX_REFERENCIA),
  lat: coordenada(90),
  lng: coordenada(180),
  principal: z.boolean(),
};

/** lat y lng van juntos: los dos (números o null) o ninguno. */
function coordenadasJuntas(d) {
  if ((d.lat === undefined) !== (d.lng === undefined)) return false;
  if (d.lat === undefined) return true;
  return (d.lat === null) === (d.lng === null);
}

const esquemaNuevaDireccion = z
  .object({
    direccion: camposDireccion.direccion,
    barrio: camposDireccion.barrio,
    referencia: camposDireccion.referencia.optional(),
    lat: camposDireccion.lat.optional(),
    lng: camposDireccion.lng.optional(),
    principal: camposDireccion.principal.optional(),
  })
  .strict()
  .refine(coordenadasJuntas);

const esquemaCambioDireccion = z
  .object({
    direccion: camposDireccion.direccion.optional(),
    barrio: camposDireccion.barrio.optional(),
    referencia: camposDireccion.referencia.optional(),
    lat: camposDireccion.lat.optional(),
    lng: camposDireccion.lng.optional(),
    principal: camposDireccion.principal.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0)
  .refine(coordenadasJuntas);

function validarNuevaDireccion(cuerpo) {
  const r = esquemaNuevaDireccion.safeParse(cuerpo);
  return r.success ? { datos: r.data } : fallo(MOTIVO.CUERPO);
}

function validarCambioDireccion(cuerpo) {
  const r = esquemaCambioDireccion.safeParse(cuerpo);
  return r.success ? { datos: r.data } : fallo(MOTIVO.CUERPO);
}

/** Entero positivo (un id de la URL o de la query), o null. */
function idPositivo(valor) {
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,9}$/.test(valor)) return null;
  const n = Number(valor);
  return n <= 2147483647 ? n : null;
}

module.exports = {
  MOTIVO,
  MENSAJE_CUERPO,
  MAX_NOMBRE,
  MAX_EMAIL,
  PATRON_EMAIL,
  PATRON_TELEFONO,
  normalizarEmail,
  validarRegistro,
  validarLogin,
  validarCuerpoRefresh,
  validarPerfil,
  validarNuevaDireccion,
  validarCambioDireccion,
  idPositivo,
};
