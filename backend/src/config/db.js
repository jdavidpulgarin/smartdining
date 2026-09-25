const { Pool } = require('pg');
require('dotenv').config();

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
