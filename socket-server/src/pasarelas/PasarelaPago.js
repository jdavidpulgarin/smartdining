/**
 * Interfaz PasarelaPago: lo único que el resto del socket-server sabe de un
 * proveedor de pagos. Cambiar de Wompi a otro proveedor = escribir otra
 * implementación de estas tres funciones, sin tocar rutas, cuenta ni webhook.
 *
 * Modelo de seguridad (común a cualquier implementación):
 * - Los datos de tarjeta o cuenta NUNCA pasan por SmartDining: el comensal
 *   paga en el widget/checkout del proveedor (alcance PCI DSS mínimo, SAQ A).
 * - El monto lo calcula el servidor; el cliente solo recibe lo necesario para
 *   abrir el widget (llave pública, referencia, monto, moneda y firma).
 * - Un evento del proveedor se cree solo si su firma es válida Y la
 *   transacción, consultada aparte en su API, coincide con lo esperado.
 *
 * @typedef {object} IntencionPago
 * @property {string} referencia          Única e impredecible (la genera el servidor)
 * @property {number} monto_en_centavos   Entero > 0
 * @property {string} moneda              ISO 4217 ("COP")
 * @property {string} llave_publica       Llave PÚBLICA del comercio (la única que sale del servidor)
 * @property {string} firma_integridad    Firma que impide alterar monto o referencia en el navegador
 * @property {string} expira_en           ISO 8601 UTC; después el widget rechaza el pago
 *
 * @typedef {object} ResultadoEvento
 * @property {boolean} valido
 * @property {string} [motivo]            Por qué se rechazó (solo para logs)
 * @property {object} [evento]            Evento normalizado: { tipo, id_transaccion, referencia, estado, monto_centavos, moneda }
 *
 * @typedef {object} Transaccion
 * @property {string} id
 * @property {string} referencia
 * @property {string} estado              APPROVED | DECLINED | VOIDED | ERROR | PENDING
 * @property {number} monto_centavos
 * @property {string} moneda
 *
 * @typedef {object} PasarelaPago
 * @property {string} nombre
 * @property {(datos: { referencia: string, montoCentavos: number, moneda: string, expiraEn: Date }) => IntencionPago} crearIntencion
 *   Calcula la firma de integridad. Síncrona, sin red.
 * @property {(cuerpoCrudo: Buffer, cabeceras: object) => ResultadoEvento} verificarEvento
 *   Verifica la firma del evento sobre el cuerpo CRUDO, en tiempo constante, y
 *   la antigüedad (anti-replay). No consulta la red.
 * @property {(id: string) => Promise<Transaccion|null>} consultarTransaccion
 *   Consulta la transacción en la API del proveedor (con timeout). null si no existe.
 */

const METODOS = ['crearIntencion', 'verificarEvento', 'consultarTransaccion'];

/**
 * Comprueba al arrancar que una implementación cumple la interfaz, para que
 * un proveedor a medias falle en el inicio y no con el primer pago real.
 */
function verificarImplementacion(pasarela) {
  if (!pasarela || typeof pasarela.nombre !== 'string') throw new TypeError('La pasarela debe tener nombre');
  const faltan = METODOS.filter((m) => typeof pasarela[m] !== 'function');
  if (faltan.length) throw new TypeError(`La pasarela ${pasarela.nombre} no implementa: ${faltan.join(', ')}`);
  return pasarela;
}

module.exports = { verificarImplementacion, METODOS };
