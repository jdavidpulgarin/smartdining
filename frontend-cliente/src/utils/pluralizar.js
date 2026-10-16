/**
 * Devuelve la forma singular o plural según el número n.
 *
 * @param {number|string} n - Cantidad a evaluar
 * @param {string} singular - Forma singular (ej. 'plato', 'producto')
 * @param {string} [plural] - Forma plural (por defecto: singular + 's')
 * @returns {string} - La forma correspondiente a n
 */
export function pluralizar(n, singular, plural = `${singular}s`) {
  return Number(n) === 1 ? singular : plural;
}

export default pluralizar;
