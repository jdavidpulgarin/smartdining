/**
 * Sonda de base para las suites de integración (issue #165).
 *
 * Antes cada suite abría `new Pool({ connectionTimeoutMillis: 2000 })`, hacía
 * `SELECT 1` y, ante CUALQUIER error, saltaba todas sus pruebas con "sin base
 * de datos". Con la máquina cargada la conexión tardaba más de 2 s y la suite
 * entera quedaba en skipped: la corrida salía verde sin haber probado nada.
 *
 * Ahora se distinguen dos casos:
 *   - Base NO configurada (ninguna de las variables PG* que lee
 *     src/config/db.js, ni en el entorno ni en el .env): devuelve null y la
 *     suite salta, como en el CI o en un worktree sin .env.
 *   - Base configurada: reintenta la sonda INTENTOS veces con un timeout amplio
 *     y, si sigue sin responder, LANZA "base configurada pero no responde",
 *     así el `before` falla y la suite sale en rojo.
 *
 * El Pool devuelto conserva ese timeout amplio para el resto de la suite: las
 * consultas siguientes también abren conexiones y con 2 s fallaban igual.
 *
 * Hay que llamarla DENTRO del `before`, después del dotenv.config() de la suite.
 */

const { Pool } = require('pg');

const VARIABLES_PG = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const INTENTOS = 3;
const TIMEOUT_MS = 10000;

const baseConfigurada = (env = process.env) =>
  VARIABLES_PG.some((v) => typeof env[v] === 'string' && env[v] !== '');

/**
 * @returns {Promise<import('pg').Pool|null>} null si no hay base configurada.
 * @throws si la base está configurada y no responde tras INTENTOS intentos.
 */
async function abrirSonda({
  intentos = INTENTOS,
  timeoutMs = TIMEOUT_MS,
  env = process.env,
  crearPool = (o) => new Pool(o),
} = {}) {
  if (!baseConfigurada(env)) return null;

  const pool = crearPool({ connectionTimeoutMillis: timeoutMs });
  let ultimo = null;
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (err) {
      ultimo = err;
    }
  }
  await pool.end().catch(() => {});
  // En Windows un puerto cerrado da un AggregateError sin message: se usa el code.
  const detalle = (ultimo && (ultimo.message || ultimo.code)) || String(ultimo);
  throw new Error(`base configurada pero no responde: ${detalle} (${intentos} intentos de ${timeoutMs} ms)`);
}

module.exports = { VARIABLES_PG, baseConfigurada, abrirSonda };
