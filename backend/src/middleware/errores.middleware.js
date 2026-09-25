/**
 * Manejo centralizado de errores. Es el UNICO lugar donde se decide el status
 * y el mensaje que sale al cliente: los controllers solo hacen next(err).
 */

// SQLSTATE que PostgreSQL asigna a un RAISE EXCEPTION sin código propio, o sea
// a las reglas de negocio que viven en los triggers de Jarrison.
const PG_RAISE_EXCEPTION = 'P0001';

/**
 * Reglas:
 * - Error de negocio del backend ({ status, message }) -> ese status.
 * - RAISE EXCEPTION de un trigger (P0001) -> 409 con el mensaje del trigger,
 *   que está redactado para que lo lea el usuario ("El plato X no se encuentra
 *   disponible", "Transición de estado no autorizada: de A hacia B").
 * - Cualquier otro error, incluidos los de PostgreSQL (CHECK 23514, FK 23503,
 *   unique 23505, etc.) -> 500 genérico. El mensaje interno se registra en el
 *   servidor y nunca se expone al cliente.
 */
function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({ error: err.message });
  }

  if (err && err.code === PG_RAISE_EXCEPTION) {
    return res.status(409).json({ error: err.message });
  }

  console.error('Error no controlado:', err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

module.exports = { manejadorErrores, PG_RAISE_EXCEPTION };
