// Fabrica eventos de Wompi firmados como lo hace Wompi (docs.wompi.co/eventos),
// con el secreto de eventos de prueba.
const crypto = require('node:crypto');

function eventoWompi({
  secreto, id = `1234-${Date.now()}-${crypto.randomInt(1e5)}`, referencia, estado = 'APPROVED', monto = 3_333_300,
  moneda = 'COP', tipo = 'transaction.updated', timestamp = Math.floor(Date.now() / 1000),
  propiedades = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
}) {
  const data = {
    transaction: {
      id, amount_in_cents: monto, reference: referencia, customer_email: 'x@example.com', currency: moneda,
      payment_method_type: 'CARD', redirect_url: 'https://app.example/seguimiento', status: estado,
      shipping_address: null, payment_link_id: null, payment_source_id: null,
    },
  };
  const valores = propiedades.map((r) => r.split('.').reduce((o, k) => o[k], data)).join('');
  const checksum = crypto.createHash('sha256').update(`${valores}${timestamp}${secreto}`).digest('hex');
  return {
    event: tipo, data, environment: 'test', signature: { properties: propiedades, checksum }, timestamp, sent_at: new Date().toISOString(),
  };
}

module.exports = { eventoWompi };
