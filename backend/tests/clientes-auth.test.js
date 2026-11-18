const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { instalarFakeClientes, crearEstado } = require('./helpers/fake-clientes');
const { hashDeRefresh } = require('../src/utils/refresh-token');
const { COSTO_BCRYPT } = require('../src/controllers/auth.controller');
const app = require('../server');

// D-19 parte B: registro, login y logout de clientes (solo /api/v1). El
// refresh, con todas sus ramas y la gracia, está en clientes-refresh.test.js.

const BASE = '/api/v1/auth/clientes';
const CLAVE = 'una-clave-buena';
const NOMBRE = 'Ana Ríos';

const registrar = (cuerpo) => request(app).post(`${BASE}/registro`).send(cuerpo);
const entrar = (cuerpo) => request(app).post(`${BASE}/login`).send(cuerpo);
const salir = (cuerpo) => request(app).post(`${BASE}/logout`).send(cuerpo);

/** Corre `fn` con el doble de base puesto y lo quita siempre. */
async function conFake(fn, opciones) {
  const fake = instalarFakeClientes(opciones);
  try {
    return await fn(fake);
  } finally {
    fake.restaurar();
  }
}

const CLAVES_SESION = ['cliente', 'expira_en', 'refresh_token', 'token'];
const CLAVES_CLIENTE = ['email', 'id_cliente', 'nombre', 'telefono', 'verificado'];

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

test('registro: 201 con { cliente, token, refresh_token, expira_en }, sin hash, email normalizado', () =>
  conFake(async ({ estado }) => {
    const res = await registrar({ nombre: `  ${NOMBRE} `, email: '  Ana.Rios@Mail.COM ', password: CLAVE, telefono: '+573001234567' });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.deepStrictEqual(Object.keys(res.body).sort(), CLAVES_SESION);
    assert.deepStrictEqual(Object.keys(res.body.cliente).sort(), CLAVES_CLIENTE);
    assert.deepStrictEqual(res.body.cliente, {
      id_cliente: 1,
      nombre: NOMBRE,
      email: 'ana.rios@mail.com',
      telefono: '+573001234567',
      verificado: false,
    });
    assert.ok(!JSON.stringify(res.body).includes('password'), 'nunca el hash');

    // En la base: el email normalizado y la clave con bcrypt de costo 10.
    const guardado = estado.clientes[0];
    assert.strictEqual(guardado.email, 'ana.rios@mail.com');
    assert.match(guardado.password_hash, new RegExp(`^\\$2[aby]\\$${COSTO_BCRYPT}\\$`));
    assert.ok(await bcrypt.compare(CLAVE, guardado.password_hash));
  }));

test('registro: el refresh_token son 43 caracteres base64url y en la base solo está su SHA-256', () =>
  conFake(async ({ estado }) => {
    const res = await registrar({ nombre: NOMBRE, email: 'a@b.co', password: CLAVE });

    assert.match(res.body.refresh_token, /^[A-Za-z0-9_-]{43}$/);
    assert.strictEqual(estado.tokens.length, 1);
    assert.strictEqual(estado.tokens[0].hash, hashDeRefresh(res.body.refresh_token));
    assert.match(estado.tokens[0].hash, /^[0-9a-f]{64}$/);
    assert.ok(!estado.tokens.some((t) => Object.values(t).includes(res.body.refresh_token)), 'el valor no se guarda');
    // Vida de 30 días por omisión.
    assert.strictEqual(estado.tokens[0].expira_en - estado.tokens[0].creado_en, 30 * 24 * 3600 * 1000);
  }));

