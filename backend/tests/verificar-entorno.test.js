const test = require('node:test');
const assert = require('node:assert');
const {
  revisarEntorno,
  exigirEntornoValido,
  VALORES_DE_EJEMPLO,
  LARGO_MINIMO,
} = require('../src/config/verificar-entorno');

const SECRETO_BUENO = 'a'.repeat(LARGO_MINIMO + 8);

test('un JWT_SECRET propio y largo pasa la revisión', () => {
  assert.deepStrictEqual(revisarEntorno({ JWT_SECRET: SECRETO_BUENO }), []);
});

for (const [caso, env] of [
  ['ausente', {}],
  ['vacía', { JWT_SECRET: '' }],
  ['solo espacios', { JWT_SECRET: '   ' }],
]) {
  test(`JWT_SECRET ${caso} es un problema de arranque`, () => {
    const problemas = revisarEntorno(env);
    assert.strictEqual(problemas.length, 1);
    assert.match(problemas[0], /JWT_SECRET no está definida/);
    assert.match(problemas[0], /\.env\.example/, 'el mensaje debe decir qué hacer');
  });
}

test('el valor de ejemplo del .env.example se rechaza', () => {
  const problemas = revisarEntorno({ JWT_SECRET: 'cambia-esto-por-un-secreto-largo-y-aleatorio' });
  assert.strictEqual(problemas.length, 1);
  assert.match(problemas[0], /valor de ejemplo/);
});

test('se rechazan todos los placeholders conocidos, con espacios alrededor', () => {
  for (const valor of VALORES_DE_EJEMPLO) {
    assert.strictEqual(revisarEntorno({ JWT_SECRET: `  ${valor}  ` }).length, 1, valor);
  }
});

test('un secreto propio pero muy corto se rechaza', () => {
  const problemas = revisarEntorno({ JWT_SECRET: 'corto' });
  assert.strictEqual(problemas.length, 1);
  assert.match(problemas[0], /demasiado corta/);
});

test('exigirEntornoValido no hace nada si la configuración está bien', () => {
  const dichos = [];
  let codigo = null;
  exigirEntornoValido({
    env: { JWT_SECRET: SECRETO_BUENO },
    log: (m) => dichos.push(m),
    salir: (c) => { codigo = c; },
  });

  assert.strictEqual(codigo, null, 'no debe cortar el arranque');
  assert.deepStrictEqual(dichos, []);
});

test('exigirEntornoValido explica el problema y sale con código 1', () => {
  const dichos = [];
  let codigo = null;
  exigirEntornoValido({
    env: {},
    log: (m) => dichos.push(m),
    salir: (c) => { codigo = c; },
  });

  assert.strictEqual(codigo, 1, 'debe salir con process.exit(1)');
  const salida = dichos.join('\n');
  assert.match(salida, /No se puede iniciar el backend/);
  assert.match(salida, /JWT_SECRET/);
});
