const test = require('node:test');
const assert = require('node:assert');
const { levantar } = require('./helpers');
const { WOMPI_ENV, backendFalso } = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');
const { verificarEventoWompi } = require('../src/pasarelas/wompi');

const SECRETO = WOMPI_ENV.WOMPI_EVENTS_SECRET;
const crudo = (e) => Buffer.from(JSON.stringify(e));

async function escenario(t) {
  const s = await levantar(WOMPI_ENV, { backend: backendFalso() });
  t.after(() => s.cerrar());
  const enviar = (cuerpo, cabeceras = {}) => fetch(`${s.url}/pagos/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
  return { s, enviar };
}

test('checksum: concatena las propiedades EN EL ORDEN RECIBIDO + timestamp + secreto', () => {
  const ev = eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x', propiedades: ['transaction.amount_in_cents', 'transaction.id', 'transaction.status'] });
  const r = verificarEventoWompi(crudo(ev), {}, { secretoEventos: SECRETO });
  assert.strictEqual(r.valido, true);
  assert.deepStrictEqual(r.evento, {
    tipo: 'transaction.updated', id_transaccion: ev.data.transaction.id, referencia: 'SD-5-1-x', estado: 'APPROVED', monto_centavos: 3_333_300, moneda: 'COP',
  });
});

test('checksum inválido, secreto ajeno, cuerpo alterado o cabecera que contradice → rechazado', () => {
  const ev = eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x' });
  const ver = (e, cab = {}) => verificarEventoWompi(crudo(e), cab, { secretoEventos: SECRETO });
  assert.strictEqual(ver(eventoWompi({ secreto: 'test_events_otro', referencia: 'SD-5-1-x' })).motivo, 'checksum');
  const alterado = JSON.parse(JSON.stringify(ev));
  alterado.data.transaction.amount_in_cents = 1;
  assert.strictEqual(ver(alterado).motivo, 'checksum');
  assert.strictEqual(ver(ev, { 'x-event-checksum': 'a'.repeat(64) }).motivo, 'checksum_cabecera');
  assert.strictEqual(ver(ev, { 'x-event-checksum': ev.signature.checksum.toUpperCase() }).valido, true);
});

test('formato: sin firma, propiedades raras o JSON roto → rechazado', () => {
  const base = eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x' });
  const ver = (e) => verificarEventoWompi(Buffer.isBuffer(e) ? e : crudo(e), {}, { secretoEventos: SECRETO }).motivo;
  assert.strictEqual(ver(Buffer.from('{no json')), 'json');
  assert.strictEqual(ver({ ...base, signature: undefined }), 'formato_firma');
  assert.strictEqual(ver({ ...base, signature: { ...base.signature, properties: ['transaction.__proto__.x'] } }), 'propiedad');
  assert.strictEqual(ver({ ...base, signature: { ...base.signature, properties: ['transaction.no_existe'] } }), 'propiedad');
  assert.strictEqual(ver({ ...base, timestamp: '1' }), 'timestamp');
});

test('timestamp: se aceptan reintentos de hasta 25 h; más viejo o en el futuro, no', () => {
  const ahora = Date.now();
  const hace = (seg) => eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x', timestamp: Math.floor(ahora / 1000) - seg });
  const ver = (e) => verificarEventoWompi(crudo(e), {}, { secretoEventos: SECRETO, ahora: () => ahora });
  assert.strictEqual(ver(hace(24 * 3600)).valido, true, 'reintento de Wompi a las 24 h');
  assert.strictEqual(ver(hace(26 * 3600)).motivo, 'timestamp');
  assert.strictEqual(ver(hace(-10 * 60)).motivo, 'timestamp');
});

test('webhook: firma inválida → 400 genérico; otros eventos → 200 ignorado; duplicado → 200 sin efectos', async (t) => {
  const { enviar } = await escenario(t);
  const malo = await enviar(eventoWompi({ secreto: 'test_events_otro', referencia: 'SD-5-1-x' }));
  assert.deepStrictEqual([malo.status, (await malo.json()).codigo], [400, 'FIRMA_INVALIDA']);
  const otro = await enviar(eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x', tipo: 'nequi_token.updated' }));
  assert.deepStrictEqual(await otro.json(), { ok: true, ignorado: true });
  const ev = eventoWompi({ secreto: SECRETO, referencia: 'SD-5-1-x' });
  await enviar(ev);
  assert.strictEqual((await (await enviar(ev)).json()).duplicado, true);
});

test('webhook sin pagos configurados → 503', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  const r = await fetch(`${s.url}/pagos/webhook`, { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 503);
});
