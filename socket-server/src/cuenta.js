/**
 * Cálculo del monto de una intención de pago. Lógica pura: recibe la cuenta
 * que calculó el backend (la única fuente de montos) y devuelve cuánto cobrar.
 * El cliente nunca envía montos: solo elige el modo.
 *
 * Todo en centavos enteros (COP × 100), sin decimales en ningún paso.
 */

// «igual» (Dividir) se quitó en T2: quedan «pagar lo mío» (propio) y «pagar
// toda la cuenta» (total). pagos.js responde 400 si llega (EVENTS.md §8.1).
// `calcularMonto` solo recibe modos ya validados.
const MODOS = ['total', 'propio'];
const MODO_RETIRADO = 'igual';

const esCentavos = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * Valida la respuesta del backend antes de usarla para cobrar: si viene
 * malformada se trata como un error del servidor, nunca como saldo 0 o
 * como un número cualquiera.
 *
 * Contrato (GET /api/mesas/:id/cuenta/interno):
 *   { id_mesa, moneda: "COP", total_centavos, saldo_centavos,
 *     por_comensal: [{ comensal, saldo_centavos }] }
 */
function validarCuenta(c, idMesa) {
  if (!c || typeof c !== 'object') return 'cuenta vacía';
  if (c.id_mesa !== idMesa) return 'la cuenta es de otra mesa';
  if (c.moneda !== 'COP') return 'moneda no soportada';
  if (!esCentavos(c.total_centavos) || !esCentavos(c.saldo_centavos)) return 'montos inválidos';
  if (c.saldo_centavos > c.total_centavos) return 'el saldo supera el total';
  if (!Array.isArray(c.por_comensal)) return 'por_comensal inválido';
  for (const p of c.por_comensal) {
    if (!p || typeof p.comensal !== 'string' || !esCentavos(p.saldo_centavos)) return 'por_comensal inválido';
  }
  return null;
}

/**
 * @param {object} datos
 * @param {'total'|'propio'} datos.modo
 * @param {object} datos.cuenta      Cuenta ya validada (validarCuenta)
 * @param {string} datos.comensal    Alias de quien paga
 * @returns {{ montoCentavos: number } | { error: 'SIN_SALDO' }}
 */
function calcularMonto({ modo, cuenta, comensal }) {
  const saldo = cuenta.saldo_centavos;
  if (saldo <= 0) return { error: 'SIN_SALDO' };

  if (modo === 'total') return { montoCentavos: saldo };

  // propio: lo que el backend atribuye a este comensal, sin pasar del saldo.
  const propio = cuenta.por_comensal.find((p) => p.comensal === comensal);
  const monto = Math.min(propio ? propio.saldo_centavos : 0, saldo);
  return monto > 0 ? { montoCentavos: monto } : { error: 'SIN_SALDO' };
}

module.exports = {
  calcularMonto, validarCuenta, MODOS, MODO_RETIRADO,
};
