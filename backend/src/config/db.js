const { Pool, types } = require('pg');
require('dotenv').config();

// node-postgres entrega NUMERIC/DECIMAL como string para no perder precisión,
// así que total, precio, subtotal y monto salían como "80000.00" en el JSON.
// El contrato de la API y el de socket-server/EVENTS.md los documentan como
// números, y los frontends hacen aritmética con ellos. Se convierte una sola
// vez aquí, por OID, en vez de mapear columna por columna en cada servicio.
//
// Contrapartida asumida: al pasar por Number se usa coma flotante, con el
// redondeo típico de dinero en JS. Es aceptable porque el backend ya NO calcula
// importes (los pone la base) y solo los transporta; cualquier suma de dinero
// debe seguir haciéndose en SQL.
const OID_NUMERIC = 1700;
types.setTypeParser(OID_NUMERIC, (valor) => (valor === null ? null : Number(valor)));

// Pool de conexiones a PostgreSQL. Los nombres de tabla/columna de todas las
// queries siguen docs/modelo-er.md (modelo ER oficial de Jarrison, 9 tablas).
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = pool;
