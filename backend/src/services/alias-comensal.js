const redis = require('../config/redis');

/**
 * Alias del comensal dentro de la sesión de su mesa.
 *
 * El alias ("Ana") identifica al comensal ante los demás: quién pidió cada
 * plato, a quién avisar que su plato está listo y cuánto paga en el modo
 * "propio". Si cada cliente lo eligiera en cada evento, cualquiera de la mesa
 * podría editar, quitar o pagar como otro. Por eso el backend lo fija UNA vez,
 * al abrir la sesión, y lo firma dentro del JWT; el socket-server solo cree
 * el del JWT.
 *
 * Unicidad: dos comensales de la misma sesión no pueden tener el mismo alias
 * (ni variantes por mayúsculas, tildes o espacios: "Ana", "ana" y "Ána" son el
 * mismo). Se reserva con HSETNX en `sd:mesa:{id}:alias`, que es atómico aunque
 * lleguen dos escaneos a la vez. La reserva vence con el JWT y se borra al
 * abrir una sesión nueva o al liberar la mesa.
 *
 * No hay tabla de sesiones de comensal en la base (crearla es de database/).
 * Mientras no exista, la reserva vive en Redis y falla CERRADA en producción:
 * sin Redis no se emite la sesión (503). Una sesión sin unicidad garantizada
 * reabriría la suplantación que esto cierra. Fuera de producción y sin
 * REDIS_URL se usa un respaldo en memoria para poder desarrollar sin Redis.
 */

const MIN = 2;
const MAX = 40;
// Letras (con tildes y ñ), números, espacio y . _ ' -. Nada de < > " / \ ni
// emojis: el alias se muestra en el panel, en la cocina y en notificaciones.
const PERMITIDOS = /^[\p{L}\p{M}\p{N} ._'-]+$/u;

const llave = (idMesa) => `sd:mesa:${idMesa}:alias`;

/**
 * Vigencia de la reserva de un comensal SIN CELULAR (D-18).
 *
 * DEBE COINCIDIR con el TTL de `sd:mesa:{ID}:sin_celular` del socket-server
 * (socket-server/EVENTS.md §6.4, donde son 24 h, igual que `pagaron`). Son dos
 * servicios guardando la misma persona en dos sitios: si aquí fuera más corto,
 * el alias quedaría libre con la persona todavía sentada y otro comensal podría
 * reservar su nombre; si fuera más largo, el nombre seguiría bloqueado aquí
 * después de que el socket-server ya la olvidó.
 *
 * No son las 3 h por defecto de `reservar`, que es la vida del JWT del comensal:
 * una persona sin celular no tiene JWT que caduque.
 */
const VIGENCIA_SIN_CELULAR = '24h';

/** Marca que distingue a un comensal sin celular de uno que entró por QR. */
const MARCA_SIN_CELULAR = 'sin_celular';

/** Ttl en segundos a partir de "3h", "90m", "45s", "1d" o un número de segundos. */
function segundos(vigencia) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(vigencia).trim());
  if (!m) return 3 * 60 * 60;
  const factor = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return Number(m[1]) * factor;
}

/**
 * Valida y normaliza el alias. Devuelve { alias, clave } o { error }.
 * - alias: como se muestra (sin espacios a los lados y sin dobles espacios).
 * - clave: para comparar (minúsculas, sin tildes ni espacios).
 */
function normalizarAlias(valor) {
  if (typeof valor !== 'string') return { error: 'comensal es obligatorio (tu nombre o apodo en la mesa)' };
  const alias = valor.normalize('NFC').trim().replace(/\s+/g, ' ');
  const largo = [...alias].length;
  if (largo < MIN || largo > MAX) return { error: `comensal debe tener entre ${MIN} y ${MAX} caracteres` };
  if (!PERMITIDOS.test(alias)) {
    return { error: 'comensal solo admite letras, números, espacios y . _ \' -' };
  }
  const clave = alias.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s._'-]/g, '');
  if (clave.length === 0) return { error: 'comensal debe tener al menos una letra o un número' };
  return { alias, clave };
}

// Respaldo SOLO para desarrollo sin Redis. idMesa -> Map(clave -> vence en ms)
const memoria = new Map();

async function clienteRedis() {
  if (!process.env.REDIS_URL) return null;
  return redis.connectRedis(); // lanza si Redis no responde: el llamador decide
}

/**
 * Reserva el alias para la sesión actual de la mesa.
 *
 * `extra` son campos que se guardan JUNTO al alias, para poder distinguir
 * después de dónde salió esa reserva. Hoy lo usa el alta de un comensal sin
 * celular, que guarda `{ sin_celular: true }`; el flujo de las sesiones de QR no
 * manda nada y sigue guardando `{ alias, en }` tal cual, como antes.
 *
 * @param {{alias: string, clave: string}} datos
 * @param {{vigencia?: string, ahora?: () => number, extra?: object}} opciones
 * @returns {Promise<{ok: true} | {enUso: true} | {noDisponible: true}>}
 */
