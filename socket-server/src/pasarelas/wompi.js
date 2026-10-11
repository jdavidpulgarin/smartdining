const crypto = require('crypto');

/**
 * Pasarela Wompi (Bancolombia), modo sandbox por defecto. Implementa
 * PasarelaPago (ver PasarelaPago.js).
 *
 * Verificado contra la documentación oficial (docs.wompi.co, oct. 2026):
 * - Firma de integridad del Widget / Web Checkout:
 *     SHA-256 hex de "<referencia><monto_en_centavos><moneda><expiration_time><secreto_integridad>"
 *   (sin expiration_time si no se usa). El widget la recibe en
 *   data-signature:integrity y rechaza el pago si alguien cambió el monto o la
 *   referencia en el navegador, o si pasó la fecha de expiración.
 * - Widget: https://checkout.wompi.co/widget.js · Web Checkout: https://checkout.wompi.co/p/
 * - API: sandbox https://sandbox.wompi.co/v1 · producción https://production.wompi.co/v1
 *
 * El secreto de integridad NUNCA sale del servidor: solo viaja su firma.
 */

const MONEDA = 'COP';
const API_PERMITIDAS = ['https://sandbox.wompi.co/v1', 'https://production.wompi.co/v1'];

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

/** Firma de integridad documentada por Wompi. */
function firmaIntegridad({
  referencia, montoCentavos, moneda, expiracion, secreto,
}) {
  return sha256(`${referencia}${montoCentavos}${moneda}${expiracion || ''}${secreto}`);
}

function crearPasarelaWompi({
  llavePublica, secretoIntegridad, apiUrl,
}) {
  if (!llavePublica || !secretoIntegridad) throw new Error('Wompi requiere llave pública y secreto de integridad');

  return {
    nombre: 'wompi',
    moneda: MONEDA,
    apiUrl,

    /** @returns {import('./PasarelaPago').IntencionPago} */
    crearIntencion({
      referencia, montoCentavos, moneda = MONEDA, expiraEn,
    }) {
      if (!Number.isSafeInteger(montoCentavos) || montoCentavos <= 0) throw new RangeError('montoCentavos inválido');
      if (moneda !== MONEDA) throw new RangeError(`Wompi opera en ${MONEDA}`);
      const expiracion = expiraEn.toISOString();
      return {
        referencia,
        monto_en_centavos: montoCentavos,
        moneda,
        llave_publica: llavePublica,
        firma_integridad: firmaIntegridad({
          referencia, montoCentavos, moneda, expiracion, secreto: secretoIntegridad,
        }),
        expira_en: expiracion,
      };
    },
  };
}

module.exports = {
  crearPasarelaWompi, firmaIntegridad, sha256, MONEDA, API_PERMITIDAS,
};
