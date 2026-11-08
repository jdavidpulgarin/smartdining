const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const configuracionService = require('../src/services/configuracion.service');

// D-16 parte B: configuracion del restaurante (tabla configuracion_restaurante,
// database/scripts/26_configuracion.sql).
//
// Lo que se vigila aqui:
//   - la ruta publica devuelve SOLO la lista blanca: actualizado_en y
//     actualizado_por son auditoria y no se publican;
//   - el PUT es parcial de verdad: lo que no se manda no se reescribe;
//   - el UPDATE va en una transaccion que PRIMERO fija app.id_usuario, que es
//     de donde el trigger saca actualizado_por. Sin eso, el campo queda NULL y
//     no se sabe quien cambio la configuracion del local;
//   - los limites son los de las columnas, no inventados.

/** La fila como la devuelve la base (el parser de NUMERIC da numeros). */
const FILA = {
  id: 1,
  nombre: 'SmartDining',
  telefono: '3001234567',
  direccion: 'Calle 1 #2-3',
  url_logo: null,
  horario: { lunes: { abre: '11:00', cierra: '22:00' } },
  propina_sugerida_pct: 10,
  moneda: 'COP',
  actualizado_en: '2026-11-08T10:00:00.000Z',
  actualizado_por: 7,
};

const admin = () => tokenStaff(1, 'admin');

/** @param {{fila?: object|null}} opciones */
function fakeDb({ fila = FILA } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM configuracion_restaurante')) return { rows: fila ? [fila] : [] };
    if (sql.includes('UPDATE configuracion_restaurante')) {
      if (!fila) return { rows: [] };
      // RETURNING: la fila con los cambios, como haria la base. Los valores
      // empiezan en $2 ($1 es el id).
      const columnas = (sql.match(/SET ([\s\S]*?)\s+WHERE/) || [, ''])[1]
        .split(',')
        .map((c) => c.trim().split(' ')[0]);
      const cambiada = { ...fila };
      columnas.forEach((c, i) => {
        cambiada[c] = c === 'horario' ? JSON.parse(params[i + 1]) : params[i + 1];
      });
      return { rows: [{ ...cambiada, actualizado_en: '2026-11-08T12:00:00.000Z', actualizado_por: 1 }] };
    }
    return undefined;
  });
}

const put = (cuerpo, token = admin()) => request(app)
  .put('/api/configuracion')
  .set('Authorization', `Bearer ${token}`)
  .send(cuerpo);

// ---------------------------------------------------------------------------
// GET /api/configuracion — publica, lista blanca
// ---------------------------------------------------------------------------

