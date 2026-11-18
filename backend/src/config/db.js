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

/**
 * Lee una variable de entorno como entero positivo en milisegundos.
 *
 * NO lanza nunca: una variable mal escrita en un .env no debe impedir que el
 * backend arranque, porque el default siempre es un valor seguro. Si el valor
 * falta, está vacío, no es un número, no es entero o no es > 0, se usa el
 * default y se avisa en el log para que se note sin romper nada.
 *
 * Se descarta el 0 a propósito: en pg, un 0 significa "sin límite" en estas
 * cuatro opciones, que es exactamente lo que estos timeouts vienen a evitar.
 *
 * Solo se aceptan dígitos. `Number` por sí solo daría 16 para '0x10' y 10000
 * para '1e4': un valor de configuración no debería depender de esas sutilezas,
 * y quien escribe '0x10' en un .env casi seguro quería otra cosa.
 */
const SOLO_DIGITOS = /^\d+$/;

function enteroPositivo(nombre, defecto, env = process.env) {
  const crudo = env[nombre];
  if (crudo === undefined || String(crudo).trim() === '') return defecto;

  const texto = String(crudo).trim();
  const valor = SOLO_DIGITOS.test(texto) ? Number(texto) : NaN;
  if (!Number.isInteger(valor) || valor <= 0) {
    console.error(
      `${nombre} no es un entero positivo ("${crudo}"): se usa el valor por defecto ${defecto}.`
    );
    return defecto;
  }
  return valor;
}

/**
 * H-25: límites del pool. Antes no se configuraba ninguno y quedaban los
 * defaults de pg, con dos agujeros:
 *
 * - `connectionTimeoutMillis` por defecto es 0, o sea esperar PARA SIEMPRE una
 *   conexión libre. Con PostgreSQL caído o saturado, la petición se cuelga y el
 *   cliente con ella, porque Express tampoco tiene timeout propio.
 * - No había `statement_timeout`, así que una query trabada retenía su conexión
 *   indefinidamente. Con `max: 10`, diez de esas dejan el backend muerto sin un
 *   solo error en el log.
 *
 * `statement_timeout` y no `query_timeout`: el segundo corta solo del lado del
 * cliente y DEJA la query corriendo en el servidor. El primero la aborta de
 * verdad, y PostgreSQL devuelve 57014, que errores.middleware.js traduce a 503.
 *
 * Los cuatro son configurables porque el VPS y una máquina de desarrollo no
 * aguantan lo mismo. Los defaults de `max` e `idleTimeoutMillis` son los de pg,
 * puestos explícitos para que se vean y se puedan ajustar.
 */
const LIMITES = {
  max: enteroPositivo('PG_POOL_MAX', 10),
  idleTimeoutMillis: enteroPositivo('PG_IDLE_TIMEOUT_MS', 10000),
  connectionTimeoutMillis: enteroPositivo('PG_CONNECTION_TIMEOUT_MS', 5000),
  statement_timeout: enteroPositivo('PG_STATEMENT_TIMEOUT_MS', 10000),
};

// Pool de conexiones a PostgreSQL. Los nombres de tabla/columna de todas las
// queries siguen docs/modelo-er.md (modelo ER oficial de Jarrison, 9 tablas).
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ...LIMITES,
});

/**
 * Sin este listener, un error en una conexión INACTIVA del pool (la base se
 * reinició, el firewall cortó la sesión) es un evento 'error' sin manejador en
 * un EventEmitter, y Node tumba el proceso entero. No hay petición a la que
 * responderle: lo único que toca es registrarlo y seguir, que pg descarta esa
 * conexión y abre otra.
 */
pool.on('error', (err) => {
  console.error(`Error inesperado en el pool de PostgreSQL (${err && err.code}):`, err.message);
});

// El módulo exporta el pool tal cual desde siempre (`require('../config/db')`
// devuelve el Pool), así que los dos auxiliares se cuelgan de él en vez de
// cambiar la forma del export y tocar los 15 servicios que lo importan.
// `enteroPositivo` recibe el env por parámetro para poder probarlo sin
// depender del que ya se leyó al cargar este módulo.
module.exports = pool;
module.exports.LIMITES = LIMITES;
module.exports.enteroPositivo = enteroPositivo;
