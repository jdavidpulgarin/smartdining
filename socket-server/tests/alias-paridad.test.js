// Paridad de la regla del alias (EVENTS.md §6.4): src/alias.js debe dar
// EXACTAMENTE lo mismo que normalizarAlias del backend. Los dos servicios
// guardan a la misma persona (la reserva del backend y sd:mesa:{ID}:sin_celular)
// y deciden por la clave quién es quién.
//
// El módulo del backend hace require('../config/redis'), que arrastra node-redis
// y dotenv de backend/node_modules, y el job del socket-server en el CI no
// instala el backend. Por eso se carga con un sustituto vacío de ese archivo en
// require.cache (la regla no lo usa) y se vigila que no haya más require.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const propia = require('../src/alias');

const RUTA_ALIAS = path.resolve(__dirname, '../../backend/src/services/alias-comensal.js');
const RUTA_REDIS = path.resolve(__dirname, '../../backend/src/config/redis.js');
const REQUIRE_CONOCIDO = '../config/redis';

function cargarAliasDelBackend() {
  for (const [ruta, que] of [[RUTA_ALIAS, 'la regla del alias'], [RUTA_REDIS, 'el cliente de Redis que ella importa']]) {
    if (!fs.existsSync(ruta)) {
      throw new Error(`Paridad del alias: no existe ${path.relative(path.resolve(__dirname, '../..'), ruta)} (${que}). `
        + 'El backend lo movió o lo renombró: actualiza RUTA_ALIAS / RUTA_REDIS en esta prueba.');
    }
  }
  const sustituto = new Module(RUTA_REDIS);
  sustituto.filename = RUTA_REDIS;
  sustituto.loaded = true;
  sustituto.exports = {};
  require.cache[RUTA_REDIS] = sustituto;

  const inesperados = [];
  const cargarOriginal = Module._load;
  Module._load = function cargar(peticion, padre, ...resto) {
    if (padre && padre.filename === RUTA_ALIAS && peticion !== REQUIRE_CONOCIDO) inesperados.push(peticion);
    return cargarOriginal.call(this, peticion, padre, ...resto);
  };
  let modulo;
  let fallo;
  try {
    delete require.cache[RUTA_ALIAS];
    modulo = require(RUTA_ALIAS);
  } catch (err) {
    fallo = err;
  } finally {
    Module._load = cargarOriginal;
    delete require.cache[RUTA_REDIS];
    delete require.cache[RUTA_ALIAS];
  }
  if (inesperados.length) {
    throw new Error(`Paridad del alias: backend/src/services/alias-comensal.js ahora importa ${inesperados.map((r) => `'${r}'`).join(', ')} `
      + `además de '${REQUIRE_CONOCIDO}'. Si la regla depende de eso, súbelo a src/alias.js; si no, agrega el sustituto en esta prueba.`);
  }
  if (fallo) throw new Error(`Paridad del alias: no se pudo cargar alias-comensal.js del backend: ${fallo.message}`);
  if (typeof modulo.normalizarAlias !== 'function') {
    throw new Error('Paridad del alias: alias-comensal.js ya no exporta normalizarAlias. Revisa con Daniel dónde quedó la regla.');
  }
  return modulo;
}

// Solo { alias, clave } o { error: true }: los mensajes de error pueden ser
// distintos (el backend habla de "comensal"), la decisión no.
const resultado = (r) => (r.error ? { error: true } : { alias: r.alias, clave: r.clave });

const CASOS = [
  // Mayúsculas, tildes y la clave
  'Abuela', 'abuela', 'ABUELA', 'Ána', 'ana', 'Ana', 'ÁNA', 'José', 'jose', 'Peña', 'pena', 'Müller', 'Ça va',
  // NFC frente a NFD (la "á" compuesta y la descompuesta)
  'Aná', 'Ána', 'José',
  // Espacios: a los lados, dobles, tabulaciones, saltos y otros espacios Unicode
  ' Abuela ', 'Ana  María', 'Ana   María  ', '\tAna\t', 'Ana\nMaría', 'Ana María', 'Ana María', '  ',
  // . _ ' - y combinaciones que dejan la clave vacía o igual a otra
  'Ana.María', 'ana_maria', "D'Angelo", 'Jean-Luc', 'Ana-María', '..', "'-", '_ _', '.a', 'a.',
  // Largos: 1, 2, 40 y 41 puntos de código (también con letras fuera del BMP)
  'A', 'Ab', 'a'.repeat(40), 'a'.repeat(41), 'ñ'.repeat(40), 'ñ'.repeat(41), '𝒜'.repeat(40), '𝒜'.repeat(41),
  // Caracteres no permitidos: emoji, signos, HTML, barras
  'Ana 😀', '😀😀', 'Ana!', 'Ana<b>', 'Ana/Beto', 'Ana\\Beto', 'Ana"', 'Ana@', 'Ana#1', 'Ana+',
  // Números y escrituras no latinas
  'Mesa 5', '12', '٣٤', 'Мария', '李华', 'محمد',
  // La clave reservada «General» (D-18c) y nombres que solo la contienen
  'General', 'general', ' GENERAL ', 'Géneral', 'Gen-eral', 'General Pérez', 'Generalísimo',
  // Tipos que no son texto
  null, undefined, 12, true, {}, ['Ana'],
];

const backend = cargarAliasDelBackend();

test('la regla del socket-server da lo mismo que la del backend en todos los casos', () => {
  for (const caso of CASOS) {
    assert.deepStrictEqual(resultado(propia.normalizarAlias(caso)), resultado(backend.normalizarAlias(caso)),
      `distinto para ${JSON.stringify(caso)}`);
  }
});

test('los límites y la clave reservada coinciden con los del backend', () => {
  assert.deepStrictEqual([propia.MIN_ALIAS, propia.MAX_ALIAS, propia.CLAVE_RESERVADA], [backend.MIN, backend.MAX, backend.CLAVE_RESERVADA]);
});

test('casos de §6.4: misma clave para Abuela/abuela y Ána/ana; General no es un alias', () => {
  const clave = (a) => propia.normalizarAlias(a).clave;
  assert.strictEqual(clave('Abuela'), clave('abuela'));
  assert.strictEqual(clave('Ána'), clave('ana'));
  assert.strictEqual(clave('Ana  María'), clave('ana-maría'));
  assert.deepStrictEqual(propia.normalizarAlias('  Ana   María '), { alias: 'Ana María', clave: 'anamaria' });
  assert.ok(propia.normalizarAlias('General').error);
  assert.ok(!propia.normalizarAlias('General Pérez').error);
});
