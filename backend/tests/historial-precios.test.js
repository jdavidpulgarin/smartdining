const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');

// D-16 parte B: el autor de los cambios de precio.
//
// Los triggers tr_historial_precio_plato y tr_historial_precio_ingrediente
// (database/scripts/26_configuracion.sql) escriben en historial_precios y sacan
// el autor de app.id_usuario con fn_usuario_de_sesion(). Ese valor se fija con
// set_config(..., true), que vive SOLO hasta el fin de la transaccion.
//
// Lo que se vigila aqui, que es la parte que le toca al backend:
//   - el set_config y el UPDATE van en la MISMA transaccion y en ese orden. Con
//     pool.query suelto podian salir por conexiones distintas del pool y el
//     historial quedaba con id_usuario NULL;
//   - el id sale del JWT, nunca del cuerpo;
//   - is_local = true, para que el valor no se filtre a la siguiente peticion
//     que use esa conexion.
//
// Que la fila aparezca de verdad en historial_precios lo decide la base, y se
// comprobo contra el SQL real en una base desechable (no se puede con el doble:
// contestaria lo que se le pida).

const PLATO = {
  id_plato: 7,
  id_categoria: 2,
  nombre: 'Bandeja paisa',
  descripcion: null,
  precio: 28000,
  url_imagen: null,
  disponible: true,
  tiempo_preparacion_estimado: 20,
  personalizable: false,
  calorias: null,
};

const INGREDIENTE = {
  id_ingrediente: 11,
  id_paso: 3,
  nombre: 'Chicharrón',
  precio_extra: 2000,
  calorias: 300,
  alergenos: [],
  url_imagen: null,
  disponible: true,
};

const admin = () => tokenStaff(1, 'admin');

/** Doble para PUT /api/platos/:id. */
function fakePlato(plato = PLATO) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) return { rows: [plato] };
    if (sql.includes('UPDATE platos SET')) {
      return {
        rows: [{
          ...plato,
          precio: params[3] ?? plato.precio,
          personalizable: params[7] ?? plato.personalizable,
          calorias: params[8] ?? plato.calorias,
        }],
      };
    }
    return undefined;
  });
}

/** Doble para PUT /api/ingredientes/:id. */
function fakeIngrediente(ingrediente = INGREDIENTE) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM ingredientes i WHERE i.id_ingrediente')) return { rows: [ingrediente] };
    if (sql.includes('UPDATE ingredientes')) {
      return { rows: [{ ...ingrediente, precio_extra: params[1] ?? ingrediente.precio_extra }] };
    }
    return undefined;
  });
}

const ponerPlato = (cuerpo, token = admin()) => request(app)
  .put(`/api/platos/${PLATO.id_plato}`)
  .set('Authorization', `Bearer ${token}`)
  .send(cuerpo);

const ponerIngrediente = (cuerpo, token = admin()) => request(app)
  .put(`/api/ingredientes/${INGREDIENTE.id_ingrediente}`)
  .set('Authorization', `Bearer ${token}`)
  .send(cuerpo);

/** Los SQL ejecutados, en orden, para afirmar sobre la secuencia. */
const secuencia = (db) => db.ejecutadas.map((q) => q.sql);

// ---------------------------------------------------------------------------
// Platos
// ---------------------------------------------------------------------------

