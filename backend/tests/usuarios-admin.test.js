const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const usuariosService = require('../src/services/usuarios.service');

// D-16 parte A: administracion de usuarios del personal (solo admin).
//
// Lo que se vigila aqui:
//   - el hash de la clave NO sale en ninguna respuesta;
//   - tiene que quedar siempre al menos un admin activo, y un admin no puede
//     desactivarse ni cambiarse el rol a si mismo (las dos formas de quedarse
//     fuera del propio panel sin poder deshacerlo);
//   - la clave nueva se guarda con el MISMO bcrypt que el registro;
//   - al desactivar, cambiar el rol o cambiar la clave se invalida la cache de
//     usuario-activo, o el cambio tardaria hasta un minuto en surtir efecto.

const ADMIN = 1;
const OTRO = 7;

const tokenAdmin = () => tokenStaff(ADMIN, 'admin');

/**
 * Fila de usuarios como la devuelve el SELECT con alias (sin password_hash).
 */
function fila(extra = {}) {
  return {
    id_usuario: OTRO,
    nombre: 'Ana Rios',
    email: 'ana@mail.com',
    rol: 'mesero',
    activo: true,
    creado_en: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/**
 * Doble de base para estas rutas.
 *
 * @param {{usuario?: object|null, admins?: number}} opciones
 *        `usuario`: la fila que devuelve el SELECT ... FOR UPDATE (null = 404).
 *        `admins`: cuantos OTROS admins activos hay (para la regla del ultimo).
 */
function fakeUsuarios({ usuario = fila(), admins = 1, lista = null } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM usuarios u ORDER BY')) {
      return { rows: lista || [fila({ id_usuario: ADMIN, rol: 'admin' }), fila()] };
    }
    if (sql.includes('FOR UPDATE')) {
      return { rows: usuario ? [usuario] : [] };
    }
    if (sql.includes('count(*)::int AS admins')) {
      return { rows: [{ admins }] };
    }
    if (sql.includes('UPDATE usuarios')) {
      // RETURNING: la fila ya con los cambios aplicados, como haria la base.
      return {
        rows: [
          fila({
            ...usuario,
            nombre: params[1] ?? usuario.nombre,
            rol: params[2] ?? usuario.rol,
            activo: params[3] ?? usuario.activo,
          }),
        ],
      };
    }
    return undefined;
  });
}

/** Doble para el cambio de clave: un UPDATE con RETURNING y nada mas. */
function fakeClave({ existe = true } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('UPDATE usuarios SET password_hash')) {
      return { rows: existe ? [fila()] : [] };
    }
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// GET /api/usuarios
// ---------------------------------------------------------------------------

test('d-16: GET /usuarios lista el personal', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app).get('/api/usuarios').set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.usuarios));
    assert.strictEqual(res.body.usuarios.length, 2);
  } finally {
    db.restaurar();
  }
});

test('d-16: la lista NUNCA trae el hash de la clave', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app).get('/api/usuarios').set('Authorization', `Bearer ${tokenAdmin()}`);

    for (const usuario of res.body.usuarios) {
      assert.strictEqual(usuario.password_hash, undefined, 'el hash no sale de la API');
      assert.strictEqual(usuario.password, undefined);
    }
    // Y la query tampoco lo pide: un SELECT * publicaria cualquier columna
    // sensible que se agregue a la tabla en el futuro.
    const consulta = db.buscar('FROM usuarios u ORDER BY');
    assert.ok(consulta, 'se consulto la lista');
    assert.ok(!consulta.sql.includes('password_hash'), 'la query no pide el hash');
    assert.ok(!consulta.sql.includes('SELECT *'), 'no se usa SELECT *');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/usuarios/:id — validacion
// ---------------------------------------------------------------------------

test('d-16: un cuerpo vacio es 400, no una edicion que no cambia nada', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({});

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /al menos un campo/i);
  } finally {
    db.restaurar();
  }
});

