/**
 * Error de negocio `{ status, message, motivo }`. El manejador global
 * (errores.middleware.js) lo responde tal cual como `{ error, motivo }`, que es
 * la forma que piden las rutas de clientes (D-19).
 */
function errorConMotivo(status, motivo, message) {
  const err = new Error(message);
  err.status = status;
  err.motivo = motivo;
  return err;
}

module.exports = { errorConMotivo };
