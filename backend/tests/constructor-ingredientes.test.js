const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const { CLAVE_CACHE } = require('../src/services/menu.service');
const { MENSAJE_INGREDIENTE_VENDIDO } = require('../src/services/constructor.service');
const app = require('../server');

// D-04: CRUD de ingredientes del constructor.
//
// Lo que se vigila aqui, aparte del camino feliz, son los dos desajustes entre
// lo que manda el panel y lo que acepta la base (13_constructor.sql:75-92):
//   - calorias llega null y la columna es NOT NULL DEFAULT 0;
//   - url_imagen llega como cadena vacia y la columna acepta NULL (guardar ''
//     seria basura que el constructor intentaria cargar como imagen).
// Y que un ingrediente ya vendido no se borra: el RESTRICT de
// detalles_ingredientes manda 23503 y eso tiene que salir como 409, no 500.

const ID_PASO = 31;
const ID_INGREDIENTE = 10;

// Fragmentos CON ALIAS.
const SQL_PASO = 'FROM pasos_constructor pc WHERE pc.id_paso';
const SQL_INGREDIENTE_LOCK = 'FROM ingredientes i WHERE i.id_ingrediente = $1 FOR UPDATE';
const SQL_INSERT_ING = 'INSERT INTO ingredientes';
const SQL_UPDATE_ING = 'UPDATE ingredientes';
const SQL_DELETE_ING = 'DELETE FROM ingredientes';

const jwtAdmin = () => `Bearer ${tokenStaff(1, 'admin')}`;

const PASO = { id_paso: ID_PASO, id_plato: 7, nombre: 'Elige tu Base', orden: 1 };

const INGREDIENTE = {
  id_ingrediente: ID_INGREDIENTE,
  id_paso: ID_PASO,
  nombre: 'Arroz',
  precio_extra: '0.00',
  calorias: 150,
  alergenos: [],
  url_imagen: null,
  disponible: true,
};

function errorPg(code, constraint) {
  const err = new Error(`simulado ${code}`);
  err.code = code;
  err.constraint = constraint;
  return err;
}

/**
 * @param {{paso?: object|null, fila?: object|null, fallaEn?: {sql: string, error: Error}}} o
 */
function dbIngredientes(o = {}) {
  const { paso = PASO, fila = INGREDIENTE, fallaEn = null } = o;
  return (sql) => {
    if (fallaEn && sql.includes(fallaEn.sql)) throw fallaEn.error;

    if (sql.includes(SQL_PASO)) return { rows: paso ? [paso] : [] };
    if (sql.includes(SQL_INGREDIENTE_LOCK)) return { rows: fila ? [fila] : [] };
    if (sql.includes('FROM ingredientes i WHERE i.id_ingrediente')) {
      return { rows: fila ? [fila] : [] };
    }
    if (sql.includes(SQL_INSERT_ING)) return { rows: [{ ...INGREDIENTE }] };
    if (sql.includes(SQL_UPDATE_ING)) return { rows: [{ ...fila }] };
    if (sql.includes(SQL_DELETE_ING)) return { rows: fila ? [{ id_ingrediente: ID_INGREDIENTE }] : [] };
    return { rows: [] };
  };
}

const crear = (cuerpo) =>
  request(app)
    .post(`/api/pasos/${ID_PASO}/ingredientes`)
    .set('Authorization', jwtAdmin())
    .send(cuerpo);

/** Nombre de columna -> valor, leyendo el INSERT que se armó. */
function columnasDelInsert(consulta) {
  const lista = consulta.sql.match(/INSERT INTO ingredientes \(([^)]+)\)/)[1];
  const nombres = lista.split(',').map((c) => c.trim());
  return Object.fromEntries(nombres.map((n, i) => [n, consulta.params[i]]));
}

// ---------------------------------------------------------------------------
// POST /api/pasos/:id/ingredientes
// ---------------------------------------------------------------------------