test('registro: el JWT es { rol: cliente, sub: id }, HS256, 15 min, y expira_en sale de su exp', () =>
  conFake(async () => {
    const res = await registrar({ nombre: NOMBRE, email: 'a@b.co', password: CLAVE });

    const decodificado = jwt.decode(res.body.token, { complete: true });
    assert.strictEqual(decodificado.header.alg, 'HS256');
    assert.strictEqual(decodificado.payload.rol, 'cliente');
    assert.strictEqual(decodificado.payload.sub, '1');
    assert.strictEqual(decodificado.payload.id_usuario, undefined, 'no es un token del personal');
    assert.strictEqual(decodificado.payload.exp - decodificado.payload.iat, 15 * 60);
    assert.strictEqual(res.body.expira_en, new Date(decodificado.payload.exp * 1000).toISOString());
    jwt.verify(res.body.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  }));

test('registro: JWT_CLIENTE_EXPIRES_IN cambia la vida del token (y CLIENTE_JWT_EXPIRES_IN también vale)', () =>
  conFake(async () => {
    const antes = { a: process.env.JWT_CLIENTE_EXPIRES_IN, b: process.env.CLIENTE_JWT_EXPIRES_IN };
    try {
      process.env.CLIENTE_JWT_EXPIRES_IN = '5m';
      const conAlias = await registrar({ nombre: NOMBRE, email: 'a@b.co', password: CLAVE });
      let p = jwt.decode(conAlias.body.token);
      assert.strictEqual(p.exp - p.iat, 5 * 60);

      process.env.JWT_CLIENTE_EXPIRES_IN = '1h';
      const conContrato = await registrar({ nombre: NOMBRE, email: 'c@d.co', password: CLAVE });
      p = jwt.decode(conContrato.body.token);
      assert.strictEqual(p.exp - p.iat, 3600, 'si están las dos, gana la del contrato');
    } finally {
      for (const [k, v] of [['JWT_CLIENTE_EXPIRES_IN', antes.a], ['CLIENTE_JWT_EXPIRES_IN', antes.b]]) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }));

test('registro: el mismo email (con otras mayúsculas y espacios) es 409 email_registrado', () =>
  conFake(async ({ estado }) => {
    assert.strictEqual((await registrar({ nombre: NOMBRE, email: 'ana@mail.com', password: CLAVE })).status, 201);
    const res = await registrar({ nombre: 'Otra', email: ' ANA@Mail.com ', password: CLAVE });

    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, { error: 'Ese email ya tiene una cuenta', motivo: 'email_registrado' });
    assert.strictEqual(estado.clientes.length, 1);
    assert.strictEqual(estado.tokens.length, 1, 'el segundo no dejó sesión');
  }));

test('registro: la carrera (23505 de uq_clientes_email en el INSERT) también es 409 y deshace la transacción', () =>
  conFake(
    async ({ db }) => {
      const res = await registrar({ nombre: NOMBRE, email: 'carrera@mail.com', password: CLAVE });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, 'email_registrado');
      assert.ok(db.buscar('ROLLBACK'), 'se deshizo');
      assert.strictEqual(db.buscar('INSERT INTO refresh_tokens_cliente'), undefined);
    },
    {
      extra: (sql) => {
        if (sql.includes('INSERT INTO clientes')) {
          throw Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'uq_clientes_email' });
        }
        return undefined;
      },
    }
  ));

test('registro: otro 23505 (no el del email) no se disfraza de email_registrado', () =>
  conFake(
    async () => {
      const res = await registrar({ nombre: NOMBRE, email: 'x@mail.com', password: CLAVE });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, 'conflicto', 'el genérico de las rutas de clientes');
    },
    {
      extra: (sql) => {
        if (sql.includes('INSERT INTO clientes')) {
          throw Object.assign(new Error('duplicate key value'), { code: '23505', constraint: 'otro_indice' });
        }
        return undefined;
      },
    }
  ));

const ENIE_36 = 'ñ'.repeat(36); // 72 bytes en UTF-8: justo el tope
const ENIE_37 = 'ñ'.repeat(37); // 74 bytes: se pasa, aunque son 37 caracteres

for (const [caso, cuerpo, motivo] of [
  ['sin nombre', { email: 'a@b.co', password: CLAVE }, 'nombre_invalido'],
  ['nombre vacío tras recortar', { nombre: '   ', email: 'a@b.co', password: CLAVE }, 'nombre_invalido'],
  ['nombre de 81 caracteres', { nombre: 'a'.repeat(81), email: 'a@b.co', password: CLAVE }, 'nombre_invalido'],
  ['nombre que no es texto', { nombre: 7, email: 'a@b.co', password: CLAVE }, 'nombre_invalido'],
  ['email sin @', { nombre: NOMBRE, email: 'ana.mail.com', password: CLAVE }, 'email_invalido'],
  ['email sin punto en el dominio', { nombre: NOMBRE, email: 'ana@mail', password: CLAVE }, 'email_invalido'],
  ['email con un espacio en medio', { nombre: NOMBRE, email: 'an a@mail.com', password: CLAVE }, 'email_invalido'],
  ['email con dos @', { nombre: NOMBRE, email: 'a@b@mail.com', password: CLAVE }, 'email_invalido'],
  ['email de 255 caracteres', { nombre: NOMBRE, email: `${'a'.repeat(246)}@mail.com`, password: CLAVE }, 'email_invalido'],
  ['sin email', { nombre: NOMBRE, password: CLAVE }, 'email_invalido'],
  ['clave de 7 caracteres', { nombre: NOMBRE, email: 'a@b.co', password: '1234567' }, 'clave_corta'],
  ['clave de 73 bytes ASCII', { nombre: NOMBRE, email: 'a@b.co', password: 'a'.repeat(73) }, 'clave_larga'],
  ['clave de 37 eñes (74 bytes)', { nombre: NOMBRE, email: 'a@b.co', password: ENIE_37 }, 'clave_larga'],
  ['clave que no es texto', { nombre: NOMBRE, email: 'a@b.co', password: 12345678 }, 'cuerpo_invalido'],
  ['sin clave', { nombre: NOMBRE, email: 'a@b.co' }, 'cuerpo_invalido'],
  ['teléfono con letras', { nombre: NOMBRE, email: 'a@b.co', password: CLAVE, telefono: '300abc4567' }, 'telefono_invalido'],
  ['teléfono de 6 dígitos', { nombre: NOMBRE, email: 'a@b.co', password: CLAVE, telefono: '123456' }, 'telefono_invalido'],
  ['teléfono con espacios', { nombre: NOMBRE, email: 'a@b.co', password: CLAVE, telefono: '+57 300 1234567' }, 'telefono_invalido'],
  ['un campo de más', { nombre: NOMBRE, email: 'a@b.co', password: CLAVE, rol: 'admin' }, 'cuerpo_invalido'],
  ['un arreglo', [], 'cuerpo_invalido'],
]) {
  test(`registro: ${caso} -> 400 ${motivo}`, () =>
    conFake(async ({ estado }) => {
      const res = await registrar(cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, motivo);
      assert.strictEqual(typeof res.body.error, 'string');
      assert.strictEqual(estado.clientes.length, 0);
    }));
}