test('d-16b: la configuracion publica no pide login', async () => {
  const db = fakeDb();
  try {
    const res = await request(app).get('/api/configuracion');
    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16b: la publica devuelve SOLO la lista blanca', async () => {
  const db = fakeDb();
  try {
    const res = await request(app).get('/api/configuracion');

    assert.deepStrictEqual(Object.keys(res.body).sort(), [
      'direccion', 'horario', 'moneda', 'nombre', 'propina_sugerida_pct', 'telefono', 'url_logo',
    ]);
    // La auditoria no se publica: dice quien toco la configuracion y cuando.
    assert.strictEqual(res.body.actualizado_en, undefined);
    assert.strictEqual(res.body.actualizado_por, undefined);
    assert.strictEqual(res.body.id, undefined);
  } finally {
    db.restaurar();
  }
});

test('d-16b: la lista blanca es una lista, no un delete de lo sensible', async () => {
  // Asi una columna nueva en la tabla NO se publica sola el dia que alguien la
  // agregue: solo sale lo que esta nombrado.
  const db = fakeDb({ fila: { ...FILA, columna_nueva_secreta: 'ups' } });
  try {
    const res = await request(app).get('/api/configuracion');
    assert.strictEqual(res.body.columna_nueva_secreta, undefined);
    assert.ok(!JSON.stringify(res.body).includes('ups'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: la publica no usa SELECT *', async () => {
  const db = fakeDb();
  try {
    await request(app).get('/api/configuracion');
    const consulta = db.buscar('FROM configuracion_restaurante');
    assert.ok(consulta);
    assert.ok(!consulta.sql.includes('SELECT *'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: sin fila en la tabla responde 404', async () => {
  const db = fakeDb({ fila: null });
  try {
    assert.strictEqual((await request(app).get('/api/configuracion')).status, 404);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// GET /api/configuracion/completa — solo admin
// ---------------------------------------------------------------------------

test('d-16b: la completa pide admin', async () => {
  const db = fakeDb();
  try {
    assert.strictEqual((await request(app).get('/api/configuracion/completa')).status, 401);
    for (const rol of ['mesero', 'cajero', 'cocina']) {
      const res = await request(app)
        .get('/api/configuracion/completa')
        .set('Authorization', `Bearer ${tokenStaff(4, rol)}`);
      assert.strictEqual(res.status, 403, rol);
    }
    const res = await request(app)
      .get('/api/configuracion/completa')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);
    assert.strictEqual(res.status, 403, 'comensal');
  } finally {
    db.restaurar();
  }
});

test('d-16b: la completa si trae la auditoria', async () => {
  const db = fakeDb();
  try {
    const res = await request(app)
      .get('/api/configuracion/completa')
      .set('Authorization', `Bearer ${admin()}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.actualizado_por, 7);
    assert.ok(res.body.actualizado_en);
    assert.strictEqual(res.body.nombre, 'SmartDining');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/configuracion — permisos y validacion
// ---------------------------------------------------------------------------

test('d-16b: el PUT pide admin', async () => {
  const db = fakeDb();
  try {
    assert.strictEqual((await request(app).put('/api/configuracion').send({ nombre: 'X' })).status, 401);
    for (const rol of ['mesero', 'cajero', 'cocina']) {
      assert.strictEqual((await put({ nombre: 'Xx' }, tokenStaff(4, rol))).status, 403, rol);
    }
  } finally {
    db.restaurar();
  }
});

test('d-16b: un cuerpo vacio es 400', async () => {
  const db = fakeDb();
  try {
    const res = await put({});
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /al menos un campo/i);
  } finally {
    db.restaurar();
  }
});

test('d-16b: una clave de mas es 400 (strict)', async () => {
  const db = fakeDb();
  try {
    // La auditoria no se edita: la pone el trigger. Sin .strict() el UPDATE la
    // ignoraria en silencio y quien llama creeria haberla cambiado.
    for (const cuerpo of [
      { nombre: 'Rest', actualizado_por: 9 },
      { nombre: 'Rest', actualizado_en: 'ahora' },
      { nombre: 'Rest', id: 2 },
    ]) {
      assert.strictEqual((await put(cuerpo)).status, 400, JSON.stringify(cuerpo));
    }
    assert.ok(!db.buscar('UPDATE configuracion_restaurante'), 'no se escribio nada');
  } finally {
    db.restaurar();
  }
});

test('d-16b: la propina solo entre 0 y 30', async () => {
  const db = fakeDb();
  try {
    // Es el CHECK de la columna: aqui sale 400 con un mensaje util en vez del
    // 422 generico de la base.
    for (const pct of [-1, 30.01, 31, 100]) {
      const res = await put({ propina_sugerida_pct: pct });
      assert.strictEqual(res.status, 400, String(pct));
    }
    for (const pct of [0, 10, 12.5, 30]) {
      assert.strictEqual((await put({ propina_sugerida_pct: pct })).status, 200, String(pct));
    }
  } finally {
    db.restaurar();
  }
});

test('d-16b: la propina admite 2 decimales, no mas', async () => {
  const db = fakeDb();
  try {
    // NUMERIC(4,2): un tercer decimal se redondearia en silencio y el valor
    // guardado no seria el que se mando.
    assert.strictEqual((await put({ propina_sugerida_pct: 12.34 })).status, 200);
    const res = await put({ propina_sugerida_pct: 12.345 });
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /2 decimales/);
  } finally {
    db.restaurar();
  }
});

test('d-16b: la moneda son 3 letras mayusculas', async () => {
  const db = fakeDb();
  try {
    for (const moneda of ['cop', 'CO', 'COPA', 'C0P', '', 'co p']) {
      assert.strictEqual((await put({ moneda })).status, 400, JSON.stringify(moneda));
    }
    assert.strictEqual((await put({ moneda: 'USD' })).status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16b: el horario tiene que ser un objeto', async () => {
  const db = fakeDb();
  try {
    // La tabla lo exige con ck_configuracion_horario_objeto
    // (jsonb_typeof(horario) = 'object').
    for (const horario of [[], 'lunes', 5, true]) {
      assert.strictEqual((await put({ horario })).status, 400, JSON.stringify(horario));
    }
    assert.strictEqual((await put({ horario: {} })).status, 200, 'un objeto vacio si vale');
    assert.strictEqual(
      (await put({ horario: { lunes: { abre: '09:00', cierra: '18:00' } } })).status,
      200
    );
  } finally {
    db.restaurar();
  }
});

test('d-16b: los textos respetan el largo de las columnas', async () => {
  const db = fakeDb();
  try {
    assert.strictEqual((await put({ nombre: 'a'.repeat(121) })).status, 400, 'nombre VARCHAR(120)');
    assert.strictEqual((await put({ telefono: 'a'.repeat(31) })).status, 400, 'telefono VARCHAR(30)');
    assert.strictEqual((await put({ direccion: 'a'.repeat(201) })).status, 400, 'direccion VARCHAR(200)');
    assert.strictEqual((await put({ url_logo: 'a'.repeat(256) })).status, 400, 'url_logo VARCHAR(255)');
    assert.strictEqual((await put({ nombre: 'a'.repeat(120) })).status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16b: url_logo, telefono y direccion admiten null', async () => {
  const db = fakeDb();
  try {
    // Quitar el logo o el telefono es una operacion normal.
    assert.strictEqual((await put({ url_logo: null })).status, 200);
    assert.strictEqual((await put({ telefono: null })).status, 200);
    assert.strictEqual((await put({ direccion: null })).status, 200);
    // El nombre no: la tabla lo tiene NOT NULL.
    assert.strictEqual((await put({ nombre: null })).status, 400);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PUT — la transaccion y el autor del cambio
// ---------------------------------------------------------------------------

test('d-16b: el UPDATE va en una transaccion que PRIMERO fija app.id_usuario', async () => {
  const db = fakeDb();
  try {
    await put({ nombre: 'Rest Nuevo' });

    const sqls = db.ejecutadas.map((q) => q.sql);
    const begin = sqls.findIndex((s) => s.includes('BEGIN'));
    const config = sqls.findIndex((s) => s.includes('set_config'));
    const update = sqls.findIndex((s) => s.includes('UPDATE configuracion_restaurante'));
    const commit = sqls.findIndex((s) => s.includes('COMMIT'));

    assert.ok(begin >= 0, 'hay transaccion');
    assert.ok(config > begin, 'el set_config va dentro');
    assert.ok(update > config, 'y ANTES del UPDATE: si no, el trigger no ve el autor');
    assert.ok(commit > update);
  } finally {
    db.restaurar();
  }
});

test('d-16b: el autor sale del JWT y es local a la transaccion', async () => {
  const db = fakeDb();
  try {
    await put({ nombre: 'Rest Nuevo' }, tokenStaff(42, 'admin'));

    const config = db.buscar('set_config');
    assert.ok(config);
    // app.id_usuario con el id del token, y el tercer argumento en true
    // (is_local): el valor muere con la transaccion y no se filtra a la
    // siguiente peticion que use esta conexion del pool.
    assert.strictEqual(config.params[0], 'app.id_usuario');
    assert.strictEqual(config.params[1], '42');
    assert.ok(config.sql.includes('true'), 'is_local = true');
  } finally {
    db.restaurar();
  }
});

test('d-16b: el PUT es parcial: solo manda las columnas enviadas', async () => {
  const db = fakeDb();
  try {
    await put({ telefono: '3009999999' });

    const update = db.buscar('UPDATE configuracion_restaurante');
    assert.ok(update.sql.includes('telefono ='));
    // Si mandara el resto, un PUT del telefono reescribiria el horario con un
    // valor viejo que el cliente ni vio.
    for (const otra of ['nombre =', 'horario =', 'moneda =', 'propina_sugerida_pct =']) {
      assert.ok(!update.sql.includes(otra), `no debe tocar ${otra}`);
    }
  } finally {
    db.restaurar();
  }
});

test('d-16b: el backend NO escribe actualizado_en ni actualizado_por', async () => {
  const db = fakeDb();
  try {
    await put({ nombre: 'Rest Nuevo' });

    const update = db.buscar('UPDATE configuracion_restaurante');
    const set = (update.sql.match(/SET ([\s\S]*?)\s+WHERE/) || [, ''])[1];
    assert.ok(!set.includes('actualizado_en'), 'lo pone el trigger');
    assert.ok(!set.includes('actualizado_por'), 'lo pone el trigger desde app.id_usuario');
  } finally {
    db.restaurar();
  }
});

test('d-16b: el horario viaja como JSON para la columna JSONB', async () => {
  const db = fakeDb();
  try {
    await put({ horario: { lunes: { abre: '09:00', cierra: '18:00' } } });

    const update = db.buscar('UPDATE configuracion_restaurante');
    assert.strictEqual(update.params[1], '{"lunes":{"abre":"09:00","cierra":"18:00"}}');
  } finally {
    db.restaurar();
  }
});

test('d-16b: el PUT devuelve la configuracion completa ya actualizada', async () => {
  const db = fakeDb();
  try {
    const res = await put({ nombre: 'Rest Nuevo' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.nombre, 'Rest Nuevo');
    // Con la auditoria que acaba de poner el trigger, para que el panel vea de
    // una vez quien quedo registrado sin una segunda llamada.
    assert.strictEqual(res.body.actualizado_por, 1);
    assert.ok(res.body.actualizado_en);
  } finally {
    db.restaurar();
  }
});

test('d-16b: si la base falla, se hace ROLLBACK', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('UPDATE configuracion_restaurante')) throw new Error('la base no responde');
    if (sql.includes('FROM configuracion_restaurante')) return { rows: [FILA] };
    return undefined;
  });
  try {
    const res = await put({ nombre: 'Rest Nuevo' });

    assert.strictEqual(res.status, 500, 'el error sube al manejador central');
    assert.ok(db.buscar('ROLLBACK'), 'la transaccion se deshace');
    assert.ok(!db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: el servicio sabe que la fila es la 1 y no acepta otra', async () => {
  // El CHECK ck_configuracion_fila_unica no admite otro id, asi que el backend
  // no tiene por que buscar ninguno.
  const db = fakeDb();
  try {
    await request(app).get('/api/configuracion');
    assert.deepStrictEqual(db.buscar('FROM configuracion_restaurante').params, [1]);
    assert.strictEqual(configuracionService.ID_CONFIGURACION, 1);
  } finally {
    db.restaurar();
  }
});