test('d-16: una clave de mas en el cuerpo es 400 (strict)', async () => {
  const db = fakeUsuarios();
  try {
    // El email no se edita por aqui: es la credencial de entrada. Colarlo
    // seria dar de alta otra identidad, y el COALESCE lo ignoraria en silencio.
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nombre: 'Ana', email: 'otra@mail.com' });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

test('d-16: un rol que no existe es 400', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'comensal' });

    assert.strictEqual(res.status, 400, 'comensal no es una fila de usuarios');
  } finally {
    db.restaurar();
  }
});

test('d-16: un id que no es entero positivo es 400', async () => {
  const db = fakeUsuarios();
  try {
    for (const malo of ['abc', '0', '-3', '1.5']) {
      const res = await request(app)
        .patch(`/api/usuarios/${malo}`)
        .set('Authorization', `Bearer ${tokenAdmin()}`)
        .send({ nombre: 'Ana Rios' });
      assert.strictEqual(res.status, 400, `id ${malo}`);
    }
  } finally {
    db.restaurar();
  }
});

test('d-16: un usuario que no existe es 404', async () => {
  const db = fakeUsuarios({ usuario: null });
  try {
    const res = await request(app)
      .patch('/api/usuarios/999')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nombre: 'Nadie Nadie' });

    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /no encontrado/i);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/usuarios/:id — camino feliz
// ---------------------------------------------------------------------------

test('d-16: cambia el nombre y devuelve la fila sin el hash', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nombre: 'Ana Maria Rios' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.usuario.nombre, 'Ana Maria Rios');
    assert.strictEqual(res.body.usuario.password_hash, undefined);
  } finally {
    db.restaurar();
  }
});

test('d-16: lo que no se manda no se toca', async () => {
  const db = fakeUsuarios();
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    const update = db.buscar('UPDATE usuarios');
    // $2 nombre y $3 rol van en null: el COALESCE deja el valor de la base.
    assert.strictEqual(update.params[1], null, 'el nombre no se reescribe');
    assert.strictEqual(update.params[2], null, 'el rol no se reescribe');
    assert.strictEqual(update.params[3], false);
  } finally {
    db.restaurar();
  }
});

test('d-16: ascender a otro usuario a admin funciona', async () => {
  const db = fakeUsuarios();
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'admin' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.usuario.rol, 'admin');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reglas de negocio: siempre un admin activo
// ---------------------------------------------------------------------------

test('d-16: desactivar al ULTIMO admin activo es 409', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin', activo: true }),
    admins: 0, // no queda ningun otro admin activo
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, usuariosService.MENSAJE_ULTIMO_ADMIN);
    assert.ok(!db.buscar('UPDATE usuarios'), 'no se llego a escribir nada');
  } finally {
    db.restaurar();
  }
});

test('d-16: quitarle el rol admin al ULTIMO admin activo es 409', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin', activo: true }),
    admins: 0,
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'cajero' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, usuariosService.MENSAJE_ULTIMO_ADMIN);
  } finally {
    db.restaurar();
  }
});

test('d-16: desactivar a un admin cuando queda otro activo SI se puede', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin', activo: true }),
    admins: 2,
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16: la regla del ultimo admin NO estorba a los demas roles', async () => {
  const db = fakeUsuarios({ usuario: fila({ rol: 'cocina' }), admins: 0 });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.strictEqual(res.status, 200, 'desactivar a cocina no deja sin admins');
    assert.ok(!db.buscar('count(*)::int AS admins'), 'ni se pregunta por los admins');
  } finally {
    db.restaurar();
  }
});

test('d-16: reactivar o reponer el rol nunca se bloquea por la regla', async () => {
  const db = fakeUsuarios({ usuario: fila({ rol: 'admin', activo: false }), admins: 0 });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: true });

    assert.strictEqual(res.status, 200, 'activar a un admin AGREGA admins, no los quita');
  } finally {
    db.restaurar();
  }
});