test('registro: una clave de 36 eñes (72 bytes justos) sí entra, y sin teléfono o con null también', () =>
  conFake(async ({ estado }) => {
    assert.strictEqual((await registrar({ nombre: NOMBRE, email: 'a@b.co', password: ENIE_36 })).status, 201);
    assert.strictEqual(estado.clientes[0].telefono, null);
    const conNull = await registrar({ nombre: NOMBRE, email: 'c@d.co', password: CLAVE, telefono: null });
    assert.strictEqual(conNull.status, 201);
    assert.strictEqual(conNull.body.cliente.telefono, null);
  }));

test('registro: un JSON mal formado es 400 cuerpo_invalido y no repite el cuerpo', () =>
  conFake(async () => {
    const res = await request(app)
      .post(`${BASE}/registro`)
      .set('Content-Type', 'application/json')
      .send('{"email": "secreto@mail.com", ');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    assert.ok(!JSON.stringify(res.body).includes('secreto'), JSON.stringify(res.body));
  }));

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/** Registra un cliente y devuelve el estado del doble. */
async function conCliente(fn, { activo = true } = {}) {
  return conFake(async (fake) => {
    const r = await registrar({ nombre: NOMBRE, email: 'ana@mail.com', password: CLAVE });
    assert.strictEqual(r.status, 201);
    fake.estado.clientes[0].activo = activo;
    return fn(fake, r.body);
  });
}

test('login: 200 con la misma forma que el registro, email sin distinguir mayúsculas ni espacios', () =>
  conCliente(async ({ estado }) => {
    const res = await entrar({ email: '  ANA@Mail.com ', password: CLAVE });

    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(Object.keys(res.body).sort(), CLAVES_SESION);
    assert.strictEqual(res.body.cliente.email, 'ana@mail.com');
    assert.ok(!JSON.stringify(res.body).includes('password'));
    assert.strictEqual(estado.tokens.length, 2, 'el login abre otra sesión');
    assert.notStrictEqual(estado.tokens[0].familia, estado.tokens[1].familia, 'con familia NUEVA');
    assert.match(estado.tokens[1].familia, /^[0-9a-f-]{36}$/);
  }));

/** Envuelve bcrypt.compare para anotar con qué hash se llamó, sin cambiar su lógica. */
function espiarCompare() {
  const original = bcrypt.compare;
  const llamadas = [];
  bcrypt.compare = (dato, hash, ...resto) => {
    llamadas.push(hash);
    return original.call(bcrypt, dato, hash, ...resto);
  };
  return { llamadas, restaurar: () => { bcrypt.compare = original; } };
}

for (const [caso, activo, cuerpo] of [
  ['el email no existe', true, { email: 'nadie@mail.com', password: CLAVE }],
  ['la clave es incorrecta', true, { email: 'ana@mail.com', password: 'otra-clave-mala' }],
  ['el cliente está inactivo (con la clave CORRECTA)', false, { email: 'ana@mail.com', password: CLAVE }],
  ['el email está mal escrito (sin @)', true, { email: 'no-es-un-email', password: CLAVE }],
]) {
  test(`login: ${caso} -> el MISMO 401 credenciales_invalidas, pasando por bcrypt al mismo costo`, () =>
    conCliente(
      async ({ estado }) => {
        const espia = espiarCompare();
        let res;
        try {
          res = await entrar(cuerpo);
        } finally {
          espia.restaurar();
        }
        assert.strictEqual(res.status, 401);
        assert.deepStrictEqual(res.body, { error: 'Email o contraseña incorrectos', motivo: 'credenciales_invalidas' });
        assert.strictEqual(espia.llamadas.length, 1, 'se compara una vez, exista o no');
        assert.match(espia.llamadas[0], new RegExp(`^\\$2[aby]\\$${COSTO_BCRYPT}\\$`), 'mismo costo: mismo tiempo');
        assert.strictEqual(estado.tokens.length, 1, 'no se abrió sesión');
      },
      { activo }
    ));
}

