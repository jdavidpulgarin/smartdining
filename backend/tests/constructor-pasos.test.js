const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const { CLAVE_CACHE } = require('../src/services/menu.service');
const { MENSAJE_PASO_VENDIDO } = require('../src/services/constructor.service');
const app = require('../server');

// D-04: CRUD de pasos del constructor de platos.
//
// Tablas y constraints en database/scripts/13_constructor.sql. Lo que se
// comprueba aqui, mas alla del camino feliz:
//   - id_plato del CUERPO se ignora: el que vale es el de la URL;
//   - los CHECK cruzados (min_sel <= max_sel, obligatorio => min_sel >= 1) se
//     validan sobre la fila YA MEZCLADA en un PUT parcial;
//   - uq_pasos_plato_orden es DEFERRABLE, asi que su 23505 llega en el COMMIT;
//   - un paso con ingredientes ya vendidos no se borra (23503 por el RESTRICT
//     de detalles_ingredientes), responde 409 y no 500.

const ID_PLATO = 7;
const ID_PASO = 31;

// Fragmentos CON ALIAS, para no pisar lo que capturan otras pruebas.
const SQL_PASOS_DE_PLATO = 'FROM pasos_constructor pc';
const SQL_PLATO = 'SELECT * FROM platos WHERE id_plato';
const SQL_INSERT_PASO = 'INSERT INTO pasos_constructor';
const SQL_UPDATE_PASO = 'UPDATE pasos_constructor';
const SQL_DELETE_PASO = 'DELETE FROM pasos_constructor';

const jwtAdmin = () => `Bearer ${tokenStaff(1, 'admin')}`;

const PASO = {
  id_paso: ID_PASO,
  id_plato: ID_PLATO,
  nombre: 'Elige tu Base',
  orden: 1,
  min_sel: 1,
  max_sel: 1,
  obligatorio: true,
};

/** Error de PostgreSQL tal como lo entrega pg: con code y constraint. */
function errorPg(code, constraint) {
  const err = new Error(`simulado ${code}`);
  err.code = code;
  err.constraint = constraint;
  return err;
}

/**
 * @param {{plato?: object|null, pasos?: object[], paso?: object|null,
 *          fallaEn?: {sql: string, error: Error}}} opciones
 */
function dbConstructor(opciones = {}) {
  const {
    plato = { id_plato: ID_PLATO, nombre: 'Bowl', personalizable: true },
    pasos = [],
    paso = PASO,
    fallaEn = null,
  } = opciones;

  return (sql) => {
    if (fallaEn && sql.includes(fallaEn.sql)) throw fallaEn.error;

    if (sql.includes(SQL_PLATO)) return { rows: plato ? [plato] : [] };
    if (sql.includes(SQL_PASOS_DE_PLATO)) return { rows: paso && pasos.length === 0 ? pasos : pasos };
    if (sql.includes(SQL_INSERT_PASO)) return { rows: [{ ...PASO }] };
    if (sql.includes(SQL_UPDATE_PASO)) return { rows: [{ ...PASO }] };
    if (sql.includes(SQL_DELETE_PASO)) return { rows: [{ id_paso: ID_PASO }] };
    return { rows: [] };
  };
}

/** Doble para los caminos que leen el paso suelto (PUT y POST de ingrediente). */
function dbPaso(opciones = {}) {
  const { paso = PASO, fallaEn = null, filaActual = PASO } = opciones;
  return (sql) => {
    if (fallaEn && sql.includes(fallaEn.sql)) throw fallaEn.error;
    if (sql.includes('FROM pasos_constructor pc WHERE pc.id_paso = $1 FOR UPDATE')) {
      return { rows: filaActual ? [filaActual] : [] };
    }
    if (sql.includes('FROM pasos_constructor pc WHERE pc.id_paso')) {
      return { rows: paso ? [paso] : [] };
    }
    if (sql.includes(SQL_UPDATE_PASO)) return { rows: [{ ...filaActual }] };
    if (sql.includes(SQL_DELETE_PASO)) return { rows: paso ? [{ id_paso: ID_PASO }] : [] };
    return { rows: [] };
  };
}