test('d-16: el conteo de admins excluye al propio usuario', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin', activo: true }),
    admins: 1,
  });
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    const conteo = db.buscar('count(*)::int AS admins');
    assert.ok(conteo, 'se conto los admins');
    assert.ok(conteo.sql.includes('id_usuario <> $1'), 'el propio usuario queda fuera del conteo');
    assert.deepStrictEqual(conteo.params, [OTRO]);
  } finally {
    db.restaurar();
  }
});

test('d-16: la comprobacion va con la fila BLOQUEADA, no suelta', async () => {
  // Sin FOR UPDATE, dos admins desactivandose a la vez se verian el uno al otro
  // como activos, pasarian los dos y el sistema se quedaria sin ningun admin.
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin' }),
    admins: 1,
  });
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.ok(db.buscar('FOR UPDATE'), 'la fila se bloquea');
    assert.ok(db.buscar('BEGIN'), 'y todo va en una transaccion');
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reglas de negocio: nadie se dispara en el pie
// ---------------------------------------------------------------------------

test('d-16: un admin NO puede desactivarse a si mismo (409)', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: ADMIN, rol: 'admin', activo: true }),
    admins: 5, // aunque sobren admins: el problema es quedarse fuera uno mismo
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${ADMIN}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, usuariosService.MENSAJE_A_SI_MISMO);
    assert.ok(!db.buscar('UPDATE usuarios'));
  } finally {
    db.restaurar();
  }
});

test('d-16: un admin NO puede cambiarse el rol a si mismo (409)', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: ADMIN, rol: 'admin', activo: true }),
    admins: 5,
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${ADMIN}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'mesero' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, usuariosService.MENSAJE_A_SI_MISMO);
  } finally {
    db.restaurar();
  }
});

test('d-16: pero SI puede cambiarse el nombre a si mismo', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: ADMIN, rol: 'admin', activo: true }),
    admins: 1,
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${ADMIN}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nombre: 'Carlos Ospino' });

    assert.strictEqual(res.status, 200, 'editarse el nombre no deja a nadie fuera');
  } finally {
    db.restaurar();
  }
});

test('d-16: reafirmar el rol que ya se tiene no cuenta como cambio', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: ADMIN, rol: 'admin', activo: true }),
    admins: 1,
  });
  try {
    // El panel reenvia el rol sin cambiarlo: no es "cambiarse el rol".
    const res = await request(app)
      .patch(`/api/usuarios/${ADMIN}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'admin', nombre: 'Carlos Ospino' });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16: otro admin SI puede desactivar a un admin distinto', async () => {
  const db = fakeUsuarios({
    usuario: fila({ id_usuario: OTRO, rol: 'admin', activo: true }),
    admins: 1,
  });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Cache de usuario-activo (H-09)
// ---------------------------------------------------------------------------

/**
 * Sustituye `olvidar` por un espia. Devuelve las llamadas y como restaurarlo.
 *
 * La cache real se salta dentro de las pruebas (ver services/usuario-activo),
 * asi que lo que se comprueba es que el controller la invalide: es lo unico
 * observable sin montar un Redis.
 */
function espiarOlvidar({ falla = false } = {}) {
  const usuarioActivo = require('../src/services/usuario-activo');
  const original = usuarioActivo.olvidar;
  const llamadas = [];
  usuarioActivo.olvidar = async (id) => {
    llamadas.push(id);
    if (falla) throw new Error('Redis no responde');
    return true;
  };
  return { llamadas, restaurar: () => { usuarioActivo.olvidar = original; } };
}

test('d-16: al desactivar se invalida la cache de usuario-activo', async () => {
  const db = fakeUsuarios({ usuario: fila({ rol: 'cocina' }) });
  const espia = espiarOlvidar();
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    // Sin esto, el token del usuario desactivado seguiria entrando hasta un
    // minuto (el TTL de la cache).
    assert.deepStrictEqual(espia.llamadas, [OTRO]);
  } finally {
    espia.restaurar();
    db.restaurar();
  }
});

test('d-16: al cambiar el rol tambien se invalida', async () => {
  const db = fakeUsuarios({ usuario: fila({ rol: 'cocina' }) });
  const espia = espiarOlvidar();
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ rol: 'cajero' });

    assert.deepStrictEqual(espia.llamadas, [OTRO]);
  } finally {
    espia.restaurar();
    db.restaurar();
  }
});

test('d-16: cambiar solo el nombre no toca la cache', async () => {
  const db = fakeUsuarios();
  const espia = espiarOlvidar();
  try {
    await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ nombre: 'Ana Maria' });

    // El middleware solo mira `activo`: borrar la llave por un nombre seria
    // tirar la cache sin ninguna razon.
    assert.deepStrictEqual(espia.llamadas, []);
  } finally {
    espia.restaurar();
    db.restaurar();
  }
});

test('d-16: si Redis no responde, el cambio NO falla', async () => {
  const db = fakeUsuarios({ usuario: fila({ rol: 'cocina' }) });
  const espia = espiarOlvidar({ falla: true });
  try {
    const res = await request(app)
      .patch(`/api/usuarios/${OTRO}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ activo: false });

    // El cambio ya esta guardado en PostgreSQL, que es quien manda: lo unico
    // que se pierde es que tarde el TTL en verse.
    assert.strictEqual(res.status, 200);
  } finally {
    espia.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/usuarios/:id/clave
// ---------------------------------------------------------------------------

test('d-16: una clave de menos de 8 caracteres es 400', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'corta12' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /8 caracteres/);
    assert.ok(!db.buscar('UPDATE usuarios SET password_hash'), 'no se guardo nada');
  } finally {
    db.restaurar();
  }
});