test('post: crea el ingrediente y responde 201', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    const res = await crear({ nombre: 'Arroz', precio_extra: 0, calorias: 150 });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.id_ingrediente, ID_INGREDIENTE);
    assert.strictEqual(res.body.nombre, 'Arroz');
    assert.deepStrictEqual(res.body.alergenos, []);
  } finally {
    db.restaurar();
  }
});

test('post: el id_paso del CUERPO se ignora, vale el de la URL', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    // El panel manda id_paso en el body; aqui va uno DISTINTO a proposito.
    const res = await crear({ id_paso: 999, nombre: 'Arroz' });

    assert.strictEqual(res.status, 201);

    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.strictEqual(columnas.id_paso, ID_PASO, 'se inserta con el id de la URL');
    assert.ok(!Object.values(columnas).includes(999), 'el del cuerpo no llega a la base');
  } finally {
    db.restaurar();
  }
});

test('post: calorias null OMITE la columna para que actue el DEFAULT 0', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    // Es exactamente lo que manda el panel: `calorias ? Number(c) : null`.
    const res = await crear({ nombre: 'Arroz', calorias: null });

    assert.strictEqual(res.status, 201);

    // Se mira la lista de columnas del INSERT, no todo el SQL: el RETURNING
    // tambien nombra calorias y haria pasar la prueba por el motivo equivocado.
    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.ok(
      !('calorias' in columnas),
      'la columna no se inserta: NOT NULL DEFAULT 0 pone el 0'
    );
    assert.strictEqual(columnas.nombre, 'Arroz', 'el resto si se inserta');
  } finally {
    db.restaurar();
  }
});

test('post: calorias omitida tambien deja actuar al DEFAULT', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Arroz' });
    assert.ok(!('calorias' in columnasDelInsert(db.buscar(SQL_INSERT_ING))));
  } finally {
    db.restaurar();
  }
});

test('post: calorias con valor SI se escribe', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Arroz', calorias: 150 });

    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.strictEqual(columnas.calorias, 150);
  } finally {
    db.restaurar();
  }
});

test('post: url_imagen vacia se guarda como null, no como cadena vacia', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    // El panel inicializa url_imagen en ''.
    await crear({ nombre: 'Arroz', url_imagen: '' });

    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.strictEqual(columnas.url_imagen, null, 'una imagen vacia es ninguna imagen');
  } finally {
    db.restaurar();
  }
});

test('post: url_imagen de solo espacios tambien es null', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Arroz', url_imagen: '   ' });
    assert.strictEqual(columnasDelInsert(db.buscar(SQL_INSERT_ING)).url_imagen, null);
  } finally {
    db.restaurar();
  }
});

test('post: url_imagen con valor se conserva', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Arroz', url_imagen: 'https://cdn/arroz.webp' });
    assert.strictEqual(
      columnasDelInsert(db.buscar(SQL_INSERT_ING)).url_imagen,
      'https://cdn/arroz.webp'
    );
  } finally {
    db.restaurar();
  }
});

test('post: aplica los DEFAULT del panel y de la base', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Arroz' });

    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.strictEqual(columnas.precio_extra, 0);
    assert.deepStrictEqual(columnas.alergenos, []);
    assert.strictEqual(columnas.disponible, true);
  } finally {
    db.restaurar();
  }
});

test('post: los alergenos viajan como arreglo de texto', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await crear({ nombre: 'Queso', alergenos: ['lacteos', 'frutos secos'] });

    const columnas = columnasDelInsert(db.buscar(SQL_INSERT_ING));
    assert.deepStrictEqual(columnas.alergenos, ['lacteos', 'frutos secos']);
  } finally {
    db.restaurar();
  }
});

test('post: paso inexistente responde 404', async () => {
  const db = instalarFakeDb(dbIngredientes({ paso: null }));
  try {
    const res = await crear({ nombre: 'Arroz' });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(db.buscar(SQL_INSERT_ING), undefined, 'no se inserta nada');
  } finally {
    db.restaurar();
  }
});

