const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const platosService = require('../src/services/platos.service');

// ISSUE #132: POST /api/platos sin tiempo_preparacion_estimado daba 500.
//
// El INSERT mandaba NULL explicito en esa columna, que es
// NOT NULL DEFAULT 15 CHECK (> 0) (schema.sql:105): un parametro en NULL PISA el
// DEFAULT, asi que PostgreSQL rechazaba la fila con 23502. Y el INSERT ignoraba
// `personalizable` y `calorias` aunque platoSchema ya las aceptaba (D-16 B solo
// las dejo en el PUT), asi que al crear se perdian en silencio.
//
// Lo que se vigila aqui es la SENTENCIA, que es lo que un doble de la base si
// puede comprobar; el comportamiento contra PostgreSQL de verdad esta en
// tests/integracion/platos-sql.test.js.

const admin = () => tokenStaff(1, 'admin');

const PLATO = {
  id_plato: 77,
  id_categoria: 2,
  nombre: 'Arepa de Huevo',
  descripcion: null,
  precio: 18000,
  url_imagen: null,
  disponible: true,
  tiempo_preparacion_estimado: 15,
  personalizable: false,
  calorias: null,
  creado_en: '2026-11-09T12:00:00.000Z',
};

function fakePlatos({ error = null } = {}) {
  return instalarFakeDb((sql) => {
    if (error && sql.includes('INSERT INTO platos')) throw error;
    if (sql.includes('INSERT INTO platos')) return { rows: [PLATO] };
    if (sql.includes('FROM platos WHERE id_plato')) return { rows: [PLATO] };
    if (sql.includes('UPDATE platos')) return { rows: [PLATO] };
    return { rows: [] };
  });
}

const crear = (cuerpo) => request(app)
  .post('/api/platos')
  .set('Authorization', `Bearer ${admin()}`)
  .send(cuerpo);

const CUERPO_MINIMO = { nombre: 'Arepa de Huevo', precio: 18000, id_categoria: 2 };

const insert = (db) => db.buscar('INSERT INTO platos');

// ---------------------------------------------------------------------------
// El tiempo de preparacion
// ---------------------------------------------------------------------------

test('issue-132: sin tiempo, el INSERT deja que actue el valor por defecto', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    const res = await crear(CUERPO_MINIMO);

    assert.strictEqual(res.status, 201);
    // La clave: COALESCE en la sentencia. Mandar NULL a secas pisaba el DEFAULT
    // de la columna y daba 23502 -> 500.
    assert.ok(
      insert(db).sql.includes(`COALESCE($7, ${platosService.TIEMPO_PREPARACION_POR_OMISION})`),
      insert(db).sql
    );
    assert.strictEqual(insert(db).params[6], null, 'el parametro sigue siendo null');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: la constante es la del esquema (15)', () => {
  assert.strictEqual(platosService.TIEMPO_PREPARACION_POR_OMISION, 15);
});

