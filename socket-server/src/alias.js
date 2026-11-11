/**
 * Regla del alias del comensal (EVENTS.md §6.4 y R-18). Es la MISMA función que
 * `normalizarAlias` de backend/src/services/alias-comensal.js: los dos servicios
 * guardan a la misma persona y tienen que decidir igual quién es quién.
 * tests/alias-paridad.test.js las compara sobre muchos casos para que no se
 * separen; si cambias algo aquí, cámbialo también allá (y al revés).
 *
 * - alias: como se muestra (NFC, sin espacios a los lados ni dobles).
 * - clave: para comparar identidad (sin tildes, minúsculas, sin espacios ni . _ ' -).
 *   «Ana», «ana» y «Ána» tienen la misma clave.
 *
 * El módulo del backend no se importa en producción: arrastra su cliente de
 * Redis y su configuración. Esta copia no tiene dependencias.
 */

const MIN_ALIAS = 2;
const MAX_ALIAS = 40;
// Letras (con tildes y ñ), marcas, números, espacio y . _ ' -.
const PERMITIDOS = /^[\p{L}\p{M}\p{N} ._'-]+$/u;
// «General» es el cajón de los platos sin dueño en la cuenta (D-18c): no es
// una persona y nadie puede llamarse así.
const CLAVE_RESERVADA = 'general';

/** Devuelve { alias, clave } o { error } (mensaje para el log o la respuesta). */
function normalizarAlias(valor) {
  if (typeof valor !== 'string') return { error: 'alias debe ser un texto' };
  const alias = valor.normalize('NFC').trim().replace(/\s+/g, ' ');
  const largo = [...alias].length;
  if (largo < MIN_ALIAS || largo > MAX_ALIAS) return { error: `alias debe tener entre ${MIN_ALIAS} y ${MAX_ALIAS} caracteres` };
  if (!PERMITIDOS.test(alias)) return { error: 'alias solo admite letras, números, espacios y . _ \' -' };
  const clave = alias.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s._'-]/g, '');
  if (clave.length === 0) return { error: 'alias debe tener al menos una letra o un número' };
  if (clave === CLAVE_RESERVADA) return { error: 'alias no puede ser «General» (es el cajón de los platos sin dueño)' };
  return { alias, clave };
}

module.exports = {
  normalizarAlias, MIN_ALIAS, MAX_ALIAS, CLAVE_RESERVADA,
};