test('post: nombre repetido en el mismo paso responde 409', async () => {
  const db = instalarFakeDb(
    dbIngredientes({
      fallaEn: { sql: SQL_INSERT_ING, error: errorPg('23505', 'uq_ingredientes_paso_nombre') },
    })
  );
  try {
    const res = await crear({ nombre: 'Arroz' });

    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /con ese nombre/);
  } finally {
    db.restaurar();
  }
});

const CASOS_400 = [
  ['nombre vacio', { nombre: '' }],
  ['nombre de mas de 80', { nombre: 'x'.repeat(81) }],
  ['precio_extra negativo', { nombre: 'X', precio_extra: -1 }],
  ['calorias negativas', { nombre: 'X', calorias: -5 }],
  ['calorias no entero', { nombre: 'X', calorias: 1.5 }],
  ['alergenos que no es arreglo', { nombre: 'X', alergenos: 'lacteos' }],
  ['url_imagen de mas de 255', { nombre: 'X', url_imagen: `https://x/${'y'.repeat(260)}` }],
  ['disponible que no es booleano', { nombre: 'X', disponible: 'si' }],
];

for (const [caso, cuerpo] of CASOS_400) {
  test(`post: ${caso} responde 400 sin tocar la base`, async () => {
    const db = instalarFakeDb(dbIngredientes());
    try {
      const res = await crear(cuerpo);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(db.buscar(SQL_INSERT_ING), undefined);
    } finally {
      db.restaurar();
    }
  });
}

test('post: solo admin escribe', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    for (const rol of ['cajero', 'mesero', 'cocina']) {
      const res = await request(app)
        .post(`/api/pasos/${ID_PASO}/ingredientes`)
        .set('Authorization', `Bearer ${tokenStaff(2, rol)}`)
        .send({ nombre: 'Arroz' });
      assert.strictEqual(res.status, 403, `${rol} no escribe el constructor`);
    }

    const comensal = await request(app)
      .post(`/api/pasos/${ID_PASO}/ingredientes`)
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ nombre: 'Arroz' });
    assert.strictEqual(comensal.status, 403);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/ingredientes/:id
// ---------------------------------------------------------------------------

test('put: lee con FOR UPDATE y escribe en la misma transaccion', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    const res = await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Arroz integral' });

    assert.strictEqual(res.status, 200);

    const pasos = db.ejecutadas.map((q) => q.sql);
    const iBegin = pasos.findIndex((s) => s.includes('BEGIN'));
    const iLock = pasos.findIndex((s) => s.includes('FOR UPDATE'));
    const iUpdate = pasos.findIndex((s) => s.includes(SQL_UPDATE_ING));
    const iCommit = pasos.findIndex((s) => s.includes('COMMIT'));

    assert.ok(iBegin >= 0 && iLock > iBegin, 'la fila se bloquea dentro de la transaccion');
    assert.ok(iUpdate > iLock && iCommit > iUpdate);
  } finally {
    db.restaurar();
  }
});

test('put: solo cambia lo que se manda', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ disponible: false });

    const update = db.buscar(SQL_UPDATE_ING);
    assert.strictEqual(update.params[0], INGREDIENTE.nombre, 'nombre intacto');
    assert.strictEqual(update.params[2], INGREDIENTE.calorias, 'calorias intactas');
    assert.strictEqual(update.params[5], false, 'lo que se mando');
  } finally {
    db.restaurar();
  }
});

test('put: calorias null se guarda como 0, no como null', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    const res = await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ calorias: null });

    assert.strictEqual(res.status, 200);
    // En un PUT la columna ya tiene valor y no hay DEFAULT que invocar: null
    // significa "no se", y en una columna NOT NULL eso es 0.
    assert.strictEqual(db.buscar(SQL_UPDATE_ING).params[2], 0);
  } finally {
    db.restaurar();
  }
});

test('put: url_imagen vacia se guarda como null', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ url_imagen: '' });

    assert.strictEqual(db.buscar(SQL_UPDATE_ING).params[4], null);
  } finally {
    db.restaurar();
  }
});

