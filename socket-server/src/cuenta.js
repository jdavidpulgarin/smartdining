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
 * Entre cuántas personas se reparte el saldo en modo "igual": las presentes
 * que todavía no han pagado en esta sesión de mesa, más quien paga (si ya
 * pagó algo o no está sentado, igual cuenta). Nunca menos de 1. Quien se fue
 * sin pagar deja de contar.
 *
 * @param {object} datos
 * @param {string[]} datos.comensales  Alias presentes (mesa:presencia.comensales)
 * @param {string[]} datos.pagaron     Alias que ya pagaron (mesa:presencia.pagaron)
 * @param {string} datos.comensal      Alias de quien paga
 */
function personasPorPagar({ comensales, pagaron, comensal }) {
  const yaPagaron = new Set(pagaron);
  const pendientes = new Set(comensales.filter((a) => !yaPagaron.has(a)));
  pendientes.add(comensal);
  return Math.max(1, pendientes.size);
}

/**
 * @param {object} datos
 * @param {'total'|'igual'|'propio'} datos.modo
 * @param {object} datos.cuenta      Cuenta ya validada (validarCuenta)
 * @param {string} datos.comensal    Alias de quien paga
 * @param {number} datos.personas    Para "igual": personasPorPagar(...)
 * @returns {{ montoCentavos: number } | { error: 'SIN_SALDO' }}
 */
function calcularMonto({
  modo, cuenta, comensal, personas,
}) {
  const saldo = cuenta.saldo_centavos;
  if (saldo <= 0) return { error: 'SIN_SALDO' };

  if (modo === 'total') return { montoCentavos: saldo };

  if (modo === 'propio') {
    const propio = cuenta.por_comensal.find((p) => p.comensal === comensal);
    const monto = Math.min(propio ? propio.saldo_centavos : 0, saldo);
    return monto > 0 ? { montoCentavos: monto } : { error: 'SIN_SALDO' };
  }

  // igual: se reparte el SALDO que queda entre quienes aún no han pagado
  // (incluido quien paga). Así ningún pago "propio" o de caja deja un saldo
  // sin dueño ni le carga a uno la parte de otro. La parte se redondea a
  // pesos; quien paga de último (n = 1) cubre el saldo exacto, y nunca se
  // cobra más que el saldo. La PWA replica esta fórmula (EVENTS.md §8.1).
  const n = Math.max(1, personas);
  const parte = Math.round(saldo / n / CENTAVOS_POR_PESO) * CENTAVOS_POR_PESO;
  if (n === 1 || parte <= 0 || parte >= saldo) return { montoCentavos: saldo };
  return { montoCentavos: parte };
}

module.exports = {
  calcularMonto, personasPorPagar, validarCuenta, MODOS, CENTAVOS_POR_PESO,
};