for (const [caso, cuerpo] of [
  ['sin clave', { email: 'ana@mail.com' }],
  ['sin email', { password: CLAVE }],
  ['email vacío', { email: '  ', password: CLAVE }],
  ['clave vacía', { email: 'ana@mail.com', password: '' }],
  ['email que no es texto', { email: 5, password: CLAVE }],
  ['un campo de más', { email: 'ana@mail.com', password: CLAVE, recordar: true }],
  ['el campo de la app vieja (correo)', { correo: 'ana@mail.com', password: CLAVE }],
]) {
  test(`login: ${caso} -> 400 cuerpo_invalido`, () =>
    conCliente(async () => {
      const res = await entrar(cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }));
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

test('logout: 204 sin cuerpo y revoca SOLO ese token (la otra sesión del cliente sigue)', () =>
  conCliente(async ({ estado }, registro) => {
    const otraSesion = await entrar({ email: 'ana@mail.com', password: CLAVE });

    const res = await salir({ refresh_token: registro.refresh_token });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.text, '');
    const [primero, segundo] = estado.tokens;
    assert.notStrictEqual(primero.revocado_en, null, 'ese token quedó revocado');
    assert.strictEqual(segundo.revocado_en, null, 'el del otro teléfono no');
    assert.strictEqual(primero.reemplazado_por, null, 'no toca reemplazado_por');
    assert.strictEqual(primero.rotado_en, null, 'ni rotado_en');
    assert.strictEqual(
      (await request(app).post(`${BASE}/refresh`).send({ refresh_token: otraSesion.body.refresh_token })).status,
      200
    );
  }));

test('logout: no exige Authorization y la ignora si viene (aunque sea basura)', () =>
  conCliente(async ({ estado }, registro) => {
    const res = await request(app)
      .post(`${BASE}/logout`)
      .set('Authorization', 'Bearer esto-no-es-un-jwt')
      .send({ refresh_token: registro.refresh_token });
    assert.strictEqual(res.status, 204);
    assert.notStrictEqual(estado.tokens[0].revocado_en, null);
  }));

test('logout: idempotente; 204 también si el token no existe, ya estaba revocado, rotado o vencido', () =>
  conCliente(async ({ estado }, registro) => {
    // Rotado: se refresca una vez.
    const rotado = registro.refresh_token;
    const nuevo = await request(app).post(`${BASE}/refresh`).send({ refresh_token: rotado });
    assert.strictEqual(nuevo.status, 200);

    const inexistente = 'A'.repeat(43);
    for (const token of [inexistente, rotado]) {
      assert.strictEqual((await salir({ refresh_token: token })).status, 204);
    }
    // Revocado dos veces: la segunda no cambia la fecha.
    assert.strictEqual((await salir({ refresh_token: nuevo.body.refresh_token })).status, 204);
    const fecha = estado.tokens[1].revocado_en;
    estado.ahora += 1000;
    assert.strictEqual((await salir({ refresh_token: nuevo.body.refresh_token })).status, 204);
    assert.strictEqual(estado.tokens[1].revocado_en, fecha, 'revocado_en IS NULL en el WHERE');

    // Vencido.
    const otro = await entrar({ email: 'ana@mail.com', password: CLAVE });
    estado.ahora += 31 * 24 * 3600 * 1000;
    assert.strictEqual((await salir({ refresh_token: otro.body.refresh_token })).status, 204);
  }));

for (const [caso, cuerpo] of [
  ['sin refresh_token', {}],
  ['refresh_token de 42 caracteres', { refresh_token: 'A'.repeat(42) }],
  ['refresh_token de 44 caracteres', { refresh_token: 'A'.repeat(44) }],
  ['refresh_token con un carácter fuera de base64url', { refresh_token: `${'A'.repeat(42)}+` }],
  ['refresh_token que no es texto', { refresh_token: 12345 }],
  ['un campo de más', { refresh_token: 'A'.repeat(43), todos: true }],
  ['el nombre de la app vieja (refreshToken)', { refreshToken: 'A'.repeat(43) }],
]) {
  test(`logout: ${caso} -> 400 cuerpo_invalido`, () =>
    conFake(async () => {
      const res = await salir(cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }));
}

test('el estado inicial del doble es independiente entre pruebas', () => {
  assert.strictEqual(crearEstado().clientes.length, 0);
});
