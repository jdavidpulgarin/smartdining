const test = require('node:test');
const assert = require('node:assert');

const pool = require('../src/config/db');
const { enteroPositivo, LIMITES } = pool;

// H-25: los cuatro limites del pool salen de variables de entorno, pero una
// variable mal escrita no debe impedir que el backend arranque: el default
// siempre es un valor seguro.

test('un entero positivo valido se usa tal cual', () => {
  assert.strictEqual(enteroPositivo('X', 10000, { X: '3000' }), 3000);
  assert.strictEqual(enteroPositivo('X', 10000, { X: '  3000  ' }), 3000, 'con espacios');
  assert.strictEqual(enteroPositivo('X', 10, { X: '1' }), 1);
});

test('si la variable no esta o esta vacia, se usa el default', () => {
  assert.strictEqual(enteroPositivo('X', 10000, {}), 10000);
  assert.strictEqual(enteroPositivo('X', 10000, { X: '' }), 10000);
  assert.strictEqual(enteroPositivo('X', 10000, { X: '   ' }), 10000);
  assert.strictEqual(enteroPositivo('X', 10000, { X: undefined }), 10000);
});

for (const malo of [
  'abc',
  '10s',
  '1e4abc',
  'NaN',
  'Infinity',
  '-1',
  '-5000',
  '1.5',
  '0.5',
  '1,5',
  ' ',
  'null',
  // Number aceptaria estos dos (16 y 10000): el parseo solo admite digitos,
  // porque un valor de configuracion no deberia depender de esas sutilezas.
  '0x10',
  '1e4',
  '+5000',
]) {
  test(`"${malo}" es invalido: se usa el default sin lanzar`, () => {
    // No lanza nunca: un .env con una errata no debe tumbar el arranque.
    assert.doesNotThrow(() => enteroPositivo('X', 7777, { X: malo }));
    assert.strictEqual(enteroPositivo('X', 7777, { X: malo }), 7777);
  });
}

test('el 0 se descarta: en pg significa "sin limite"', () => {
  // Es justo lo que estos timeouts vienen a evitar, asi que un 0 explicito se
  // trata como invalido y no como "desactivado".
  assert.strictEqual(enteroPositivo('X', 5000, { X: '0' }), 5000);
  assert.strictEqual(enteroPositivo('X', 5000, { X: '-0' }), 5000);
});

test('los cuatro limites quedan puestos en el pool con sus defaults', () => {
  // Las pruebas corren sin .env (ver .github/scripts/npm-test-sin-canceladas.sh),
  // asi que aqui se ven los valores por defecto.
  assert.deepStrictEqual(LIMITES, {
    max: 10,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
});

test('connectionTimeoutMillis ya no es 0: una base caida falla rapido', () => {
  // El default de pg es 0, o sea esperar para siempre. Sin esto la peticion se
  // cuelga y el cliente con ella, porque Express no tiene timeout propio.
  assert.ok(LIMITES.connectionTimeoutMillis > 0);
  assert.strictEqual(pool.options.connectionTimeoutMillis, LIMITES.connectionTimeoutMillis);
});

test('hay statement_timeout: una query trabada no retiene su conexion para siempre', () => {
  // statement_timeout y no query_timeout: el segundo corta solo del lado del
  // cliente y deja la query corriendo en el servidor.
  assert.ok(LIMITES.statement_timeout > 0);
  assert.strictEqual(pool.options.statement_timeout, LIMITES.statement_timeout);
  assert.strictEqual(pool.options.query_timeout, undefined);
});

test('el pool tiene un listener de error: una conexion inactiva no tumba el proceso', () => {
  // Sin manejador, un evento 'error' en un EventEmitter mata el proceso entero,
  // y no hay ninguna peticion a la que responderle.
  assert.ok(pool.listenerCount('error') >= 1);
  assert.doesNotThrow(() => {
    const err = new Error('la conexion se cerro');
    err.code = 'ECONNRESET';
    pool.emit('error', err);
  });
});
