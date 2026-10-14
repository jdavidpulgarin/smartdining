// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
const test = require('node:test');
const assert = require('node:assert');
const {
  problemaContrasena, leerHashes, usuariosInseguros, CONOCIDAS,
} = require('./passwords-demo.cjs');

// Hash de Admin123! que está en backend/scripts/fijar-password-demo.sql y database/seed.sql.
const HASH_DEMO = '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2';
const hashFalso = (clave) => `$2b$10$${Buffer.from(clave).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(53, 'x').slice(0, 53)}`;
// Doble de bcrypt.compare: compara contra hashFalso (sin bcrypt instalado).
const comparar = async (clave, hash) => hashFalso(clave) === hash;
const usuario = (id, hash, extra = {}) => ({
  id_usuario: id, email: `u${id}@smartdining.com`, rol: 'mesero', activo: true, password_hash: hash, ...extra,
});

test('la contraseña nueva: Admin123! y sus variantes no sirven', () => {
  for (const mala of ['Admin123!', 'admin123!', 'MiAdmin123!segura', 'SmartDining2026!', 'password12345', 'cambia-esto-ya-1', '123456789012']) {
    assert.ok(problemaContrasena(mala), mala);
  }
});

test('la contraseña nueva: largo, bytes de bcrypt, espacios y repetición', () => {
  assert.match(problemaContrasena('Corta1!'), /12/);
  assert.match(problemaContrasena(undefined), /12/);
  assert.match(problemaContrasena('ñ'.repeat(40)), /72 bytes/);
  assert.match(problemaContrasena(' Tortuga-Verde-42'), /espacios/);
  assert.match(problemaContrasena('aaaaaaaaaaaaaaaa'), /repite/);
  assert.strictEqual(problemaContrasena('Tortuga-Verde-Sala-42'), null);
});

test('hashes publicados: se extraen de la salida de git grep sin repetir', () => {
  const salida = `${HASH_DEMO}\n${HASH_DEMO}\nruido $2a$12$${'b'.repeat(53)} más\n$2b$10$corto\n`;
  assert.deepStrictEqual(leerHashes(salida), [HASH_DEMO, `$2a$12$${'b'.repeat(53)}`]);
  assert.deepStrictEqual(leerHashes(''), []);
});

test('inseguro: el hash del repositorio, aunque no se sepa la contraseña', async () => {
  const r = await usuariosInseguros([usuario(1, HASH_DEMO)], { hashesPublicos: [HASH_DEMO], comparar: async () => false });
  assert.deepStrictEqual(r.map((u) => [u.id_usuario, u.motivo]), [[1, 'su hash está publicado en el repositorio']]);
});

test('inseguro: una contraseña conocida con otro hash (otra sal); seguro: una propia', async () => {
  const usuarios = [
    usuario(1, hashFalso('Admin123!')),
    usuario(2, hashFalso('Tortuga-Verde-Sala-42')),
    usuario(3, hashFalso('password'), { activo: false }),
  ];
  const r = await usuariosInseguros(usuarios, { hashesPublicos: [], comparar });
  // Los inactivos también: se pueden reactivar.
  assert.deepStrictEqual(r.map((u) => u.id_usuario), [1, 3]);
  assert.ok(CONOCIDAS.includes('Admin123!'));
});

test('un hash corrupto no tumba la verificación', async () => {
  const r = await usuariosInseguros([usuario(1, 'no-es-bcrypt'), usuario(2, hashFalso('admin'))], {
    hashesPublicos: [],
    comparar: async (clave, hash) => { if (hash === 'no-es-bcrypt') throw new Error('Invalid salt'); return comparar(clave, hash); },
  });
  assert.deepStrictEqual(r.map((u) => u.id_usuario), [2]);
});
