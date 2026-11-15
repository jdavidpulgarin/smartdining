const test = require('node:test');
const assert = require('node:assert');
const { generarCodigoPedido } = require('../src/services/pedidos.service');

// codigo_pedido = PED-AAMMDD-XXXXX con el día de BOGOTÁ (America/Bogota, UTC-5
// todo el año). Antes salía de toISOString(), el día UTC: desde las 7 p. m. de
// Colombia el pedido salía con la fecha de mañana.

const FORMA = /^PED-\d{6}-[0-9A-F]{5}$/;

/** El AAMMDD de un código. */
const dia = (codigo) => codigo.slice(4, 10);

for (const [caso, instante, esperado] of [
  ['2026-11-14 23:30 Bogotá (04:30Z del 15)', '2026-11-15T04:30:00Z', '261114'],
  ['2026-11-14 19:00 Bogotá (00:00Z del 15): el primer minuto que antes fallaba', '2026-11-15T00:00:00Z', '261114'],
  ['2026-11-14 18:59 Bogotá (23:59Z del 14)', '2026-11-14T23:59:00Z', '261114'],
  ['2026-11-14 00:10 Bogotá (05:10Z del 14): ese día', '2026-11-14T05:10:00Z', '261114'],
  ['2026-11-15 00:10 Bogotá (05:10Z del 15): el día siguiente', '2026-11-15T05:10:00Z', '261115'],
  ['2026-12-31 23:30 Bogotá (04:30Z del 1 de enero de 2027): sigue en 2026', '2027-01-01T04:30:00Z', '261231'],
]) {
  test(`codigo_pedido: ${caso} -> PED-${esperado}-…`, () => {
    const codigo = generarCodigoPedido(new Date(instante));
    assert.match(codigo, FORMA);
    assert.strictEqual(dia(codigo), esperado);
    assert.strictEqual(codigo.length, 16);
  });
}

test('codigo_pedido: siempre 16 caracteres con la forma PED-AAMMDD-XXXXX', () => {
  for (let i = 0; i < 200; i += 1) {
    const codigo = generarCodigoPedido();
    assert.strictEqual(codigo.length, 16, codigo);
    assert.match(codigo, FORMA);
  }
});

test('codigo_pedido: no depende de la zona del servidor (TZ=UTC, Asia/Tokyo, America/Bogota)', () => {
  const tzPrevia = process.env.TZ;
  const instante = new Date('2026-11-15T04:30:00Z'); // 23:30 del 14 en Bogotá
  try {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Bogota', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.strictEqual(dia(generarCodigoPedido(instante)), '261114', `TZ=${tz}`);
    }
  } finally {
    if (tzPrevia === undefined) delete process.env.TZ;
    else process.env.TZ = tzPrevia;
  }
});
