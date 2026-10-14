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
 * - Cualquier otro error, incluidos los demás de PostgreSQL (CHECK 23514,
 *   FK 23503, unique 23505, etc.) -> 500 genérico. El mensaje interno se
 *   registra en el servidor y nunca se expone al cliente.
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
};
