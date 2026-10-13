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
 * Reglas:
 * - Error de negocio del backend ({ status, message }) -> ese status.
 * - RAISE EXCEPTION de un trigger (P0001) -> 409 con el mensaje del trigger,
 *   que está redactado para que lo lea el usuario ("El plato X no se encuentra
 *   disponible", "Transición de estado no autorizada: de A hacia B").
 * - Error de datos de PostgreSQL (clase 22, p. ej. 22003) -> 422 con un mensaje
 *   genérico y seguro. El detalle técnico va al log del servidor, no al cliente.
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

  console.error('Error no controlado:', err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = {
  manejadorErrores,
  PG_RAISE_EXCEPTION,
  CLASE_DATOS_POSTGRES,
  MENSAJE_DATOS_FUERA_DE_RANGO,
  esErrorDeDatos,
};