// ---------------------------------------------------------------------------
// GET /api/platos/:id/pasos
// ---------------------------------------------------------------------------

test('get: devuelve el ARRAY pelado, no { pasos }', async () => {
  const pasos = [
    { ...PASO, ingredientes: [{ id_ingrediente: 10, nombre: 'Arroz', disponible: true }] },
  ];
  const db = instalarFakeDb(dbConstructor({ pasos }));
  try {
    const res = await request(app)
      .get(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 200);
    // El panel hace `return await apiFetch(...)` y su fallback es un array:
    // envolverlo en un objeto lo rompe.
    assert.ok(Array.isArray(res.body), 'el cuerpo ES el array');
    assert.strictEqual(res.body.length, 1);
    assert.strictEqual(res.body[0].id_paso, ID_PASO);
    assert.strictEqual(res.body[0].ingredientes[0].nombre, 'Arroz');
  } finally {
    db.restaurar();
  }
});

test('get: los pasos salen por orden y los ingredientes anidados en una consulta', async () => {
  const db = instalarFakeDb(dbConstructor({ pasos: [] }));
  try {
    await request(app).get(`/api/platos/${ID_PLATO}/pasos`).set('Authorization', jwtAdmin());

    const consulta = db.buscar(SQL_PASOS_DE_PLATO);
    assert.ok(consulta);
    assert.match(consulta.sql, /ORDER BY pc\.orden ASC/, 'mismo orden que obtener_menu_completo');
    assert.match(consulta.sql, /ORDER BY i\.id_ingrediente ASC/);
    assert.strictEqual(db.todas(SQL_PASOS_DE_PLATO).length, 1, 'una consulta, no una por paso');
  } finally {
    db.restaurar();
  }
});

test('get: plato inexistente responde 404', async () => {
  const db = instalarFakeDb(dbConstructor({ plato: null }));
  try {
    const res = await request(app)
      .get(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.buscar(SQL_PASOS_DE_PLATO), undefined, 'no se consultan los pasos');
  } finally {
    db.restaurar();
  }
});

