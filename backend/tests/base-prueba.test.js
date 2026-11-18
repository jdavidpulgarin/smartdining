const test = require('node:test');
const assert = require('node:assert');
const { abrirSonda, baseConfigurada } = require('./helpers/base-prueba');

/**
 * La sonda de base de las suites de integración (#165). Sin base real: un Pool
 * de mentira decide cuántas veces falla el SELECT 1.
 */

function poolFalso(fallosAntesDeResponder, error = new Error('timeout exceeded when trying to connect')) {
  const p = { opciones: null, consultas: 0, cerrado: false };
  p.query = async () => {
    p.consultas++;
    if (p.consultas <= fallosAntesDeResponder) throw error;
    return { rows: [{ '?column?': 1 }] };
  };
  p.end = async () => { p.cerrado = true; };
  return p;
}

const CONFIGURADA = { PGDATABASE: 'una_base' };

test('sin ninguna variable PG* no hay base configurada: null, la suite salta', async () => {
  let creados = 0;
  const r = await abrirSonda({ env: {}, crearPool: () => { creados++; return poolFalso(0); } });
  assert.strictEqual(r, null);
  assert.strictEqual(creados, 0, 'ni siquiera intenta conectar');
});

test('una variable PG* vacía no cuenta como configurada', () => {
  assert.strictEqual(baseConfigurada({ PGDATABASE: '', PGHOST: '' }), false);
  for (const v of ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD']) {
    assert.strictEqual(baseConfigurada({ [v]: 'x' }), true, v);
  }
});

test('base configurada que responde: devuelve el Pool, con el timeout amplio', async () => {
  const p = poolFalso(0);
  const r = await abrirSonda({ env: CONFIGURADA, crearPool: (o) => { p.opciones = o; return p; } });
  assert.strictEqual(r, p);
  assert.strictEqual(p.opciones.connectionTimeoutMillis, 10000);
  assert.strictEqual(p.cerrado, false);
});

test('una sonda lenta que responde al tercer intento no salta la suite', async () => {
  const p = poolFalso(2);
  const r = await abrirSonda({ env: CONFIGURADA, crearPool: () => p });
  assert.strictEqual(r, p);
  assert.strictEqual(p.consultas, 3);
});

test('base configurada que no responde: FALLA con el mensaje y cierra el Pool', async () => {
  const p = poolFalso(Infinity);
  await assert.rejects(
    abrirSonda({ env: CONFIGURADA, crearPool: () => p }),
    /^Error: base configurada pero no responde: timeout exceeded when trying to connect \(3 intentos de 10000 ms\)$/
  );
  assert.strictEqual(p.consultas, 3);
  assert.strictEqual(p.cerrado, true);
});

test('un error sin message (AggregateError de un puerto cerrado) muestra su code', async () => {
  const err = new AggregateError([], '');
  err.code = 'ECONNREFUSED';
  await assert.rejects(
    abrirSonda({ env: CONFIGURADA, crearPool: () => poolFalso(Infinity, err) }),
    /base configurada pero no responde: ECONNREFUSED/
  );
});
