/**
 * El 23503 del AUTOR: "tu usuario ya no existe" (review de #144).
 *
 * Varias escrituras del panel anotan QUIÉN las hizo, y el autor sale del JWT.
 * Si ese usuario se borró mientras la sesión seguía viva, el `INSERT` o el
 * `UPDATE` choca contra la clave ajena de `usuarios` y PostgreSQL devuelve
 * **23503**. Sin traducirlo, el manejador central contesta su 409 genérico —"La
 * operación choca con otro registro relacionado"— sin `motivo`: quien está en el
 * panel no se entera de que el problema es su propia sesión, y lo único que
 * arregla el caso es volver a entrar.
 *
 * No hay una sola FK en juego, y los nombres NO siguen un patrón: tres de ellas
 * los pusieron a mano (`fk_…`) y la de `movimientos_inventario` la generó
 * PostgreSQL. Están comprobados contra la base real con:
 *
 *   SELECT c.conrelid::regclass, a.attname, c.conname
 *     FROM pg_constraint c
 *     JOIN unnest(c.conkey) AS k(attnum) ON true
 *     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
 *    WHERE c.contype = 'f' AND c.confrelid = 'usuarios'::regclass;
 *
 * Por eso se mira el NOMBRE del constraint y no solo el SQLSTATE: un 23503 de
 * otra cosa —una categoría que no existe, un insumo que no existe— significa
 * algo distinto y tiene que seguir su camino.
 */

/** SQLSTATE foreign_key_violation. */
const PG_FK = '23503';

/**
 * Las claves ajenas que apuntan al AUTOR de un cambio, con quién las dispara:
 *
 *   - `fk_historial_precios_usuario` → `historial_precios.id_usuario`, que
 *     escriben los triggers `tr_historial_precio_plato` y
 *     `tr_historial_precio_ingrediente` (scripts 26) al cambiar un precio.
 *   - `fk_configuracion_actualizado_por` → `configuracion_restaurante
 *     .actualizado_por`, que pone `tr_configuracion_actualizada` en cada PUT.
 *   - `movimientos_inventario_id_usuario_fkey` → `movimientos_inventario
 *     .id_usuario` (script 27), en cada entrada, ajuste o merma.
 *
 * Todas leen el id con `fn_usuario_de_sesion()`, o sea de
 * `set_config('app.id_usuario', …)`, salvo la de movimientos, que además lo
 * recibe desde `registrar_movimiento_inventario`.
 */
const FK_AUTOR = [
  'fk_historial_precios_usuario',
  'fk_configuracion_actualizado_por',
  'movimientos_inventario_id_usuario_fkey',
];

const MOTIVO_AUTOR_INEXISTENTE = 'autor_inexistente';

/**
 * El mensaje dice qué pasa Y qué hacer. No menciona tablas ni constraints: a
 * quien está en el panel no le sirve saber que chocó `historial_precios`, le
 * sirve saber que su sesión ya no vale.
 */
const MENSAJE_AUTOR_INEXISTENTE = 'Tu usuario ya no existe; vuelve a iniciar sesión';

/** ¿Es el 23503 de una de las FK del autor? */
function esAutorInexistente(err) {
  return Boolean(
    err && err.code === PG_FK && typeof err.constraint === 'string'
      && FK_AUTOR.includes(err.constraint)
  );
}

/**
 * Traduce ese 23503 a un error de negocio, o devuelve **null** si no es este
 * caso, para que quien llama siga con su propia traducción.
 *
 * Devuelve `null` y no el error de entrada a propósito: así el llamador escribe
 * `traducirAutorInexistente(err) || suPropiaTraduccion(err)` y se lee en qué
 * orden se intentan las dos.
 *
 * @returns {null | {status: 409, message: string, motivo: string}}
 */
function traducirAutorInexistente(err) {
  if (!esAutorInexistente(err)) return null;
  return {
    status: 409,
    message: MENSAJE_AUTOR_INEXISTENTE,
    motivo: MOTIVO_AUTOR_INEXISTENTE,
  };
}

module.exports = {
  traducirAutorInexistente,
  esAutorInexistente,
  PG_FK,
  FK_AUTOR,
  MOTIVO_AUTOR_INEXISTENTE,
  MENSAJE_AUTOR_INEXISTENTE,
};