test('put: ingrediente inexistente responde 404', async () => {
  const db = instalarFakeDb(dbIngredientes({ fila: null }));
  try {
    const res = await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'X' });

    assert.strictEqual(res.status, 404);
    assert.ok(db.buscar('ROLLBACK'), 'la transaccion abierta se cierra');
  } finally {
    db.restaurar();
  }
});

test('put: nombre repetido responde 409 aunque el error llegue en el COMMIT', async () => {
  const db = instalarFakeDb(
    dbIngredientes({
      fallaEn: { sql: 'COMMIT', error: errorPg('23505', 'uq_ingredientes_paso_nombre') },
    })
  );
  try {
    const res = await request(app)
      .put(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Quinoa' });

    assert.strictEqual(res.status, 409);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/ingredientes/:id
// ---------------------------------------------------------------------------

test('delete: borra el ingrediente y responde 204', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    const res = await request(app)
      .delete(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 204);
    assert.ok(db.buscar(SQL_DELETE_ING));
  } finally {
    db.restaurar();
  }
});

test('delete: ingrediente inexistente responde 404', async () => {
  const db = instalarFakeDb(dbIngredientes({ fila: null }));
  try {
    const res = await request(app)
      .delete(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 404);
  } finally {
    db.restaurar();
  }
});

test('delete: un ingrediente ya vendido responde 409 con el motivo', async () => {
  // detalles_ingredientes.id_ingrediente es ON DELETE RESTRICT a proposito: los
  // pedidos historicos conservan su composicion.
  const db = instalarFakeDb(
    dbIngredientes({
      fallaEn: { sql: SQL_DELETE_ING, error: errorPg('23503', 'fk_det_ingr_ingrediente') },
    })
  );
  try {
    const res = await request(app)
      .delete(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', jwtAdmin());

    assert.strictEqual(res.status, 409, 'no 500: es una situacion del usuario');
    assert.strictEqual(res.body.error, MENSAJE_INGREDIENTE_VENDIDO);
    assert.match(res.body.error, /no disponible/, 'y le dice que hacer en su lugar');
  } finally {
    db.restaurar();
  }
});

test('delete: solo admin borra', async () => {
  const db = instalarFakeDb(dbIngredientes());
  try {
    const res = await request(app)
      .delete(`/api/ingredientes/${ID_INGREDIENTE}`)
      .set('Authorization', `Bearer ${tokenStaff(2, 'mesero')}`);

    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.buscar(SQL_DELETE_ING), undefined);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Cache del menu
// ---------------------------------------------------------------------------

test('cada escritura de ingredientes invalida la cache del menu', async () => {
  const escrituras = [
    ['post', () => request(app).post(`/api/pasos/${ID_PASO}/ingredientes`).send({ nombre: 'N' })],
    ['put', () => request(app).put(`/api/ingredientes/${ID_INGREDIENTE}`).send({ nombre: 'N' })],
    ['delete', () => request(app).delete(`/api/ingredientes/${ID_INGREDIENTE}`)],
  ];

  for (const [nombre, hacer] of escrituras) {
    const db = instalarFakeDb(dbIngredientes());
    const redis = instalarFakeRedis({ inicial: { [CLAVE_CACHE]: [{ categoria: 'vieja' }] } });
    try {
      const res = await hacer().set('Authorization', jwtAdmin());
      assert.ok(res.status < 400, `${nombre}: la escritura funciona (${res.status})`);
      assert.ok(!redis.tiene(CLAVE_CACHE), `${nombre}: la cache se invalida`);
    } finally {
      redis.restaurar();
      db.restaurar();
    }
  }
});

test('con Redis caido la escritura de ingredientes sigue funcionando', async () => {
  const db = instalarFakeDb(dbIngredientes());
  const redis = instalarFakeRedis({ falloEn: ['del'] });
  try {
    const res = await crear({ nombre: 'Arroz' });

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar(SQL_INSERT_ING), 'el ingrediente quedo creado');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});