test('get: lo leen admin, cajero y mesero; cocina y comensal no', async () => {
  const db = instalarFakeDb(dbConstructor({ pasos: [] }));
  try {
    for (const rol of ['admin', 'cajero', 'mesero']) {
      const res = await request(app)
        .get(`/api/platos/${ID_PLATO}/pasos`)
        .set('Authorization', `Bearer ${tokenStaff(1, rol)}`);
      assert.strictEqual(res.status, 200, `${rol} debe poder leer`);
    }

    const cocina = await request(app)
      .get(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', `Bearer ${tokenStaff(7, 'cocina')}`);
    assert.strictEqual(cocina.status, 403);

    const comensal = await request(app)
      .get(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', `Bearer ${tokenComensal(5)}`);
    assert.strictEqual(comensal.status, 403);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/platos/:id/pasos
// ---------------------------------------------------------------------------

test('post: crea el paso y lo devuelve con ingredientes vacios', async () => {
  const db = instalarFakeDb(dbConstructor());
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu Base', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id_paso, ID_PASO);
    assert.deepStrictEqual(res.body.ingredientes, [], 'el panel espera la lista, aunque vacia');
  } finally {
    db.restaurar();
  }
});

test('post: el id_plato del CUERPO se ignora, vale el de la URL', async () => {
  const db = instalarFakeDb(dbConstructor());
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      // El panel manda id_plato en el body; aqui va uno DISTINTO a proposito.
      .send({ id_plato: 999, nombre: 'Elige tu Base', orden: 1, obligatorio: false });

    assert.strictEqual(res.status, 201);

    const insert = db.buscar(SQL_INSERT_PASO);
    assert.strictEqual(insert.params[0], ID_PLATO, 'se inserta con el id de la URL');
    assert.ok(!insert.params.includes(999), 'el del cuerpo no llega a la base');
  } finally {
    db.restaurar();
  }
});

test('post: aplica los DEFAULT de la base cuando se omiten', async () => {
  const db = instalarFakeDb(dbConstructor());
  try {
    await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Salsa', orden: 4 });

    const insert = db.buscar(SQL_INSERT_PASO);
    assert.strictEqual(insert.params[3], 0, 'min_sel por omision 0');
    assert.strictEqual(insert.params[4], 1, 'max_sel por omision 1');
    assert.strictEqual(insert.params[5], false, 'obligatorio por omision false');
  } finally {
    db.restaurar();
  }
});

test('post: un plato no personalizable responde 409', async () => {
  const db = instalarFakeDb(
    dbConstructor({ plato: { id_plato: ID_PLATO, nombre: 'Gaseosa', personalizable: false } })
  );
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu Base', orden: 1 });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /no es personalizable/);
    assert.strictEqual(db.buscar(SQL_INSERT_PASO), undefined, 'no se inserta nada');
  } finally {
    db.restaurar();
  }
});

test('post: plato inexistente responde 404', async () => {
  const db = instalarFakeDb(dbConstructor({ plato: null }));
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu Base', orden: 1 });

    assert.strictEqual(res.status, 404);
  } finally {
    db.restaurar();
  }
});

test('post: solo admin escribe', async () => {
  const db = instalarFakeDb(dbConstructor());
  try {
    for (const rol of ['cajero', 'mesero', 'cocina']) {
      const res = await request(app)
        .post(`/api/platos/${ID_PLATO}/pasos`)
        .set('Authorization', `Bearer ${tokenStaff(2, rol)}`)
        .send({ nombre: 'Elige tu Base', orden: 1 });
      assert.strictEqual(res.status, 403, `${rol} no escribe el constructor`);
    }
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Validaciones que replican los CHECK
// ---------------------------------------------------------------------------

const CASOS_400 = [
  ['orden 0 (ck orden > 0)', { nombre: 'X', orden: 0 }],
  ['orden negativo', { nombre: 'X', orden: -1 }],
  ['min_sel negativo', { nombre: 'X', orden: 1, min_sel: -1 }],
  ['max_sel 0 (ck max_sel >= 1)', { nombre: 'X', orden: 1, max_sel: 0 }],
  ['min_sel > max_sel', { nombre: 'X', orden: 1, min_sel: 3, max_sel: 2 }],
  ['obligatorio con min_sel 0', { nombre: 'X', orden: 1, min_sel: 0, obligatorio: true }],
  ['nombre vacio', { nombre: '', orden: 1 }],
  ['nombre de mas de 60', { nombre: 'x'.repeat(61), orden: 1 }],
  ['orden no entero', { nombre: 'X', orden: 1.5 }],
];

for (const [caso, cuerpo] of CASOS_400) {
  test(`post: ${caso} responde 400 sin tocar la base`, async () => {
    const db = instalarFakeDb(dbConstructor());
    try {
      const res = await request(app)
        .post(`/api/platos/${ID_PLATO}/pasos`)
        .set('Authorization', jwtAdmin())
        .send(cuerpo);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error, 'con un mensaje que se entienda');
      assert.strictEqual(db.buscar(SQL_INSERT_PASO), undefined);
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// 409 de los UNIQUE
// ---------------------------------------------------------------------------

test('post: orden repetido responde 409, no 500', async () => {
  const db = instalarFakeDb(
    dbConstructor({
      fallaEn: { sql: SQL_INSERT_PASO, error: errorPg('23505', 'uq_pasos_plato_orden') },
    })
  );
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Otro', orden: 1 });

    // Sin la traduccion del service, el manejador central lo volveria un 500
    // genérico: el 23505 no esta en sus reglas.
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /en esa posición/);
  } finally {
    db.restaurar();
  }
});

test('post: nombre repetido en el mismo plato responde 409', async () => {
  const db = instalarFakeDb(
    dbConstructor({
      fallaEn: { sql: SQL_INSERT_PASO, error: errorPg('23505', 'uq_pasos_plato_nombre') },
    })
  );
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu Base', orden: 2 });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /con ese nombre/);
  } finally {
    db.restaurar();
  }
});

test('put: el 23505 DIFERIDO del orden llega en el COMMIT y sale como 409', async () => {
  // uq_pasos_plato_orden es DEFERRABLE INITIALLY DEFERRED: el UPDATE pasa sin
  // queja y PostgreSQL recien se queja al confirmar. Si el catch del service no
  // rodeara el COMMIT, este 409 se escaparia como 500.
  const db = instalarFakeDb(
    dbPaso({ fallaEn: { sql: 'COMMIT', error: errorPg('23505', 'uq_pasos_plato_orden') } })
  );
  try {
    const res = await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ orden: 2 });

    assert.strictEqual(res.status, 409, 'el fallo del COMMIT tambien se traduce');
    assert.match(res.body.error, /en esa posición/);
    assert.ok(db.buscar('ROLLBACK'), 'y la transaccion se deshace');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PUT parcial, con la fila bloqueada
// ---------------------------------------------------------------------------

test('put: lee con FOR UPDATE y escribe en la misma transaccion', async () => {
  const db = instalarFakeDb(dbPaso());
  try {
    const res = await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu base (nuevo)' });

    assert.strictEqual(res.status, 200);

    const pasos = db.ejecutadas.map((q) => q.sql);
    const iBegin = pasos.findIndex((s) => s.includes('BEGIN'));
    const iLock = pasos.findIndex((s) => s.includes('FOR UPDATE'));
    const iUpdate = pasos.findIndex((s) => s.includes(SQL_UPDATE_PASO));
    const iCommit = pasos.findIndex((s) => s.includes('COMMIT'));

    assert.ok(iBegin >= 0 && iLock > iBegin, 'la fila se bloquea dentro de la transaccion');
    assert.ok(iUpdate > iLock, 'y se escribe con el bloqueo tomado');
    assert.ok(iCommit > iUpdate, 'el COMMIT va al final');
  } finally {
    db.restaurar();
  }
});

test('put: solo cambia lo que se manda, el resto se conserva', async () => {
  const db = instalarFakeDb(dbPaso());
  try {
    await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Base nueva' });

    const update = db.buscar(SQL_UPDATE_PASO);
    assert.strictEqual(update.params[0], 'Base nueva', 'lo que se mando');
    assert.strictEqual(update.params[1], PASO.orden, 'orden intacto');
    assert.strictEqual(update.params[2], PASO.min_sel, 'min_sel intacto');
    assert.strictEqual(update.params[3], PASO.max_sel, 'max_sel intacto');
    assert.strictEqual(update.params[4], PASO.obligatorio, 'obligatorio intacto');
  } finally {
    db.restaurar();
  }
});

test('put: la regla cruzada se valida sobre la fila MEZCLADA', async () => {
  // La fila guardada tiene max_sel 2. Se manda solo min_sel 5: por separado es
  // valido, pero mezclado da min_sel > max_sel. Sin la mezcla, esto pasaria y
  // lo rechazaria la base con un 500.
  const db = instalarFakeDb(dbPaso({ filaActual: { ...PASO, min_sel: 1, max_sel: 2 } }));
  try {
    const res = await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ min_sel: 5 });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /min_sel no puede ser mayor que max_sel/);
    assert.strictEqual(db.buscar(SQL_UPDATE_PASO), undefined, 'no se escribe nada');
    assert.ok(db.buscar('ROLLBACK'), 'la transaccion se deshace');
  } finally {
    db.restaurar();
  }
});

test('put: marcar obligatorio con min_sel 0 guardado responde 400', async () => {
  const db = instalarFakeDb(dbPaso({ filaActual: { ...PASO, min_sel: 0, obligatorio: false } }));
  try {
    const res = await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ obligatorio: true });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /obligatorio necesita min_sel/);
  } finally {
    db.restaurar();
  }
});