test('d-16: una clave de 8 caracteres justos pasa', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: '12345678' });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16: una clave de mas de 72 bytes es 400, no un truncado en silencio', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'a'.repeat(73) });

    assert.strictEqual(res.status, 400, 'bcrypt solo mira los primeros 72 bytes');
  } finally {
    db.restaurar();
  }
});

test('d-16: el tope son 72 BYTES, no 72 caracteres', async () => {
  const db = fakeClave();
  try {
    // 40 caracteres, pero 80 bytes: en UTF-8 una ñ ocupa DOS. Con un .max(72)
    // de zod (que cuenta caracteres) esta clave entraria, bcrypt la cortaria
    // por la mitad y el usuario acabaria con una contrasena que no escribio.
    const clave = 'ñ'.repeat(40);
    assert.strictEqual(clave.length, 40, '40 caracteres');
    assert.strictEqual(Buffer.byteLength(clave, 'utf8'), 80, 'pero 80 bytes');

    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: clave });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /72 bytes/);
    assert.ok(!db.buscar('UPDATE usuarios SET password_hash'), 'no se guardo nada');
  } finally {
    db.restaurar();
  }
});

test('d-16: el minimo sigue siendo 8 CARACTERES, aunque ocupen mas bytes', async () => {
  const db = fakeClave();
  try {
    // 8 caracteres y 9 bytes: el minimo se mide en caracteres, que es lo que
    // la persona escribe y cuenta. Medir el minimo en bytes premiaria a quien
    // use tildes, que no tiene ningun sentido.
    const clave = 'clavñ123';
    assert.strictEqual(clave.length, 8);
    assert.strictEqual(Buffer.byteLength(clave, 'utf8'), 9);

    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: clave });

    assert.strictEqual(res.status, 200);
    // Y se guarda tal cual: el hash tiene que reconocer la clave con la ñ.
    const guardado = db.buscar('UPDATE usuarios SET password_hash').params[1];
    assert.strictEqual(await bcrypt.compare(clave, guardado), true);
  } finally {
    db.restaurar();
  }
});

test('d-16: una clave de 72 bytes justos pasa', async () => {
  const db = fakeClave();
  try {
    // 71 caracteres ASCII + una ñ = 73 bytes, se pasa; 70 + ñ = 72, entra.
    const clave = 'a'.repeat(70) + 'ñ';
    assert.strictEqual(Buffer.byteLength(clave, 'utf8'), 72);

    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: clave });

    assert.strictEqual(res.status, 200, 'el tope es inclusivo');
  } finally {
    db.restaurar();
  }
});