test('d-16b: el UPDATE de un plato va en una transaccion', async () => {
  const db = fakePlato();
  try {
    const res = await ponerPlato({ precio: 30000 });

    assert.strictEqual(res.status, 200);
    assert.ok(db.buscar('BEGIN'), 'hay transaccion');
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: el set_config va DENTRO y ANTES del UPDATE del plato', async () => {
  const db = fakePlato();
  try {
    await ponerPlato({ precio: 30000 });

    const sqls = secuencia(db);
    const begin = sqls.findIndex((s) => s.includes('BEGIN'));
    const config = sqls.findIndex((s) => s.includes('set_config'));
    const update = sqls.findIndex((s) => s.includes('UPDATE platos SET'));
    const commit = sqls.findIndex((s) => s.includes('COMMIT'));

    assert.ok(begin >= 0 && config > begin, 'el set_config va dentro de la transaccion');
    assert.ok(update > config, 'y antes del UPDATE: si no, el trigger no ve el autor');
    assert.ok(commit > update);
  } finally {
    db.restaurar();
  }
});

test('d-16b: el autor del cambio de precio sale del JWT', async () => {
  const db = fakePlato();
  try {
    await ponerPlato({ precio: 30000 }, tokenStaff(42, 'admin'));

    const config = db.buscar('set_config');
    assert.ok(config);
    assert.strictEqual(config.params[0], 'app.id_usuario');
    assert.strictEqual(config.params[1], '42', 'el id del token, no del cuerpo');
  } finally {
    db.restaurar();
  }
});

test('d-16b: el set_config es LOCAL a la transaccion', async () => {
  const db = fakePlato();
  try {
    await ponerPlato({ precio: 30000 });

    // El tercer argumento en true (is_local): sin eso el valor se quedaria en
    // la conexion y la siguiente peticion del pool heredaria el autor anterior.
    assert.ok(db.buscar('set_config').sql.includes('true'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: el cuerpo no puede decidir el autor', async () => {
  const db = fakePlato();
  try {
    // platoSchema es estricto en lo que acepta: un id_usuario en el cuerpo no
    // es un campo del plato y no llega al set_config.
    await ponerPlato({ precio: 30000, id_usuario: 999 }, tokenStaff(7, 'admin'));

    const config = db.buscar('set_config');
    assert.strictEqual(config.params[1], '7');
  } finally {
    db.restaurar();
  }
});

test('d-16b: si el UPDATE del plato falla, se hace ROLLBACK', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) return { rows: [PLATO] };
    if (sql.includes('UPDATE platos SET')) throw new Error('la base no responde');
    return undefined;
  });
  try {
    const res = await ponerPlato({ precio: 30000 });

    assert.strictEqual(res.status, 500);
    assert.ok(db.buscar('ROLLBACK'));
    assert.ok(!db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

test('d-16b: un plato que no existe sigue siendo 404', async () => {
  const db = instalarFakeDb((sql) =>
    (sql.includes('SELECT * FROM platos WHERE id_plato') ? { rows: [] } : undefined)
  );
  try {
    assert.strictEqual((await ponerPlato({ precio: 30000 })).status, 404);
    assert.ok(!db.buscar('BEGIN'), 'ni se abre la transaccion');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Ingredientes
// ---------------------------------------------------------------------------

test('d-16b: el set_config va al inicio de la transaccion del ingrediente', async () => {
  const db = fakeIngrediente();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await ponerIngrediente({ nombre: 'Chicharrón', precio_extra: 2500 });

    assert.strictEqual(res.status, 200);
    const sqls = secuencia(db);
    const begin = sqls.findIndex((s) => s.includes('BEGIN'));
    const config = sqls.findIndex((s) => s.includes('set_config'));
    const select = sqls.findIndex((s) => s.includes('FROM ingredientes i WHERE i.id_ingrediente'));
    const update = sqls.findIndex((s) => s.includes('UPDATE ingredientes'));

    assert.ok(config > begin, 'dentro de la transaccion');
    assert.ok(config < select, 'al inicio, antes de leer la fila');
    assert.ok(update > config, 'y antes del UPDATE');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('d-16b: el autor del cambio de precio_extra sale del JWT', async () => {
  const db = fakeIngrediente();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await ponerIngrediente(
      { nombre: 'Chicharrón', precio_extra: 2500 },
      tokenStaff(13, 'admin')
    );

    const config = db.buscar('set_config');
    assert.strictEqual(config.params[0], 'app.id_usuario');
    assert.strictEqual(config.params[1], '13');
    assert.ok(config.sql.includes('true'), 'is_local');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('d-16b: el PATCH de disponible no rompe por el set_config', async () => {
  // El otro llamador de actualizarIngrediente: agotar o reponer. No cambia el
  // precio, asi que el historial no recibe nada, pero la transaccion es la misma.
  const db = fakeIngrediente();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await request(app)
      .patch(`/api/ingredientes/${INGREDIENTE.id_ingrediente}/disponible`)
      .set('Authorization', `Bearer ${admin()}`)
      .send({ disponible: false });

    assert.strictEqual(res.status, 200);
    assert.ok(db.buscar('UPDATE ingredientes'));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// personalizable y calorias (D-16 parte B, punto D)
// ---------------------------------------------------------------------------

test('d-16b: el PUT de un plato acepta personalizable y calorias', async () => {
  const db = fakePlato();
  try {
    const res = await ponerPlato({ personalizable: true, calorias: 540 });

    assert.strictEqual(res.status, 200);
    const update = db.buscar('UPDATE platos SET');
    assert.strictEqual(update.params[7], true, 'personalizable');
    assert.strictEqual(update.params[8], 540, 'calorias');
  } finally {
    db.restaurar();
  }
});

test('d-16b: el POST de un plato tambien', async () => {
  const db = instalarFakeDb((sql) =>
    (sql.includes('INSERT INTO platos') ? { rows: [{ ...PLATO, personalizable: true, calorias: 540 }] } : undefined)
  );
  try {
    const res = await request(app)
      .post('/api/platos')
      .set('Authorization', `Bearer ${admin()}`)
      .send({
        nombre: 'Bowl',
        precio: 25000,
        id_categoria: 2,
        personalizable: true,
        calorias: 540,
      });

    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  } finally {
    db.restaurar();
  }
});

test('d-16b: son opcionales: sin ellos nada cambia', async () => {
  const db = fakePlato();
  try {
    const res = await ponerPlato({ precio: 30000 });

    assert.strictEqual(res.status, 200);
    const update = db.buscar('UPDATE platos SET');
    // El controller mezcla la fila actual con lo enviado, asi que llega el
    // valor que ya tenia el plato: el PUT no lo pierde. El COALESCE del UPDATE
    // es la segunda red, para cuando el valor llegue en null.
    assert.strictEqual(update.params[7], PLATO.personalizable);
    assert.strictEqual(update.params[8], PLATO.calorias);
  } finally {
    db.restaurar();
  }
});

test('d-16b: calorias admite null ("no se sabe"), que no es 0', async () => {
  const db = fakePlato({ ...PLATO, calorias: 800 });
  try {
    assert.strictEqual((await ponerPlato({ calorias: null })).status, 200);
    assert.strictEqual((await ponerPlato({ calorias: 0 })).status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16b: calorias negativas o no enteras son 400', async () => {
  const db = fakePlato();
  try {
    for (const calorias of [-1, 1.5, 'muchas']) {
      assert.strictEqual((await ponerPlato({ calorias })).status, 400, JSON.stringify(calorias));
    }
    assert.ok(!db.buscar('UPDATE platos SET'), 'no se escribio nada');
  } finally {
    db.restaurar();
  }
});

test('d-16b: personalizable tiene que ser booleano', async () => {
  const db = fakePlato();
  try {
    for (const valor of ['true', 1, null]) {
      assert.strictEqual((await ponerPlato({ personalizable: valor })).status, 400, JSON.stringify(valor));
    }
  } finally {
    db.restaurar();
  }
});
