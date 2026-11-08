const aliasComensal = require('./alias-comensal');

/**
 * Buscar a una persona en la cuenta de la mesa por la CLAVE de su alias.
 *
 * La cuenta agrupa por el TEXTO EXACTO (`btrim(dp.comensal)` en
 * `obtener_cuenta_mesa`), mientras que la identidad de un comensal se mide por
 * CLAVE (sin tildes, en minúsculas, sin espacios ni `. _ ' -`). Eso obliga a
 * mirar la cuenta por clave y quedarse con el texto, y es lo que hace falta en
 * tres sitios distintos:
 *
 *   - al dar de alta a alguien sin celular, para reservar el nombre con el que
 *     ya aparece en la cuenta en vez de partirla en dos filas;
 *   - al crear un pedido del personal, para guardar el ítem con ese mismo texto;
 *   - al quitar a alguien, para saber si tiene platos.
 *
 * Vive aquí, en una función pura, porque tres copias de la misma búsqueda
 * acabarían contestando cosas distintas a la misma pregunta. No consulta nada:
 * recibe la cuenta que ya leyó quien llama (`mesasService.cuentaPorComensal`).
 */

/**
 * El cajón de los ítems sin comensal. Lo pone la propia función SQL
 * (`COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')`), así que NO es una
 * persona y nunca se usa como alias de nadie: reservarlo o cargarle platos a
 * «General» sería apropiarse de todo lo que aún no tiene dueño.
 */
const CAJON_SIN_COMENSAL = 'General';

/**
 * El texto con el que esa persona ya aparece en la cuenta, o null.
 *
 * Solo cuenta quien tiene PLATOS (`items_pedidos > 0`): una fila que existe solo
 * por un pago (el `FULL OUTER JOIN` de `obtener_cuenta_mesa` las produce) no
 * dice cómo se escribe el nombre de quien está pidiendo ahora.
 *
 * Se devuelve el texto **tal como está en la cuenta**, no su forma normalizada:
 * es el valor por el que la base agrupa, y devolver otro crearía una tercera
 * fila. `normalizarAlias` solo se usa para comparar la clave y para descartar un
 * texto que ya no sería un alias válido (un dato viejo escrito a mano).
 *
 * DESEMPATE: si hay varios textos distintos con la misma clave —porque se
 * escribió de dos formas antes de que esto existiera— gana el que tiene MÁS
 * platos, y con empate el primero en el orden de la cuenta. Es el que más
 * probablemente reconozcan en la mesa, y es determinista, que es lo que importa
 * para que dos llamadas seguidas no contesten distinto.
 *
 * @param {{comensales?: Array<{comensal: string, items_pedidos: number|string}>}} cuentaMesa
 * @param {string} clave
 * @returns {string|null}
 */
function aliasConPlatos(cuentaMesa, clave) {
  const filas = (cuentaMesa && cuentaMesa.comensales) || [];

  let mejor = null;
  let masPlatos = 0;

  for (const fila of filas) {
    if (!fila || typeof fila.comensal !== 'string') continue;
    if (fila.comensal === CAJON_SIN_COMENSAL) continue;

    const platos = Number(fila.items_pedidos);
    if (!Number.isFinite(platos) || platos <= 0) continue;

    const normalizado = aliasComensal.normalizarAlias(fila.comensal);
    if (normalizado.error || normalizado.clave !== clave) continue;

    // `>` y no `>=`: con empate se queda el primero que se vio.
    if (mejor === null || platos > masPlatos) {
      mejor = fila.comensal;
      masPlatos = platos;
    }
  }

  return mejor;
}

/** ¿Esa persona ya tiene platos en la cuenta de la mesa? */
function tienePlatos(cuentaMesa, clave) {
  return aliasConPlatos(cuentaMesa, clave) !== null;
}

module.exports = { aliasConPlatos, tienePlatos, CAJON_SIN_COMENSAL };
