const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');
const claveBcrypt = require('../src/utils/clave-bcrypt');

// La clave MÁXIMA: bcrypt solo usa los primeros 72 BYTES de una contraseña y
// descarta el resto en silencio. Toda clave que se fija o cambia y pasa por
// bcrypt.hash se rechaza si pasa de 72 bytes en UTF-8 (no caracteres: una ñ o
// una tilde son 2 bytes, un emoji 4). El LOGIN no lleva tope: una clave larga
// creada antes tiene que poder seguir entrando.

const bytes = (s) => Buffer.byteLength(s, 'utf8');

/** Ejemplos alrededor del límite, comprobados por su tamaño. */
const CLAVES = {
  exacta72: 'a'.repeat(72),
  pasa73: 'a'.repeat(73),
  enies25: 'ñ'.repeat(25), // 50 bytes
  enies37: 'ñ'.repeat(37), // 74 bytes
  // 68 bytes de letras + un emoji de 4 bytes = 72: entra.
  emojiJusto: `${'a'.repeat(68)}🍔`,
  // 69 + 4 = 73: el emoji es el que cruza el límite, con solo 70 "caracteres".
  emojiCruza: `${'a'.repeat(69)}🍔`,
};

test('las claves de ejemplo miden lo que dicen', () => {
  assert.strictEqual(bytes(CLAVES.exacta72), 72);
  assert.strictEqual(bytes(CLAVES.pasa73), 73);
  assert.strictEqual(bytes(CLAVES.enies25), 50);
  assert.strictEqual(CLAVES.enies37.length, 37, '37 caracteres...');
  assert.strictEqual(bytes(CLAVES.enies37), 74, '...pero 74 bytes');
  assert.strictEqual(bytes(CLAVES.emojiJusto), 72);
  assert.strictEqual(bytes(CLAVES.emojiCruza), 73);
  assert.ok(CLAVES.emojiCruza.length < 72, 'en caracteres no llega a 72');
});

test('claveCabeEnBcrypt cuenta BYTES, no caracteres', () => {
  const { claveCabeEnBcrypt } = claveBcrypt;
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.exacta72), true);
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.pasa73), false);
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.enies25), true);
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.enies37), false);
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.emojiJusto), true);
  assert.strictEqual(claveCabeEnBcrypt(CLAVES.emojiCruza), false);
  assert.strictEqual(claveBcrypt.BYTES_MAXIMOS_CLAVE, 72);
});

test('por qué hace falta: bcrypt ignora lo que pasa del byte 72', async () => {
  const hash = await bcrypt.hash(`${'a'.repeat(72)}LO-QUE-SEA`, 4);
  assert.strictEqual(await bcrypt.compare(`${'a'.repeat(72)}OTRA-COSA`, hash), true, 'el sufijo no cuenta');
});

// ---------------------------------------------------------------------------
// POST /api/auth/register (solo admin)
// ---------------------------------------------------------------------------

function fakeRegistro() {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT * FROM usuarios WHERE email')) return { rows: [] };
    if (sql.includes('INSERT INTO usuarios')) {
      return { rows: [{ id_usuario: 77, nombre: params[0], email: params[1], rol: params[3], activo: true }] };
    }
    return undefined;
  });
}

const registrar = (password) => request(app)
  .post('/api/auth/register')
  .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
  .send({ nombre: 'Ana Ríos', email: 'ana.clave@mail.com', password, rol: 'mesero' });

for (const [caso, clave, esperado] of [
  ['72 bytes exactos', CLAVES.exacta72, 201],
  ['73 bytes', CLAVES.pasa73, 400],
  ['25 ñ (50 bytes)', CLAVES.enies25, 201],
  ['37 ñ (74 bytes)', CLAVES.enies37, 400],
  ['68 + un emoji = 72 bytes', CLAVES.emojiJusto, 201],
  ['69 + un emoji = 73 bytes', CLAVES.emojiCruza, 400],
]) {
  test(`register: ${caso} -> ${esperado}`, async () => {
    const db = fakeRegistro();
    try {
      const res = await registrar(clave);
      assert.strictEqual(res.status, esperado);
      if (esperado === 400) {
        assert.strictEqual(res.body.error, claveBcrypt.MENSAJE_CLAVE_DEMASIADO_LARGA);
        assert.strictEqual(res.body.motivo, claveBcrypt.MOTIVO_CLAVE_DEMASIADO_LARGA);
        assert.strictEqual(db.todas('INSERT INTO usuarios').length, 0, 'no se guarda nada');
      } else {
        assert.ok(db.buscar('INSERT INTO usuarios'));
      }
    } finally {
      db.restaurar();
    }
  });
}