test('d-16: un cuerpo con claves de mas es 400', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'clave-larga-nueva', rol: 'admin' });

    assert.strictEqual(res.status, 400, 'por aqui no se cambia el rol');
  } finally {
    db.restaurar();
  }
});

test('d-16: la clave se guarda HASHEADA, nunca en claro', async () => {
  const db = fakeClave();
  try {
    const clave = 'clave-nueva-del-cajero';
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: clave });

    assert.strictEqual(res.status, 200);

    const update = db.buscar('UPDATE usuarios SET password_hash');
    assert.ok(update, 'se guardo la clave');
    const guardado = update.params[1];
    assert.notStrictEqual(guardado, clave, 'no se guarda en claro');
    assert.match(guardado, /^\$2[aby]\$/, 'es un hash de bcrypt');
  } finally {
    db.restaurar();
  }
});

test('d-16: el hash es el MISMO que usa el registro, y el login lo reconoce', async () => {
  const db = fakeClave();
  try {
    const clave = 'clave-nueva-del-cajero';
    await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: clave });

    const guardado = db.buscar('UPDATE usuarios SET password_hash').params[1];

    // El costo es el de auth.controller (COSTO_BCRYPT = 10), el mismo con el
    // que se generaron los hashes del seed: si se cambiara aqui, las claves
    // nuevas costarian otro tiempo y el login volveria a delatar que la cuenta
    // existe (H-12).
    const { COSTO_BCRYPT } = require('../src/controllers/auth.controller');
    assert.strictEqual(bcrypt.getRounds(guardado), COSTO_BCRYPT);
    // Y lo que de verdad importa: la clave nueva abre la sesion.
    assert.strictEqual(await bcrypt.compare(clave, guardado), true);
  } finally {
    db.restaurar();
  }
});

test('d-16: la respuesta del cambio de clave no lleva la clave ni el hash', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'clave-nueva-larga' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.usuario.password_hash, undefined);
    assert.strictEqual(res.body.usuario.password, undefined);
    assert.ok(!JSON.stringify(res.body).includes('clave-nueva-larga'));
  } finally {
    db.restaurar();
  }
});

test('d-16: cambiar la clave de un usuario que no existe es 404', async () => {
  const db = fakeClave({ existe: false });
  try {
    const res = await request(app)
      .post('/api/usuarios/999/clave')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'clave-nueva-larga' });

    assert.strictEqual(res.status, 404);
  } finally {
    db.restaurar();
  }
});

test('d-16: al cambiar la clave se invalida la cache', async () => {
  const db = fakeClave();
  const espia = espiarOlvidar();
  try {
    await request(app)
      .post(`/api/usuarios/${OTRO}/clave`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'clave-nueva-larga' });

    assert.deepStrictEqual(espia.llamadas, [OTRO]);
  } finally {
    espia.restaurar();
    db.restaurar();
  }
});

test('d-16: un id invalido en el cambio de clave es 400', async () => {
  const db = fakeClave();
  try {
    const res = await request(app)
      .post('/api/usuarios/0/clave')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ password: 'clave-nueva-larga' });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Permisos (la matriz completa esta en matriz-roles.test.js)
// ---------------------------------------------------------------------------

test('d-16: sin token, las tres rutas responden 401', async () => {
  const db = fakeUsuarios();
  try {
    assert.strictEqual((await request(app).get('/api/usuarios')).status, 401);
    assert.strictEqual((await request(app).patch(`/api/usuarios/${OTRO}`).send({ nombre: 'Ana Rios' })).status, 401);
    assert.strictEqual(
      (await request(app).post(`/api/usuarios/${OTRO}/clave`).send({ password: 'clave-larga-1' })).status,
      401
    );
  } finally {
    db.restaurar();
  }
});
