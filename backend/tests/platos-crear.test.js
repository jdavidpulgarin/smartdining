const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const platosService = require('../src/services/platos.service');
const autorInexistente = require('../src/services/autor-inexistente');

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

/**
 * @param {{error?: Error, fallaEn?: string}} opciones
 *   `fallaEn` es el fragmento de SQL con el que el doble lanza `error`
 *   (por omision, el INSERT).
 */
function fakePlatos({ error = null, fallaEn = 'INSERT INTO platos' } = {}) {
  return instalarFakeDb((sql) => {
    if (error && sql.includes(fallaEn)) throw error;
    if (sql.includes('INSERT INTO platos')) return { rows: [PLATO] };
    if (sql.includes('FROM platos WHERE id_plato')) return { rows: [PLATO] };
    if (sql.includes('UPDATE platos')) return { rows: [PLATO] };
    return { rows: [] };
  });
}

/** Un 23503 de PostgreSQL con el nombre del constraint que choco. */
function errorDeFk(constraint) {
  const err = new Error(`viola la llave foranea ${constraint}`);
  err.code = '23503';
  err.constraint = constraint;
  return err;
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
  const db = fakePlatos({ error: errorDeFk(platosService.FK_CATEGORIA) });
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

// ---------------------------------------------------------------------------
// Solo la FK de la categoria se traduce (review de #139)
//
// Actualizar un plato no tiene UNA sola FK en juego: el trigger
// tr_historial_precio_plato escribe en historial_precios, que tiene su propia
// fk_historial_precios_usuario contra usuarios. Si el usuario del token ya no
// existe, ese 23503 salia como "Esa categoria no existe" y mandaba a buscar el
// problema al sitio equivocado.
// ---------------------------------------------------------------------------

test('review-139: traducirCategoria mira el NOMBRE del constraint', () => {
  const traducido = platosService.traducirCategoria(errorDeFk(platosService.FK_CATEGORIA));

  assert.strictEqual(traducido.status, 409);
  assert.strictEqual(traducido.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
  assert.strictEqual(traducido.message, platosService.MENSAJE_CATEGORIA_INEXISTENTE);
});

test('review-139: la FK del historial de precios NO se traduce', () => {
  const err = errorDeFk('fk_historial_precios_usuario');
  const traducido = platosService.traducirCategoria(err);

  // Sube tal cual: el manejador central lo da como el 409 generico de clave
  // ajena, que es lo correcto cuando no se sabe cual choco.
  assert.strictEqual(traducido, err, 'es el MISMO error, no uno traducido');
  assert.strictEqual(traducido.motivo, undefined);
  assert.strictEqual(traducido.status, undefined);
  assert.strictEqual(traducido.code, '23503');
});

test('review-139: ninguna otra FK ni otro codigo se confunde con la categoria', () => {
  for (const err of [
    errorDeFk('fk_recetas_plato_insumo'),
    errorDeFk('fk_detalles_pedido_plato'),
    errorDeFk(undefined),
    Object.assign(new Error('unique'), { code: '23505', constraint: platosService.FK_CATEGORIA }),
    Object.assign(new Error('check'), { code: '23514' }),
    new Error('pelado'),
  ]) {
    assert.strictEqual(
      platosService.traducirCategoria(err),
      err,
      String(err.constraint || err.code || err.message)
    );
  }
  assert.strictEqual(platosService.traducirCategoria(null), null);
});

test('review-139: por la ruta, el 23503 del historial NO se disfraza de categoria', async () => {
  // Es el caso de verdad: un admin con un token valido cuyo usuario ya se
  // borro edita el precio de un plato. El trigger del historial choca contra
  // usuarios, y eso NO es un problema de categoria. Desde el review de #144
  // tiene su propio motivo (ver las pruebas de autor_inexistente, abajo); lo
  // que esta prueba fija es que NUNCA sale como el de la categoria.
  const db = fakePlatos({
    error: errorDeFk('fk_historial_precios_usuario'),
    fallaEn: 'UPDATE platos',
  });
  const redis = instalarFakeRedis();
  try {
    const res = await request(app)
      .put('/api/platos/77')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ precio: 21000 });

    assert.strictEqual(res.status, 409);
    assert.notStrictEqual(res.body.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
    assert.notStrictEqual(res.body.error, platosService.MENSAJE_CATEGORIA_INEXISTENTE);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('review-139: y el de la categoria por el PUT sigue siendo el suyo', async () => {
  const db = fakePlatos({
    error: errorDeFk(platosService.FK_CATEGORIA),
    fallaEn: 'UPDATE platos',
  });
  const redis = instalarFakeRedis();
  try {
    const res = await request(app)
      .put('/api/platos/77')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ id_categoria: 999999 });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El 23503 del AUTOR: "tu usuario ya no existe" (review de #144)
//
// Varias escrituras anotan quien las hizo, con el id del JWT. Si ese usuario se
// borro mientras la sesion seguia viva, el trigger del historial de precios
// choca contra usuarios y PostgreSQL devuelve 23503. Antes salia como el 409
// generico de clave ajena, sin motivo: quien esta en el panel no se enteraba de
// que el problema era su propia sesion.
// ---------------------------------------------------------------------------

test('review-144: el helper traduce las FK del autor y nada mas', () => {
  for (const fk of autorInexistente.FK_AUTOR) {
    const traducido = autorInexistente.traducirAutorInexistente(errorDeFk(fk));
    assert.strictEqual(traducido.status, 409, fk);
    assert.strictEqual(traducido.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE, fk);
    assert.strictEqual(traducido.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE, fk);
  }

  // Otra FK, u otro codigo, no son este caso: devuelve null para que quien
  // llama siga con su propia traduccion.
  assert.strictEqual(autorInexistente.traducirAutorInexistente(errorDeFk(platosService.FK_CATEGORIA)), null);
  assert.strictEqual(autorInexistente.traducirAutorInexistente(errorDeFk('fk_detalles_pedido_plato')), null);
  assert.strictEqual(autorInexistente.traducirAutorInexistente(errorDeFk(undefined)), null);
  assert.strictEqual(
    autorInexistente.traducirAutorInexistente(Object.assign(new Error('u'), { code: '23505', constraint: autorInexistente.FK_AUTOR[0] })),
    null
  );
  assert.strictEqual(autorInexistente.traducirAutorInexistente(null), null);
});

test('review-144: el mensaje dice que hacer y no nombra tablas', () => {
  const texto = autorInexistente.MENSAJE_AUTOR_INEXISTENTE;

  assert.match(texto, /vuelve a iniciar sesión/i, 'dice que hacer');
  assert.ok(!/historial|constraint|23503|fk_/i.test(texto), 'no nombra el detalle interno');
});

test('review-144: en un plato, el autor y la categoria son errores distintos', () => {
  const autor = platosService.traducirFkDePlato(errorDeFk('fk_historial_precios_usuario'));
  const categoria = platosService.traducirFkDePlato(errorDeFk(platosService.FK_CATEGORIA));

  assert.strictEqual(autor.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
  assert.strictEqual(categoria.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
  assert.notStrictEqual(autor.message, categoria.message);
});

test('review-144: otra FK en un plato sigue subiendo sin traducir', () => {
  const err = errorDeFk('fk_detalles_pedido_plato');

  assert.strictEqual(platosService.traducirFkDePlato(err), err);
});

test('review-144: por la ruta, el PUT de un plato da 409 autor_inexistente', async () => {
  // El caso de verdad: un admin con token valido cuyo usuario ya se borro edita
  // el precio. Antes: 409 generico sin motivo.
  const db = fakePlatos({
    error: errorDeFk('fk_historial_precios_usuario'),
    fallaEn: 'UPDATE platos',
  });
  const redis = instalarFakeRedis();
  try {
    const res = await request(app)
      .put('/api/platos/77')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ precio: 21000 });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
    assert.strictEqual(res.body.error, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('review-144 (medido): al CREAR un plato ese 23503 no puede salir', async () => {
  // El doble puede lanzar lo que se le pida, pero PostgreSQL no: el trigger
  // tr_historial_precio_plato es AFTER UPDATE OF precio, asi que un INSERT
  // nunca escribe en historial_precios y no hay autor que validar. Comprobado
  // contra PostgreSQL de verdad: un POST /platos -y un INSERT a pelo con
  // app.id_usuario apuntando a un usuario que no existe- pasan sin error.
  //
  // Antes esta prueba afirmaba lo contrario con un error inventado, asi que
  // documentaba un caso que la base no produce. Lo que se vigila ahora es la
  // sentencia: el POST inserta y no toca el historial de precios. La traduccion
  // del autor se prueba por el PUT, que es donde el caso existe de verdad.
  const db = fakePlatos({});
  const redis = instalarFakeRedis();
  try {
    const res = await crear(CUERPO_MINIMO);

    assert.strictEqual(res.status, 201);
    assert.ok(insert(db), 'el POST inserta el plato');
    assert.strictEqual(
      db.todas('historial_precios').length,
      0,
      'y no escribe el historial de precios: eso es trabajo del trigger del UPDATE'
    );
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-23: url_imagen acepta una URL http(s) o una ruta /imagenes/<uuid>.webp
// ---------------------------------------------------------------------------

const UUID_IMAGEN = '0f8fad5b-d9cb-469f-a165-70867728950e';

for (const url of ['https://cdn.ejemplo.com/arepa.jpg', 'http://localhost:4000/x.png', `/imagenes/${UUID_IMAGEN}.webp`]) {
  test(`d-23: plato con url_imagen ${url} -> 201 (POST) y 200 (PUT), y se guarda tal cual`, async () => {
    const db = fakePlatos();
    const redis = instalarFakeRedis();
    try {
      const res = await crear({ ...CUERPO_MINIMO, url_imagen: url });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      assert.strictEqual(insert(db).params[4], url);

      const put = await request(app)
        .put('/api/platos/77')
        .set('Authorization', `Bearer ${admin()}`)
        .send({ url_imagen: url });
      assert.strictEqual(put.status, 200, JSON.stringify(put.body));
      assert.strictEqual(db.buscar('UPDATE platos').params[4], url);
    } finally {
      redis.restaurar();
      db.restaurar();
    }
  });
}

for (const [caso, url] of [
  ['con ..', '/imagenes/../x.webp'],
  ['con .. y uuid', `/imagenes/../${UUID_IMAGEN}.webp`],
  ['de otra carpeta', `/otra/${UUID_IMAGEN}.webp`],
  ['con otra extensión', `/imagenes/${UUID_IMAGEN}.png`],
  ['sin uuid', '/imagenes/foto.webp'],
  ['con el uuid en mayúsculas', `/imagenes/${UUID_IMAGEN.toUpperCase()}.webp`],
  ['con una subcarpeta', `/imagenes/a/${UUID_IMAGEN}.webp`],
  ['con algo detrás', `/imagenes/${UUID_IMAGEN}.webp?x=1`],
  ['relativa sin barra', `imagenes/${UUID_IMAGEN}.webp`],
  ['javascript:', 'javascript:alert(1)'],
  ['ftp:', 'ftp://ejemplo.com/a.jpg'],
  ['de más de 255', `https://cdn.ejemplo.com/${'a'.repeat(250)}.jpg`],
]) {
  test(`d-23: plato con url_imagen ${caso} -> 400 y no se escribe`, async () => {
    const db = fakePlatos();
    const redis = instalarFakeRedis();
    try {
      const res = await crear({ ...CUERPO_MINIMO, url_imagen: url });
      assert.strictEqual(res.status, 400, `${url} -> ${res.status}`);
      assert.strictEqual(insert(db), undefined);
    } finally {
      redis.restaurar();
      db.restaurar();
    }
  });
}
