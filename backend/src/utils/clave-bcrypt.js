/**
 * El tope de bcrypt para una contraseña NUEVA: como mucho 72 BYTES en UTF-8.
 *
 * bcrypt solo mira los primeros 72 bytes y descarta el resto EN SILENCIO. Con
 * una clave más larga, el usuario tendría una contraseña que no es la que
 * escribió (cualquier texto con el mismo comienzo entraría). Y no es un caso
 * teórico en español: una `ñ` o una tilde ocupan DOS bytes, y un emoji, cuatro,
 * así que 40 caracteres pueden pasar de 72 bytes. `.max(72)` de zod cuenta
 * caracteres, no bytes, así que no sirve: aquí se cuenta con Buffer.byteLength.
 *
 * Se aplica en TODOS los sitios donde se fija o cambia una clave que pasa por
 * bcrypt.hash (POST /auth/register y POST /usuarios/:id/clave). NO en el login:
 * quien creó una clave larga antes de este tope tiene que poder seguir
 * entrando, y bcrypt.compare la trunca igual que la truncó al guardarla.
 */

const { z } = require('zod');

/** Lo que bcrypt de verdad usa de una contraseña. */
const BYTES_MAXIMOS_CLAVE = 72;

/**
 * Mínimo de una clave NUEVA, en CARACTERES (lo que la persona escribe y
 * cuenta). El mismo en el registro y en el cambio de clave, y el que ya exige
 * el panel (decidido con Jarrison). Antes el registro pedía 6 y el cambio 8.
 * Como el tope, NO se aplica en el login: una clave de 6 o 7 creada antes
 * tiene que poder seguir entrando.
 */
const CARACTERES_MINIMOS_CLAVE = 8;

const MENSAJE_CLAVE_CORTA = `La contraseña debe tener al menos ${CARACTERES_MINIMOS_CLAVE} caracteres`;

const MOTIVO_CLAVE_DEMASIADO_LARGA = 'clave_demasiado_larga';

const MENSAJE_CLAVE_DEMASIADO_LARGA =
  'La contraseña no puede pasar de 72 bytes; las letras con tilde y los emojis ocupan más de uno';

/** ¿Cabe la clave entera en lo que bcrypt usa? */
function claveCabeEnBcrypt(clave) {
  return typeof clave === 'string' && Buffer.byteLength(clave, 'utf8') <= BYTES_MAXIMOS_CLAVE;
}

/**
 * Añade el tope a un esquema de zod de la clave. El issue lleva su `motivo` en
 * `params`, para que `cuerpoDel400` lo saque sin tocar la forma de los demás
 * errores de validación.
 *
 * @param {import('zod').ZodString} esquema
 */
function conTopeDeBcrypt(esquema) {
  return esquema.refine(claveCabeEnBcrypt, {
    message: MENSAJE_CLAVE_DEMASIADO_LARGA,
    params: { motivo: MOTIVO_CLAVE_DEMASIADO_LARGA },
  });
}

/**
 * El esquema de zod de una clave NUEVA, con el mínimo y el tope comunes. Lo
 * usan el registro y el cambio de clave, para que no vuelvan a separarse.
 */
function esquemaClaveNueva() {
  return conTopeDeBcrypt(z.string().min(CARACTERES_MINIMOS_CLAVE, MENSAJE_CLAVE_CORTA));
}

/**
 * El cuerpo del 400 de un safeParse fallido, con la MISMA forma que ya usan
 * estas rutas: `{ error }` con el primer mensaje de zod. Solo cuando el fallo
 * es el del tope se añade `motivo`, para que el cliente lo distinga sin
 * comparar textos.
 *
 * @param {import('zod').ZodError} errorDeZod
 */
function cuerpoDel400(errorDeZod) {
  const issue = errorDeZod.errors[0];
  const cuerpo = { error: issue.message };
  if (issue.params && typeof issue.params.motivo === 'string') cuerpo.motivo = issue.params.motivo;
  return cuerpo;
}

module.exports = {
  BYTES_MAXIMOS_CLAVE,
  CARACTERES_MINIMOS_CLAVE,
  MENSAJE_CLAVE_CORTA,
  esquemaClaveNueva,
  MOTIVO_CLAVE_DEMASIADO_LARGA,
  MENSAJE_CLAVE_DEMASIADO_LARGA,
  claveCabeEnBcrypt,
  conTopeDeBcrypt,
  cuerpoDel400,
};
