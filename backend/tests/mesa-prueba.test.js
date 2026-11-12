const test = require('node:test');
const assert = require('node:assert');
const { RANGOS, numerosDeMesa } = require('./helpers/mesa-prueba');

/**
 * El helper de números de mesa de las suites de integración (#165). Sin base:
 * aquí solo se comprueba el reparto de rangos y cuándo reintenta.
 */

function errorPg(code, constraint) {
  const err = new Error(`error ${code}`);
  err.code = code;
  err.constraint = constraint;
  return err;
}

// Los números fijos de las otras suites (pedidos-sql, transacciones-del-dia-sql,
// transacciones-mesa-sql, mesas-rotacion-sql) viven en 901-959.
const FIJOS = { desde: 901, hasta: 959 };

test('los rangos de las suites no se pisan entre sí ni con los números fijos', () => {
  const rangos = [...Object.values(RANGOS), FIJOS];
  for (const [i, a] of rangos.entries()) {
    assert.ok(a.desde <= a.hasta);
    for (const b of rangos.slice(i + 1)) {
      assert.ok(a.hasta < b.desde || b.hasta < a.desde, `${JSON.stringify(a)} pisa ${JSON.stringify(b)}`);
    }
  }
});

test('reparte números del rango de la suite, sin repetir', async () => {
  const conNumero = numerosDeMesa('deadlock-pago-estado');
  const { desde, hasta } = RANGOS['deadlock-pago-estado'];
  const vistos = [];
  for (let i = 0; i < 25; i++) vistos.push(await conNumero(async (n) => n));
  for (const n of vistos) assert.ok(n >= desde && n <= hasta, `${n} fuera de ${desde}-${hasta}`);
  assert.strictEqual(new Set(vistos).size, vistos.length);
});

test('ante un 23505 de mesas_numero_key reintenta con otro número', async () => {
  const conNumero = numerosDeMesa('cierre-pedido-pago');
  const probados = [];
  const r = await conNumero(async (n) => {
    probados.push(n);
    if (probados.length < 3) throw errorPg('23505', 'mesas_numero_key');
    return 'creada';
  });
  assert.strictEqual(r, 'creada');
  assert.strictEqual(probados.length, 3);
  assert.strictEqual(new Set(probados).size, 3);
});

test('cualquier otro error sube sin reintentar (otro 23505 incluido)', async () => {
  for (const err of [errorPg('23505', 'mesas_token_qr_key'), errorPg('23514', 'mesas_numero_check'), new Error('caída')]) {
    let llamadas = 0;
    const conNumero = numerosDeMesa('pagos-concurrentes');
    await assert.rejects(conNumero(async () => { llamadas++; throw err; }), (e) => e === err);
    assert.strictEqual(llamadas, 1);
  }
});

test('el reintento tiene tope: no da vueltas para siempre', async () => {
  const conNumero = numerosDeMesa('mesas-sql');
  let llamadas = 0;
  await assert.rejects(
    conNumero(async () => { llamadas++; throw errorPg('23505', 'mesas_numero_key'); }),
    (e) => e.constraint === 'mesas_numero_key'
  );
  assert.strictEqual(llamadas, 20);
});

test('una suite sin rango no se inventa uno', () => {
  assert.throws(() => numerosDeMesa('suite-nueva'), /sin rango de mesas/);
});