async function reservar(idMesa, { alias, clave }, { vigencia = '3h', ahora = Date.now, extra = null } = {}) {
  const ttl = segundos(vigencia);
  let cliente;
  try {
    cliente = await clienteRedis();
  } catch (err) {
    console.error('[alias] Redis no está disponible:', err.message);
    return { noDisponible: true };
  }

  if (!cliente) {
    if (process.env.NODE_ENV === 'production') return { noDisponible: true };
    const mesa = memoria.get(idMesa) || new Map();
    memoria.set(idMesa, mesa);
    const guardado = mesa.get(clave);
    if (guardado && guardado.vence > ahora()) return { enUso: true };
    // El respaldo guarda lo mismo que Redis (el texto del alias, el vencimiento
    // y los campos extra), para que `esSinCelular` y `aliasReservado` contesten
    // igual con Redis y sin él.
    mesa.set(clave, { alias, vence: ahora() + ttl * 1000, extra: extra || null });
    return { ok: true };
  }

  try {
    const valor = { alias, en: new Date(ahora()).toISOString(), ...(extra || {}) };
    const nuevo = await cliente.hSetNX(llave(idMesa), clave, JSON.stringify(valor));
    if (!nuevo) return { enUso: true };
    // La reserva dura lo que el JWT más nuevo de la mesa.
    await cliente.expire(llave(idMesa), ttl);
    return { ok: true };
  } catch (err) {
    console.error('[alias] no se pudo reservar el alias:', err.message);
    return { noDisponible: true };
  }
}

/**
 * Lee la reserva de un alias UNA sola vez y devuelve todo lo que se sabe de
 * ella: de qué TIPO es y CÓMO se escribe.
 *
 * Es la pieza común de `esSinCelular` y `aliasReservado`, que antes hacían la
 * misma lectura cada una. Quien necesita las dos cosas —el `DELETE` de
 * comensales, que decide con el tipo y avisa al socket-server con el texto— la
 * llama directamente y paga un solo viaje a Redis.
 *
 * Cuatro resultados, y cada uno significa algo distinto para quien llama:
 *   - `{noDisponible: true}` Redis no responde: no se sabe nada.
 *   - `{noExiste: true}`     nadie tiene esa clave reservada (o ya venció).
 *   - `{ilegible: true}`     hay algo guardado, pero no se puede leer.
 *   - `{alias, sinCelular}`  el texto con el que se registró, y si la agregó el
 *     personal (`true`) o entró por QR / es una reserva anterior a la marca
 *     (`false`).
 *
 * @returns {Promise<{noDisponible: true} | {noExiste: true} | {ilegible: true}
 *   | {alias: string, sinCelular: boolean}>}
 */
async function leerReserva(idMesa, clave, { ahora = Date.now } = {}) {
  let cliente;
  try {
    cliente = await clienteRedis();
  } catch (err) {
    console.error('[alias] Redis no está disponible:', err.message);
    return { noDisponible: true };
  }

  if (!cliente) {
    if (process.env.NODE_ENV === 'production') return { noDisponible: true };
    const mesa = memoria.get(idMesa);
    const guardado = mesa && mesa.get(clave);
    if (!guardado || guardado.vence <= ahora()) return { noExiste: true };
    // Una entrada del respaldo anterior a D-18b puede no traer el texto: no se
    // puede saber cómo se escribe, así que cuenta como ilegible.
    if (!guardado.alias) return { ilegible: true };
    return {
      alias: guardado.alias,
      sinCelular: Boolean(guardado.extra && guardado.extra[MARCA_SIN_CELULAR] === true),
    };
  }

  try {
    const crudo = await cliente.hGet(llave(idMesa), clave);
    if (crudo === null || crudo === undefined) return { noExiste: true };

    let valor;
    try {
      valor = JSON.parse(crudo);
    } catch {
      console.error(`[alias] el alias guardado de la mesa ${idMesa} no se pudo leer`);
      return { ilegible: true };
    }

    if (!valor || typeof valor.alias !== 'string' || !valor.alias) return { ilegible: true };

    return { alias: valor.alias, sinCelular: valor[MARCA_SIN_CELULAR] === true };
  } catch (err) {
    console.error('[alias] no se pudo leer el alias:', err.message);
    return { noDisponible: true };
  }
}

/**
 * ¿Ese alias está reservado Y es de un comensal SIN CELULAR? (D-18)
 *
 * Distingue tres situaciones que necesitan respuestas distintas, y por eso no
 * devuelve un booleano:
 *   - `{noExiste: true}`   nadie tiene ese nombre reservado en la mesa.
 *   - `{sinCelular: false}` está reservado, pero NO lleva la marca: es la sesión
 *     de alguien que entró con su celular por el QR, o una reserva hecha ANTES
 *     de que existiera la marca. En los dos casos no se puede soltar desde el
 *     endpoint del personal: tirar la reserva de alguien que está conectado
 *     dejaría su nombre libre para otro, y sus platos acabarían con dueño nuevo.
 *   - `{sinCelular: true}`  la agregó el personal y sí se puede quitar.
 *   - `{noDisponible: true}` Redis no responde: no se sabe, y adivinar es
 *     justamente lo que no se puede hacer.
 *
 * Una reserva VIEJA sin marca se trata como de QR a propósito (falla cerrada):
 * es imposible saber a posteriori de dónde salió, y confundirse hacia el lado
 * de "no la toques" solo cuesta un 409; hacia el otro, cuesta la sesión de un
 * comensal.
 *
 * @returns {Promise<{sinCelular: boolean} | {noExiste: true} | {noDisponible: true}>}
 */
