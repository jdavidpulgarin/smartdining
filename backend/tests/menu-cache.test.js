const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis, redisCaido } = require('./helpers/fake-redis');
const { invalidarMenu, CLAVE_CACHE, TTL_SEGUNDOS } = require('../src/services/menu.service');
const app = require('../server');

const SQL_MENU = 'obtener_menu_completo()';

/**
 * Menú con la misma forma que devuelve obtener_menu_completo()
 * (database/scripts/13_constructor.sql): categoría -> plato personalizable ->
 * pasos -> ingredientes, con un ingrediente agotado (disponible = false).
 */
function menuDeEjemplo() {
  return [
    {
      id_categoria: 2,
      categoria: 'Hamburguesas',
      descripcion: 'Arma la tuya',
      orden: 1,
      platos: [
        {
          id_plato: 7,
          nombre: 'Hamburguesa Smart',
          descripcion: 'Base para personalizar',
          precio: 32000,
          url_imagen: 'https://ejemplo/burger.jpg',
          tiempo_estimado: 15,
          personalizable: true,
          calorias: 650,
          pasos: [
            {
              id_paso: 1,
              nombre: 'Proteina',
              orden: 1,
              min_sel: 1,
              max_sel: 1,
              obligatorio: true,
              ingredientes: [
                {
                  id_ingrediente: 10,
                  nombre: 'Carne de res',
                  precio_extra: 0,
                  calorias: 250,
                  alergenos: null,
                  url_imagen: null,
                  disponible: true,
                },
                {
                  id_ingrediente: 11,
                  nombre: 'Pollo crispy',
                  precio_extra: 2000,
                  calorias: 300,
                  alergenos: 'gluten',
                  url_imagen: null,
                  disponible: false,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

/** Doble de base que contesta la función del constructor. */
function dbConMenu(menu = menuDeEjemplo()) {
  return instalarFakeDb((sql) => {
    if (sql.includes(SQL_MENU)) return { rows: [{ menu }] };
    return { rows: [] };
  });
}

test('GET /api/menu es publico, lee de la base y guarda en el cache con TTL de 60 s', async () => {
  const db = dbConMenu();
  const redis = instalarFakeRedis();
  try {
    const res = await request(app).get('/api/menu');

    assert.strictEqual(res.status, 200, 'no exige JWT');
    assert.strictEqual(db.todas(SQL_MENU).length, 1, 'la primera llamada va a la base');

    const guardado = redis.todas('setEx');
    assert.strictEqual(guardado.length, 1);
    assert.strictEqual(guardado[0].clave, CLAVE_CACHE);
    assert.strictEqual(guardado[0].ttl, 60);
    assert.strictEqual(TTL_SEGUNDOS, 60);
    assert.deepStrictEqual(redis.valorDe(CLAVE_CACHE), menuDeEjemplo());
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('la segunda llamada se sirve del cache y no vuelve a la base', async () => {
  const db = dbConMenu();
  const redis = instalarFakeRedis();
  try {
    const primera = await request(app).get('/api/menu');
    const segunda = await request(app).get('/api/menu');

    assert.strictEqual(primera.status, 200);
    assert.strictEqual(segunda.status, 200);
    assert.deepStrictEqual(segunda.body, primera.body, 'misma respuesta desde el cache');
    assert.strictEqual(db.todas(SQL_MENU).length, 1, 'la base se consulta una sola vez');
    assert.strictEqual(redis.todas('setEx').length, 1, 'solo se guarda una vez');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('con Redis caido el endpoint responde 200 desde la base', async () => {
  const db = dbConMenu();
  const redis = redisCaido();
  try {
    const primera = await request(app).get('/api/menu');
    const segunda = await request(app).get('/api/menu');

    assert.strictEqual(primera.status, 200, 'el cache nunca debe provocar un 500');
    assert.strictEqual(segunda.status, 200);
    assert.ok(Array.isArray(primera.body.categorias));
    assert.strictEqual(db.todas(SQL_MENU).length, 2, 'sin cache, cada llamada lee de la base');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('si el cache falla al leer o al guardar, la respuesta sale igual de la base', async () => {
  const db = dbConMenu();
  const redis = instalarFakeRedis({ falloEn: ['get', 'setEx'] });
  try {
    const res = await request(app).get('/api/menu');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.categorias[0].categoria, 'Hamburguesas');
    assert.strictEqual(db.todas(SQL_MENU).length, 1);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('la respuesta incluye pasos e ingredientes con disponible', async () => {
  const db = dbConMenu();
  const redis = instalarFakeRedis();
  try {
    const res = await request(app).get('/api/menu');

    assert.strictEqual(res.status, 200);
    const categoria = res.body.categorias[0];
    const plato = categoria.platos[0];

    // Claves del contrato anterior, intactas.
    assert.strictEqual(categoria.id_categoria, 2);
    assert.strictEqual(categoria.categoria, 'Hamburguesas');
    assert.strictEqual(plato.id_plato, 7);
    assert.strictEqual(plato.precio, 32000);

    // Lo que agrega el constructor.
    assert.strictEqual(plato.personalizable, true);
    assert.strictEqual(plato.calorias, 650);
    assert.strictEqual(plato.pasos.length, 1);

    const paso = plato.pasos[0];
    assert.strictEqual(paso.obligatorio, true);
    assert.strictEqual(paso.min_sel, 1);
    assert.strictEqual(paso.ingredientes.length, 2);

    // Los agotados se devuelven con disponible = false, no se filtran.
    const agotado = paso.ingredientes.find((i) => i.id_ingrediente === 11);
    assert.strictEqual(agotado.disponible, false);
    assert.strictEqual(agotado.precio_extra, 2000);
    assert.strictEqual(agotado.alergenos, 'gluten');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('invalidarMenu borra la clave cache:menu', async () => {
  const redis = instalarFakeRedis({ inicial: { [CLAVE_CACHE]: menuDeEjemplo() } });
  try {
    assert.ok(redis.tiene(CLAVE_CACHE));

    const borrado = await invalidarMenu();

    assert.strictEqual(borrado, true);
    assert.ok(!redis.tiene(CLAVE_CACHE), 'la clave ya no esta');
    assert.deepStrictEqual(redis.todas('del').map((o) => o.clave), [CLAVE_CACHE]);
  } finally {
    redis.restaurar();
  }
});

test('invalidarMenu no lanza con Redis caido ni cuando falla el DEL', async () => {
  const caido = redisCaido();
  try {
    assert.strictEqual(await invalidarMenu(), false);
  } finally {
    caido.restaurar();
  }

  const conFallo = instalarFakeRedis({ falloEn: ['del'] });
  try {
    assert.strictEqual(await invalidarMenu(), false);
  } finally {
    conFallo.restaurar();
  }
});

test('crear, actualizar y eliminar platos invalida el menu cacheado', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO platos')) return { rows: [{ id_plato: 7, nombre: 'Nuevo' }] };
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) {
      return { rows: [{ id_plato: 7, id_categoria: 2, nombre: 'Viejo', precio: 1000 }] };
    }
    if (sql.includes('UPDATE platos SET')) return { rows: [{ id_plato: 7, nombre: 'Editado' }] };
    if (sql.includes('DELETE FROM platos')) return { rows: [{ id_plato: 7 }] };
    return { rows: [] };
  });
  const redis = instalarFakeRedis();
  const admin = `Bearer ${tokenStaff(1, 'admin')}`;
  try {
    const creado = await request(app)
      .post('/api/platos')
      .set('Authorization', admin)
      .send({ nombre: 'Nuevo', precio: 1000, id_categoria: 2 });
    assert.strictEqual(creado.status, 201);

    const editado = await request(app)
      .put('/api/platos/7')
      .set('Authorization', admin)
      .send({ precio: 2000 });
    assert.strictEqual(editado.status, 200);

    const borrado = await request(app).delete('/api/platos/7').set('Authorization', admin);
    assert.strictEqual(borrado.status, 204);

    assert.deepStrictEqual(
      redis.todas('del').map((o) => o.clave),
      [CLAVE_CACHE, CLAVE_CACHE, CLAVE_CACHE],
      'las tres mutaciones invalidan el menu'
    );
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('crear, actualizar y eliminar categorias invalida el menu cacheado', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO categorias')) return { rows: [{ id_categoria: 2, nombre: 'Nueva' }] };
    if (sql.includes('SELECT * FROM categorias WHERE id_categoria')) {
      return { rows: [{ id_categoria: 2, nombre: 'Vieja', orden_visualizacion: 1, activo: true }] };
    }
    if (sql.includes('UPDATE categorias')) return { rows: [{ id_categoria: 2, nombre: 'Editada' }] };
    if (sql.includes('DELETE FROM categorias')) return { rows: [{ id_categoria: 2 }] };
    return { rows: [] };
  });
  const redis = instalarFakeRedis();
  const admin = `Bearer ${tokenStaff(1, 'admin')}`;
  try {
    const creada = await request(app)
      .post('/api/categorias')
      .set('Authorization', admin)
      .send({ nombre: 'Nueva' });
    assert.strictEqual(creada.status, 201);

    const editada = await request(app)
      .put('/api/categorias/2')
      .set('Authorization', admin)
      .send({ nombre: 'Editada' });
    assert.strictEqual(editada.status, 200);

    const borrada = await request(app).delete('/api/categorias/2').set('Authorization', admin);
    assert.strictEqual(borrada.status, 204);

    assert.strictEqual(redis.todas('del').length, 3, 'las tres mutaciones invalidan el menu');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('una consulta a la carta que no modifica nada no invalida el cache', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) {
      return { rows: [{ id_plato: 7, nombre: 'Hamburguesa Smart' }] };
    }
    return { rows: [] };
  });
  const redis = instalarFakeRedis();
  try {
    const res = await request(app).get('/api/platos/7');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(redis.todas('del').length, 0, 'GET no debe borrar el cache');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('si la base falla el endpoint no esconde el error tras el cache', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes(SQL_MENU)) throw new Error('no se pudo conectar a la base');
    return { rows: [] };
  });
  const redis = instalarFakeRedis();
  try {
    const res = await request(app).get('/api/menu');

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
    assert.strictEqual(redis.todas('setEx').length, 0, 'no se cachea una respuesta fallida');
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});
