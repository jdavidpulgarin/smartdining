/**
 * Cálculo del monto de una intención de pago. Lógica pura: recibe la cuenta
 * que calculó el backend (la única fuente de montos) y devuelve cuánto cobrar.
 * El cliente nunca envía montos: solo elige el modo.
 *
 * Todo en centavos enteros (COP × 100), sin decimales en ningún paso.
 */

const { claveAlias } = require('./alias');

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
  // Por la clave del alias: «Ana» (pagó en línea) y «ana» (la Caja) son la
  // misma persona y no cuentan dos veces.
  const clave = (a) => claveAlias(a) ?? a;
  const yaPagaron = new Set(pagaron.map(clave));
  const pendientes = new Set(comensales.map(clave).filter((c) => !yaPagaron.has(c)));
  pendientes.add(clave(comensal));
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
    // El comensal de la cuenta (el texto que guardó el backend en cada línea)
    // se compara por la CLAVE del alias, no por el texto exacto: « ana » y
    // «Ana» son la misma persona. Si el backend trae a la misma persona en
    // dos filas (dos formas de escribirla), sus saldos se suman.
    const mia = claveAlias(comensal);
    const propio = mia === null ? 0 : cuenta.por_comensal
      .filter((p) => claveAlias(p.comensal) === mia)
      .reduce((s, p) => s + p.saldo_centavos, 0);
    const monto = Math.min(propio, saldo);
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
