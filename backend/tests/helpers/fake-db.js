// Las pruebas corren sin PostgreSQL: este helper reemplaza pool.query y
// pool.connect por dobles en memoria y registra las queries ejecutadas, para
// poder afirmar con qué valores llegó cada INSERT.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

const jwt = require('jsonwebtoken');
const pool = require('../../src/config/db');
const { ROL_COMENSAL } = require('../../src/middleware/auth.middleware');

/**
 * @param {(sql: string, params: any[]) => {rows: any[]}|undefined} responder
 *        devuelve las filas de cada query; si devuelve undefined, { rows: [] }.
 */
function instalarFakeDb(responder) {
  const queryOriginal = pool.query;
  const connectOriginal = pool.connect;
  const ejecutadas = [];

  const ejecutar = async (sql, params = []) => {
    ejecutadas.push({ sql, params });
    return responder(sql, params) || { rows: [] };
  };

  pool.query = ejecutar;
  pool.connect = async () => ({ query: ejecutar, release() {} });

  return {
    ejecutadas,
    /** Primera query ejecutada que contiene el fragmento de SQL dado. */
    buscar(fragmento) {
      return ejecutadas.find((q) => q.sql.includes(fragmento));
    },
    restaurar() {
      pool.query = queryOriginal;
      pool.connect = connectOriginal;
    },
  };
}

function tokenComensal(id_mesa) {
  return jwt.sign({ id_mesa, rol: ROL_COMENSAL }, process.env.JWT_SECRET, { expiresIn: '3h' });
}

function tokenStaff(id_usuario, rol) {
  return jwt.sign({ id_usuario, rol }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { instalarFakeDb, tokenComensal, tokenStaff };