test('register: los demás 400 de validación siguen siendo { error }, sin motivo', async () => {
  const db = fakeRegistro();
  try {
    const res = await registrar('123'); // por debajo del mínimo de 6
    assert.strictEqual(res.status, 400);
    assert.strictEqual(typeof res.body.error, 'string');
    assert.strictEqual(res.body.motivo, undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/usuarios/:id/clave (solo admin)
// ---------------------------------------------------------------------------

function fakeCambioClave() {
  return instalarFakeDb((sql) => {
    if (sql.includes('UPDATE usuarios') && sql.includes('password_hash')) {
      return { rows: [{ id_usuario: 7, nombre: 'Beto', email: 'beto@mail.com', rol: 'mesero', activo: true }] };
    }
    return undefined;
  });
}

const cambiar = (password) => request(app)
  .post('/api/usuarios/7/clave')
  .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
  .send({ password });

for (const [caso, clave, esperado] of [
  ['72 bytes exactos', CLAVES.exacta72, 200],
  ['73 bytes', CLAVES.pasa73, 400],
  ['25 ñ (50 bytes)', CLAVES.enies25, 200],
  ['37 ñ (74 bytes)', CLAVES.enies37, 400],
  ['69 + un emoji = 73 bytes', CLAVES.emojiCruza, 400],
]) {
  test(`cambio de clave: ${caso} -> ${esperado}`, async () => {
    const db = fakeCambioClave();
    try {
      const res = await cambiar(clave);
      assert.strictEqual(res.status, esperado);
      if (esperado === 400) {
        assert.strictEqual(res.body.error, claveBcrypt.MENSAJE_CLAVE_DEMASIADO_LARGA);
        assert.strictEqual(res.body.motivo, claveBcrypt.MOTIVO_CLAVE_DEMASIADO_LARGA);
      }
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// LOGIN: sin tope
// ---------------------------------------------------------------------------

test('login: una clave de más de 72 bytes creada antes del tope sigue entrando', async () => {
  const larga = `${'ñ'.repeat(40)}-clave-de-antes`; // 95 bytes
  assert.ok(bytes(larga) > 72);
  const hash = await bcrypt.hash(larga, 4);
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM usuarios WHERE email')) {
      return { rows: [{ id_usuario: 9, nombre: 'Vieja', email: 'vieja@mail.com', rol: 'cajero', activo: true, password_hash: hash }] };
    }
    return undefined;
  });
  try {
    const res = await request(app).post('/api/auth/login').send({ email: 'vieja@mail.com', password: larga });
    assert.strictEqual(res.status, 200, 'el login no aplica el tope');
    assert.ok(res.body.token);
    assert.strictEqual(res.body.usuario.email, 'vieja@mail.com');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El MÍNIMO: 8 caracteres en las dos rutas que fijan una clave (decidido con
// Jarrison; el panel ya exige 8). El login NO lo aplica.
// ---------------------------------------------------------------------------

test('mínimo: una sola constante para el registro y el cambio de clave', () => {
  assert.strictEqual(claveBcrypt.CARACTERES_MINIMOS_CLAVE, 8);
  assert.match(claveBcrypt.MENSAJE_CLAVE_CORTA, /al menos 8 caracteres/);
});

for (const [caso, clave, esperado] of [
  ['7 caracteres', '1234567', 400],
  ['8 caracteres', '12345678', 201],
  ['6 (el mínimo de antes)', '123456', 400],
  ['8 caracteres con tildes (más bytes, mismos caracteres)', 'ñandúñañ', 201],
]) {
  test(`register: mínimo, ${caso} -> ${esperado}`, async () => {
    const db = fakeRegistro();
    try {
      const res = await registrar(clave);
      assert.strictEqual(res.status, esperado);
      if (esperado === 400) {
        assert.strictEqual(res.body.error, claveBcrypt.MENSAJE_CLAVE_CORTA);
        assert.strictEqual(res.body.motivo, undefined, 'el 400 de siempre: { error } sin motivo');
        assert.strictEqual(db.todas('INSERT INTO usuarios').length, 0);
      }
    } finally {
      db.restaurar();
    }
  });
}

for (const [caso, clave, esperado] of [
  ['7 caracteres', '1234567', 400],
  ['8 caracteres', '12345678', 200],
]) {
  test(`cambio de clave: mínimo, ${caso} -> ${esperado}`, async () => {
    const db = fakeCambioClave();
    try {
      const res = await cambiar(clave);
      assert.strictEqual(res.status, esperado);
      if (esperado === 400) assert.strictEqual(res.body.error, claveBcrypt.MENSAJE_CLAVE_CORTA);
    } finally {
      db.restaurar();
    }
  });
}

test('login: una clave de 6 caracteres creada antes del mínimo de 8 sigue entrando', async () => {
  const corta = 'abc123';
  const hash = await bcrypt.hash(corta, 4);
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM usuarios WHERE email')) {
      return { rows: [{ id_usuario: 9, nombre: 'Antigua', email: 'antigua@mail.com', rol: 'mesero', activo: true, password_hash: hash }] };
    }
    return undefined;
  });
  try {
    const res = await request(app).post('/api/auth/login').send({ email: 'antigua@mail.com', password: corta });
    assert.strictEqual(res.status, 200, 'el login no aplica el mínimo de las claves nuevas');
    assert.ok(res.body.token);
  } finally {
    db.restaurar();
  }
});
