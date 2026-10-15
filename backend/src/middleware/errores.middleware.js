/**
 * Manejo centralizado de errores. Es el UNICO lugar donde se decide el status
 * y el mensaje que sale al cliente: los controllers solo hacen next(err).
 */

// SQLSTATE que PostgreSQL asigna a un RAISE EXCEPTION sin código propio, o sea
// a las reglas de negocio que viven en los triggers de Jarrison.
const PG_RAISE_EXCEPTION = 'P0001';

/**
 * Clase 22 de SQLSTATE: "Data Exception". Dato fuera de rango, desbordamiento
 * numérico (22003), formato o sintaxis inválida, división por cero…
 *
 * No es un fallo del servidor ni una regla de negocio: es que el valor que se
 * intentó guardar no cabe o no sirve. Un 500 lo vuelve indistinguible de una
 * caída y empuja a reintentar, cuando reintentar nunca va a funcionar.
 */
const CLASE_DATOS_POSTGRES = '22';

/**
 * Mensaje único para toda la clase 22.
 *
 * A propósito no dice QUÉ dato ni DÓNDE: el texto real de PostgreSQL nombra
 * funciones, columnas y precisiones internas ("función PL/pgSQL
 * fn_tr_calcular_tiempo_preparacion() en la línea 28"), y eso es un mapa del
 * esquema para cualquiera que lo lea. Quien está delante de la pantalla necesita
 * saber dos cosas: que no es culpa suya y que reintentar no ayuda.
 */
const MENSAJE_DATOS_FUERA_DE_RANGO =
  'No se pudo registrar esta operación: un dato está fuera del rango permitido. Avisa al equipo.';

/** ¿Es un SQLSTATE de la clase 22 (data exception)? */
function esErrorDeDatos(codigo) {
  return typeof codigo === 'string' && codigo.length === 5 && codigo.startsWith(CLASE_DATOS_POSTGRES);
}

/**
 * Los dos SQLSTATE en los que PostgreSQL aborta una transacción porque chocó
 * con otra, y los ÚNICOS en los que reintentar tiene sentido:
 *
 * - 40P01 deadlock_detected: dos transacciones se esperan en círculo y el
 *   servidor mata a una. El backend ordena sus bloqueos (mesa antes del pedido,
 *   pedidos por id) justamente para que no pase, pero un INSERT directo a la
 *   base o una ruta futura que se despiste lo pueden reintroducir.
 * - 40001 serialization_failure: la transacción no se pudo serializar con otra.
 *
 * Es una lista explícita, NO la clase 40 completa: 40002 (violación de
 * integridad diferida) y 40003 (resultado desconocido) también son de esa clase
 * y reintentarlos a ciegas sería cobrar dos veces o guardar basura.
 */
const CODIGOS_CONCURRENCIA_POSTGRES = ['40P01', '40001'];

/**
 * Mensaje único para los dos. Como en la clase 22, a propósito no dice qué
 * filas ni qué transacción: el texto real de PostgreSQL nombra procesos,
 * relaciones y modos de bloqueo ("el proceso 12345 espera ShareLock en la
 * transacción 678; bloqueado por el proceso 12346"), que es un mapa del esquema
 * y de la carga del servidor. Lo que necesita saber quien está delante es que
 * no es culpa suya y que esta vez SÍ vale la pena reintentar.
 */
const MENSAJE_CONCURRENCIA = 'La operación chocó con otra en curso, vuelve a intentarlo';

/** ¿Es un deadlock (40P01) o un fallo de serialización (40001)? */
function esErrorDeConcurrencia(codigo) {
  return typeof codigo === 'string' && CODIGOS_CONCURRENCIA_POSTGRES.includes(codigo);
}

/**
 * SQLSTATE que hasta ahora caían en el 500 genérico aunque NO son fallos del
 * servidor. Un 500 los vuelve indistinguibles de una caída: el cliente no sabe
 * si corregir algo, reintentar o avisar al equipo.
 *
 * - 23505 unique_violation: ya existe una fila con esos datos -> 409.
 * - 23503 foreign_key_violation: la operación choca con otra fila relacionada
 *   -> 409. Cubre los dos sentidos de una FK (la fila referenciada no existe, o
 *   sigue referenciada y por eso no se puede borrar) con un mensaje que no dice
 *   cuál: distinguirlos obligaría a mirar el nombre del constraint, que es justo
 *   lo que no debe salir. Donde importa de verdad —el constructor— ya se traduce
 *   antes, con mensaje propio.
 * - 23514 check_violation: el cuerpo pasó el esquema pero el valor no cumple una
 *   regla de la base -> 422, el mismo caso que la clase 22 y con su mismo
 *   mensaje. No se abre un segundo significado para el 422.
 * - 57014 query_canceled: PostgreSQL abortó la consulta al vencer
 *   statement_timeout (ver src/config/db.js) -> 503. No se escribió nada y el
 *   problema es de carga, no de la petición: reintentar más tarde sirve.
 *
 * Es una lista explícita, NO la clase 23 completa: 23502 (NOT NULL) y 23P01
 * (violación de exclusión) significan otra cosa y siguen dando 500.
 */
const MENSAJE_REGISTRO_DUPLICADO = 'Ya existe un registro con esos datos';
const MENSAJE_REFERENCIA_RELACIONADA = 'La operación choca con otro registro relacionado';
const MENSAJE_CONSULTA_CANCELADA =
  'La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento';