test('put: paso inexistente responde 404', async () => {
  const db = instalarFakeDb(dbPaso({ filaActual: null }));
  try {
    const res = await request(app)
      .put(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'X' });

    assert.strictEqual(res.status, 404);
    assert.ok(db.buscar('ROLLBACK'), 'la transaccion abierta se cierra');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

test('delete: borra el paso y responde 204', async () => {
  const db = instalarFakeDb(dbPaso());
  try {
    const res = await request(app)
      .delete(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 204);
    assert.ok(db.buscar(SQL_DELETE_PASO));
  } finally {
    db.restaurar();
  }
});

test('delete: paso inexistente responde 404', async () => {
  const db = instalarFakeDb(dbPaso({ paso: null }));
  try {
    const res = await request(app)
      .delete(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 404);
  } finally {
    db.restaurar();
  }
});

test('delete: un paso con ingredientes ya vendidos responde 409 con el motivo', async () => {
  // ingredientes.id_paso es ON DELETE CASCADE, pero la cascada se topa con el
  // RESTRICT de detalles_ingredientes y PostgreSQL aborta todo con 23503: el
  // paso queda protegido de rebote.
  const db = instalarFakeDb(
    dbPaso({ fallaEn: { sql: SQL_DELETE_PASO, error: errorPg('23503', 'fk_det_ingr_ingrediente') } })
  );
  try {
    const res = await request(app)
      .delete(`/api/pasos/${ID_PASO}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 409, 'no 500: es una situacion del usuario');
    assert.strictEqual(res.body.error, MENSAJE_PASO_VENDIDO);
    assert.match(res.body.error, /no disponible/, 'y le dice que hacer en su lugar');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Cache del menu
// ---------------------------------------------------------------------------

test('cada escritura invalida la cache del menu', async () => {
  const escrituras = [
    ['post', () => request(app).post(`/api/platos/${ID_PLATO}/pasos`).send({ nombre: 'N', orden: 9 })],
    ['put', () => request(app).put(`/api/pasos/${ID_PASO}`).send({ nombre: 'N' })],
    ['delete', () => request(app).delete(`/api/pasos/${ID_PASO}`)],
  ];

  for (const [nombre, hacer] of escrituras) {
    const db = instalarFakeDb(nombre === 'post' ? dbConstructor() : dbPaso());
    const redis = instalarFakeRedis({ inicial: { [CLAVE_CACHE]: [{ categoria: 'vieja' }] } });
    try {
      assert.ok(redis.tiene(CLAVE_CACHE), `${nombre}: la cache empieza poblada`);

      const res = await hacer().set('Authorization', jwtAdmin());
      assert.ok(res.status < 400, `${nombre}: la escritura funciona (${res.status})`);

      assert.ok(!redis.tiene(CLAVE_CACHE), `${nombre}: la cache se invalida`);
    } finally {
      redis.restaurar();
      db.restaurar();
    }
  }
});

test('con Redis caido la escritura sigue funcionando', async () => {
  const db = instalarFakeDb(dbConstructor());
  const redis = instalarFakeRedis({ falloEn: ['del'] });
  try {
    const res = await request(app)
      .post(`/api/platos/${ID_PLATO}/pasos`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Elige tu Base', orden: 1 });

    // El tiempo real y la cache son extras: cache.borrar devuelve false y no
    // lanza, asi que el paso ya creado no se pierde por eso.
    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar(SQL_INSERT_PASO), 'el paso quedo creado');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});