async function esSinCelular(idMesa, clave, opciones = {}) {
  const reserva = await leerReserva(idMesa, clave, opciones);
  if (reserva.noDisponible || reserva.noExiste) return reserva;
  // Un valor ilegible se trata como de QR, por lo mismo: ante la duda no se
  // suelta la reserva de nadie.
  if (reserva.ilegible) return { sinCelular: false };
  return { sinCelular: reserva.sinCelular };
}

/**
 * El TEXTO canónico del alias reservado con esa clave (D-18b).
 *
 * `esSinCelular` contesta de qué TIPO es la reserva; esto contesta CÓMO se
 * escribe. Son dos preguntas distintas y quien pide pedidos solo necesita la
 * segunda: le da igual si la persona entró por QR o la agregó el mesero, lo que
 * necesita es guardar el alias con la misma capitalización y las mismas tildes
 * con las que se registró, porque la cuenta agrupa por el texto exacto
 * (`btrim(dp.comensal)`) y «Abuela» y «abuela» saldrían en dos filas.
 *
 *   - `{alias: 'Abuela'}`    hay una reserva con esa clave; ese es su texto.
 *   - `{noExiste: true}`     nadie tiene esa clave reservada (o ya venció).
 *   - `{noDisponible: true}` Redis no responde: no se sabe.
 *
 * @returns {Promise<{alias: string} | {noExiste: true} | {noDisponible: true}>}
 */
async function aliasReservado(idMesa, clave, opciones = {}) {
  const reserva = await leerReserva(idMesa, clave, opciones);
  if (reserva.noDisponible) return reserva;
  // Sin texto utilizable no hay nada que canonicalizar, y quien llama sigue con
  // su propio camino (la cuenta, en el caso de los pedidos).
  if (reserva.noExiste || reserva.ilegible) return { noExiste: true };
  return { alias: reserva.alias };
}

/**
 * Suelta UN alias de la mesa, por su clave (D-18).
 *
 * Es lo contrario de `reservar`, no de `olvidarMesa`: quitar a una persona sin
 * celular de la mesa no puede llevarse por delante los alias de los demás
 * comensales, que siguen sentados con su sesión abierta.
 *
 * Devuelve la misma forma que `reservar` —`{ok}` o `{noDisponible}`— y no un
 * booleano, porque quien llama SÍ necesita distinguir "lo solté" de "no pude":
 * si Redis no responde, la reserva sigue ahí y responder 204 sería mentir. Es la
 * diferencia con `olvidarMesa`, que se llama después del commit y a la que da
 * igual fallar porque la reserva vence sola.
 *
 * El respaldo en memoria se limpia siempre, como en `olvidarMesa`: si el proceso
 * reservó sin Redis y luego se configuró REDIS_URL, la entrada vieja seguiría
 * marcando el alias como ocupado hasta que venciera.
 *
 * @returns {Promise<{ok: true} | {noDisponible: true}>}
 */
async function liberar(idMesa, clave) {
  const mesa = memoria.get(idMesa);
  if (mesa) mesa.delete(clave);

  let cliente;
  try {
    cliente = await clienteRedis();
  } catch (err) {
    console.error('[alias] Redis no está disponible:', err.message);
    return { noDisponible: true };
  }

  if (!cliente) {
    // Sin Redis, en producción no hay nada fiable que soltar: falla cerrada,
    // igual que `reservar`.
    if (process.env.NODE_ENV === 'production') return { noDisponible: true };
    return { ok: true };
  }

  try {
    await cliente.hDel(llave(idMesa), clave);
    // hDel devuelve 0 si el campo no estaba. No es un error: quitar a alguien
    // que ya no está es la misma situación final, y el contrato del socket
    // también trata ese caso como "sin cambio" (EVENTS.md §6.4).
    return { ok: true };
  } catch (err) {
    console.error('[alias] no se pudo soltar el alias:', err.message);
    return { noDisponible: true };
  }
}

/**
 * Olvida los alias de la mesa (sesión nueva o mesa liberada). Nunca lanza:
 * se llama después del commit y no debe deshacer nada. Si Redis falla, la
 * reserva vence sola con el JWT.
 */
async function olvidarMesa(idMesa) {
  memoria.delete(idMesa);
  try {
    const cliente = await clienteRedis();
    if (cliente) await cliente.del(llave(idMesa));
  } catch (err) {
    console.error(`[alias] no se pudieron borrar los alias de la mesa ${idMesa}:`, err.message);
  }
}

module.exports = {
  normalizarAlias, reservar, leerReserva, esSinCelular, aliasReservado, liberar,
  olvidarMesa, segundos, llave, MIN, MAX, VIGENCIA_SIN_CELULAR, MARCA_SIN_CELULAR,
};
