/**
 * Números de mesa para las suites de integración que crean mesas de usar y
 * tirar (issue #165).
 *
 * `npm run test:integracion` corre cada archivo en su propio proceso y en
 * paralelo, contra la misma base. Antes cada suite sacaba un número al azar de
 * un rango propio, pero los rangos se pisaban (9000-9899, 9100-9899,
 * 9500-9899): dos suites podían sacar el mismo número a la vez y la segunda
 * moría en la preparación con un 23505 de mesas_numero_key, sin que la prueba
 * tuviera nada que ver con mesas. Pasaba una vez cada 20-50 corridas.
 *
 * Dos medidas:
 *   1. Cada suite tiene un rango PROPIO y DISJUNTO (RANGOS). Dentro de él los
 *      números se reparten en orden desde un punto de partida al azar, así una
 *      suite tampoco choca con sus propias mesas.
 *   2. Red de seguridad: si el alta da 23505 de mesas_numero_key (una mesa que
 *      dejó una corrida cortada a medias, o alguien a mano), se reintenta con
 *      el número siguiente. Solo ese constraint: cualquier otro error sube tal
 *      cual.
 *
 * Los rangos quedan por encima de los números fijos de las demás suites
 * (pedidos-sql 901, transacciones-del-dia-sql 902, transacciones-mesa-sql
 * 904-923, mesas-rotacion-sql 940-959). Una suite nueva que cree mesas debe
 * tomar un rango libre aquí, no inventar el suyo.
 */

const RANGOS = Object.freeze({
  'pagos-concurrentes': { desde: 9000, hasta: 9199 },
  'cierre-pedido-pago': { desde: 9200, hasta: 9399 },
  'deadlock-pago-estado': { desde: 9400, hasta: 9599 },
  'mesas-sql': { desde: 9600, hasta: 9799 },
});

const PG_UNIQUE = '23505';
const CONSTRAINT_NUMERO = 'mesas_numero_key';
const MAX_INTENTOS = 20;

const esNumeroRepetido = (err) =>
  Boolean(err) && err.code === PG_UNIQUE && err.constraint === CONSTRAINT_NUMERO;

/**
 * @param {keyof RANGOS} suite
 * @returns {(alta: (numero: number) => Promise<T>) => Promise<T>}
 *   Llama a `alta` con un número del rango de la suite; si da 23505 de
 *   mesas_numero_key, vuelve a llamarla con el siguiente (hasta MAX_INTENTOS).
 */
function numerosDeMesa(suite) {
  const rango = RANGOS[suite];
  if (!rango) throw new Error(`suite sin rango de mesas en tests/helpers/mesa-prueba.js: ${suite}`);
  const tamano = rango.hasta - rango.desde + 1;
  let siguiente = Math.floor(Math.random() * tamano);
  const tomar = () => rango.desde + (siguiente++ % tamano);

  return async function conNumeroDeMesa(alta) {
    for (let intento = 1; ; intento++) {
      try {
        return await alta(tomar());
      } catch (err) {
        if (!esNumeroRepetido(err) || intento >= MAX_INTENTOS) throw err;
      }
    }
  };
}

module.exports = { RANGOS, numerosDeMesa };