/**
 * Un Map y no un objeto literal: con un objeto, un `código` como
 * 'constructor' o '__proto__' encontraría algo heredado del prototipo.
 *
 * `rotulo` es solo para el log del servidor; al cliente va `mensaje`.
 */
const TRADUCCION_POR_SQLSTATE = new Map([
  ['23505', { status: 409, mensaje: MENSAJE_REGISTRO_DUPLICADO, rotulo: 'Violación de unicidad' }],
  ['23503', { status: 409, mensaje: MENSAJE_REFERENCIA_RELACIONADA, rotulo: 'Violación de clave ajena' }],
  ['23514', { status: 422, mensaje: MENSAJE_DATOS_FUERA_DE_RANGO, rotulo: 'Violación de CHECK' }],
  ['57014', { status: 503, mensaje: MENSAJE_CONSULTA_CANCELADA, rotulo: 'Consulta cancelada por timeout' }],
]);

/**
 * Devuelve la traducción de un SQLSTATE, o null si no está en la lista.
 * Exportada para poder probar la tabla sin pasar por una ruta.
 */
function traduccionDeSqlstate(codigo) {
  if (typeof codigo !== 'string') return null;
  return TRADUCCION_POR_SQLSTATE.get(codigo) || null;
}

/**
 * Reglas:
 * - Error de negocio del backend ({ status, message }) -> ese status.
 * - RAISE EXCEPTION de un trigger (P0001) -> 409 con el mensaje del trigger,
 *   que está redactado para que lo lea el usuario ("El plato X no se encuentra
 *   disponible", "Transición de estado no autorizada: de A hacia B").
 * - Error de datos de PostgreSQL (clase 22, p. ej. 22003) -> 422 con un mensaje
 *   genérico y seguro. El detalle técnico va al log del servidor, no al cliente.
 * - Choque de concurrencia (40P01 deadlock, 40001 fallo de serialización) ->
 *   409 con un mensaje genérico que invita a reintentar, que es el único caso
 *   en el que reintentar sirve de algo. El detalle va al log.
 * - Integridad y cancelación (23505, 23503 -> 409; 23514 -> 422; 57014 -> 503)
 *   con mensajes genéricos. El detalle técnico va al log, no al cliente.
 * - Cualquier otro error, incluidos los demás de PostgreSQL (23502 NOT NULL,
 *   23P01 exclusión, etc.) -> 500 genérico. El mensaje interno se registra en
 *   el servidor y nunca se expone al cliente.
 *
 * El orden importa: la primera rama es la del error de negocio ({ status,
 * message }), así que lo que un service ya tradujo por su cuenta —p. ej.
 * constructor.service.js, que convierte 23505/23503/23514 en 409 con un mensaje
 * que nombra QUÉ choca— sale por ahí y nunca llega a la tabla genérica.
 */
function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({ error: err.message });
  }

  if (err && err.code === PG_RAISE_EXCEPTION) {
    return res.status(409).json({ error: err.message });
  }

  if (err && esErrorDeDatos(err.code)) {
    // El detalle completo (código, detail y where de PostgreSQL) se registra
    // para poder arreglar la causa; al cliente solo le llega el mensaje seguro.
    console.error(
      `Error de datos de PostgreSQL (${err.code}) en ${req.method} ${req.originalUrl}:`,
      err.message,
      err.detail || '',
      err.where || ''
    );
    return res.status(422).json({ error: MENSAJE_DATOS_FUERA_DE_RANGO });
  }

  if (err && esErrorDeConcurrencia(err.code)) {
    // Mismo criterio que la clase 22: el detalle completo al log del servidor
    // (es lo que permite encontrar el par de transacciones que chocó) y al
    // cliente solo el mensaje seguro.
    console.error(
      `Choque de concurrencia en PostgreSQL (${err.code}) en ${req.method} ${req.originalUrl}:`,
      err.message,
      err.detail || '',
      err.where || ''
    );
    return res.status(409).json({ error: MENSAJE_CONCURRENCIA });
  }

  const traduccion = traduccionDeSqlstate(err && err.code);
  if (traduccion) {
    // Mismo criterio que las clases 22 y 40: el detalle completo al log del
    // servidor (el nombre del constraint es lo que permite arreglar la causa) y
    // al cliente solo el mensaje genérico.
    console.error(
      `${traduccion.rotulo} en PostgreSQL (${err.code}) en ${req.method} ${req.originalUrl}:`,
      err.message,
      err.detail || '',
      err.where || ''
    );
    return res.status(traduccion.status).json({ error: traduccion.mensaje });
  }

  console.error('Error no controlado:', err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = {
  manejadorErrores,
  PG_RAISE_EXCEPTION,
  CLASE_DATOS_POSTGRES,
  MENSAJE_DATOS_FUERA_DE_RANGO,
  esErrorDeDatos,
  CODIGOS_CONCURRENCIA_POSTGRES,
  MENSAJE_CONCURRENCIA,
  esErrorDeConcurrencia,
  MENSAJE_REGISTRO_DUPLICADO,
  MENSAJE_REFERENCIA_RELACIONADA,
  MENSAJE_CONSULTA_CANCELADA,
  TRADUCCION_POR_SQLSTATE,
  traduccionDeSqlstate,
};