test('issue-132: el tiempo enviado viaja tal cual', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    await crear({ ...CUERPO_MINIMO, tiempo_preparacion_estimado: 40 });

    assert.strictEqual(insert(db).params[6], 40);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// personalizable y calorias al CREAR
// ---------------------------------------------------------------------------

test('issue-132: el INSERT escribe personalizable y calorias', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    await crear({ ...CUERPO_MINIMO, personalizable: true, calorias: 540 });

    const sql = insert(db).sql;
    assert.ok(sql.includes('personalizable'), 'la columna esta en el INSERT');
    assert.ok(sql.includes('calorias'), 'y calorias tambien');
    assert.strictEqual(insert(db).params[7], true);
    assert.strictEqual(insert(db).params[8], 540);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: personalizable sin enviar deja el default; calorias queda null', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    await crear(CUERPO_MINIMO);

    const sql = insert(db).sql;
    assert.ok(sql.includes(`COALESCE($8, ${platosService.PERSONALIZABLE_POR_OMISION})`), sql);
    assert.strictEqual(insert(db).params[7], null);
    // calorias NO lleva COALESCE: la columna es nullable y null significa "no se
    // sabe", que es distinto de 0.
    assert.ok(!sql.includes('COALESCE($9'), 'calorias se guarda como null a proposito');
    assert.strictEqual(insert(db).params[8], null);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: calorias en 0 llega como 0, no como null', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    await crear({ ...CUERPO_MINIMO, calorias: 0 });

    assert.strictEqual(insert(db).params[8], 0);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: calorias en null se acepta (es "no se sabe")', async () => {
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    const res = await crear({ ...CUERPO_MINIMO, calorias: null });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(insert(db).params[8], null);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lo que no puede acabar en 500
// ---------------------------------------------------------------------------

test('issue-132: una categoria inexistente es 409 categoria_inexistente, no 500', async () => {
  const err = new Error('fk_platos_categoria');
  err.code = '23503';
  const db = fakePlatos({ error: err });
  const redis = instalarFakeRedis();
  try {
    const res = await crear(CUERPO_MINIMO);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
    assert.strictEqual(res.body.error, platosService.MENSAJE_CATEGORIA_INEXISTENTE);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: un CHECK de la base sigue siendo 422, no 500', async () => {
  const err = new Error('ck_platos_precio');
  err.code = '23514';
  const db = fakePlatos({ error: err });
  const redis = instalarFakeRedis();
  try {
    const res = await crear(CUERPO_MINIMO);

    assert.strictEqual(res.status, 422);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: un desborde numerico sigue siendo 422, no 500', async () => {
  const err = new Error('numeric field overflow');
  err.code = '22003';
  const db = fakePlatos({ error: err });
  const redis = instalarFakeRedis();
  try {
    const res = await crear({ ...CUERPO_MINIMO, precio: 99999999999 });

    assert.strictEqual(res.status, 422);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-132: otro 23503 que no sea la categoria no se disfraza', async () => {
  // Solo la FK de la categoria puede dar 23503 al crear un plato, pero si
  // apareciera otra, el servicio no debe decir que falta la categoria... y aqui
  // no hay forma de distinguirlas, asi que se asume la unica que existe. Lo que
  // SI se comprueba es que un error de otra clase sube sin tocar.
  const err = new Error('algo raro');
  err.code = '23502';
  const db = fakePlatos({ error: err });
  const redis = instalarFakeRedis();
  try {
    const res = await crear(CUERPO_MINIMO);

    assert.strictEqual(res.status, 500, 'un 23502 sigue siendo un fallo de verdad');
    assert.strictEqual(res.body.motivo, undefined);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El PUT parcial del servicio
// ---------------------------------------------------------------------------

test('issue-132: el UPDATE protege las columnas NOT NULL con COALESCE', async () => {
  const db = fakePlatos();
  try {
    await platosService.actualizar(77, { precio: 21000 }, { idUsuario: 1 });

    const sql = db.buscar('UPDATE platos').sql;
    for (const columna of ['id_categoria', 'nombre', 'precio', 'disponible',
      'tiempo_preparacion_estimado', 'personalizable', 'calorias']) {
      assert.ok(sql.includes(`${columna} = COALESCE(`), `${columna} sin COALESCE`);
    }
    // descripcion y url_imagen son nullable: ponerlas en null es una edicion
    // valida (quitar la imagen), asi que NO van con COALESCE.
    assert.ok(sql.includes('descripcion = $3'), sql);
    assert.ok(sql.includes('url_imagen = $5'), sql);
  } finally {
    db.restaurar();
  }
});

test('issue-132: el PUT por HTTP sigue mandando la fila mezclada', async () => {
  // El controller lee la fila y la mezcla con el cuerpo, asi que por la ruta no
  // llegan nulls. El COALESCE es la red para quien llame al servicio suelto.
  const db = fakePlatos();
  const redis = instalarFakeRedis();
  try {
    const res = await request(app)
      .put('/api/platos/77')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ precio: 21000 });

    assert.strictEqual(res.status, 200);
    const params = db.buscar('UPDATE platos').params;
    assert.strictEqual(params[1], PLATO.nombre, 'el nombre viene de la fila actual');
    assert.strictEqual(params[3], 21000);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});
