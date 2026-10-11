/**
 * Cálculo del monto de una intención de pago. Lógica pura: recibe la cuenta
 * que calculó el backend (la única fuente de montos) y devuelve cuánto cobrar.
 * El cliente nunca envía montos: solo elige el modo.
 *
 * Todo en centavos enteros (COP × 100), sin decimales en ningún paso.
 */

const MODOS = ['total', 'igual', 'propio'];
const CENTAVOS_POR_PESO = 100;

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
 * @param {'total'|'igual'|'propio'} datos.modo
 * @param {object} datos.cuenta      Cuenta ya validada (validarCuenta)
 * @param {string} datos.comensal    Alias de quien paga
 * @param {number} datos.presentes   Personas en la mesa (mesa:presencia.total)
 * @returns {{ montoCentavos: number } | { error: 'SIN_SALDO' }}
 */
function calcularMonto({
  modo, cuenta, comensal, presentes,
}) {
  const saldo = cuenta.saldo_centavos;
  if (saldo <= 0) return { error: 'SIN_SALDO' };

  if (modo === 'total') return { montoCentavos: saldo };

  if (modo === 'propio') {
    const propio = cuenta.por_comensal.find((p) => p.comensal === comensal);
    const monto = Math.min(propio ? propio.saldo_centavos : 0, saldo);
    return monto > 0 ? { montoCentavos: monto } : { error: 'SIN_SALDO' };
  }

  // igual: se reparte el TOTAL de la cuenta (no el saldo que va quedando),
  // así las partes son iguales aunque se paguen en momentos distintos. Cada
  // parte se redondea a pesos. El residuo del redondeo lo cubre quien paga
  // de último, y nunca se cobra más que el saldo.
  const n = Math.max(1, presentes);
  const parte = Math.round(cuenta.total_centavos / n / CENTAVOS_POR_PESO) * CENTAVOS_POR_PESO;
  const residuo = Math.max(0, cuenta.total_centavos - parte * n);
  // "Último en pagar": lo que queda cabe en una parte más el residuo.
  if (parte <= 0 || saldo <= parte + residuo) return { montoCentavos: saldo };
  return { montoCentavos: parte };
}

module.exports = {
  calcularMonto, validarCuenta, MODOS, CENTAVOS_POR_PESO,
};
