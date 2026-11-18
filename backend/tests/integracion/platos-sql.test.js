const test = require('node:test');
const assert = require('node:assert');

/**
 * Crear y editar un plato contra PostgreSQL de verdad (ISSUE #132).
 *
 * Existe por un fallo que las pruebas con fake-db no podían ver, igual que
 * mesas-sql.test.js y reportes-sql.test.js: `platosService.crear` mandaba NULL
 * explícito en `tiempo_preparacion_estimado`, que es
 * `NOT NULL DEFAULT 15 CHECK (> 0)` (database/schema.sql:105). Un parámetro en
 * NULL **pisa el DEFAULT**, así que PostgreSQL rechazaba la fila con 23502 y
 * `POST /api/platos` sin tiempo daba **500**. El doble de la base contestaba una
 * fila cualquiera y la suite seguía en verde.
 *
 * De paso cubre lo otro del issue: `personalizable` y `calorias` se perdían en
 * silencio al crear (D-16 B solo las dejó en el PUT), y una categoría que no
 * existe tiene que ser un 409 con `motivo`, nunca un 500.
 *
 * Crea platos con nombres propios y los borra al final. Se SALTA sola si no hay
 * base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { abrirSonda } = require('../helpers/base-prueba');
const pool = require('../../src/config/db');
const platosService = require('../../src/services/platos.service');
const autorInexistente = require('../../src/services/autor-inexistente');

let sonda = null;
let hayBase = false;
let idCategoria = null;
const creados = [];

/** Un nombre que no choca con el seed ni con otra corrida. */
const nombreLibre = () => `ISSUE132 ${Date.now()}-${Math.floor(Math.random() * 10000)}`;

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const categoria = await sonda.query('SELECT id_categoria FROM categorias ORDER BY id_categoria LIMIT 1');
  idCategoria = categoria.rows[0] ? categoria.rows[0].id_categoria : null;
  hayBase = idCategoria !== null;
});

test.after(async () => {
  try {
    if (hayBase && creados.length) {
      await sonda.query('DELETE FROM platos WHERE id_plato = ANY($1::int[])', [creados]);
      // Lo que el DELETE no se lleva (review de #146): historial_precios no
      // tiene clave ajena hacia platos (es polimorfica: tipo + id_referencia),
      // asi que los cambios de precio de estas pruebas quedaban huerfanos; y
      // tr_auditar_platos anota cada INSERT, UPDATE y el propio DELETE en
      // auditoria_cambios. Se borran DESPUES de los platos, para llevarse
      // tambien la fila que deja el DELETE.
      await sonda.query(
        `DELETE FROM historial_precios WHERE tipo = 'plato' AND id_referencia = ANY($1::int[])`,
        [creados]
      );
      await sonda.query(
        `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'platos' AND registro_id = ANY($1::int[])`,
        [creados]
      );
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

test('issue-132: crear un plato SIN tiempo no da 500 y queda con el default de la columna', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  // Con el código viejo esto lanzaba 23502 (null value in column
  // "tiempo_preparacion_estimado" violates not-null constraint).
  assert.strictEqual(
    plato.tiempo_preparacion_estimado,
    platosService.TIEMPO_PREPARACION_POR_OMISION
  );
  assert.strictEqual(plato.tiempo_preparacion_estimado, 15, 'el DEFAULT de schema.sql:105');
  assert.strictEqual(plato.disponible, true);
});

test('issue-132: el tiempo enviado se respeta', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
    tiempo_preparacion_estimado: 40,
  });
  creados.push(plato.id_plato);

  assert.strictEqual(plato.tiempo_preparacion_estimado, 40);
});

test('issue-132: personalizable y calorias se GUARDAN al crear', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 32000,
    personalizable: true,
    calorias: 540,
  });
  creados.push(plato.id_plato);

  assert.strictEqual(plato.personalizable, true);
  assert.strictEqual(plato.calorias, 540);
});

test('issue-132: sin esos dos campos quedan los valores de la columna', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  assert.strictEqual(plato.personalizable, platosService.PERSONALIZABLE_POR_OMISION);
  assert.strictEqual(plato.personalizable, false, 'el DEFAULT de 13_constructor.sql:33');
  // calorias es nullable: null es "no se sabe", distinto de 0.
  assert.strictEqual(plato.calorias, null);
});

test('issue-132: calorias en 0 se guarda como 0, no como null', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
    calorias: 0,
  });
  creados.push(plato.id_plato);

  assert.strictEqual(plato.calorias, 0);
});

test('issue-132: una categoria que no existe es 409 con motivo, no 500', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  await assert.rejects(
    () => platosService.crear({ id_categoria: 999999, nombre: nombreLibre(), precio: 18000 }),
    (err) => {
      assert.strictEqual(err.status, 409, 'no es un 500');
      assert.strictEqual(err.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
      assert.strictEqual(err.message, platosService.MENSAJE_CATEGORIA_INEXISTENTE);
      return true;
    }
  );
});

test('issue-132: un precio negativo lo rechaza el CHECK, y no es un 500', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // El esquema de zod ya lo corta antes (400), pero el servicio tiene que
  // comportarse igual si alguien lo llama suelto: el CHECK de la columna da
  // 23514, que el manejador central traduce a 422. Nunca 500.
  await assert.rejects(
    () => platosService.crear({ id_categoria: idCategoria, nombre: nombreLibre(), precio: -5 }),
    (err) => {
      assert.strictEqual(err.code, '23514', `SQLSTATE inesperado: ${err.code}`);
      return true;
    }
  );
});

test('issue-132: un precio que no cabe en DECIMAL(10,2) da 22003, no 500', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  await assert.rejects(
    () => platosService.crear({
      id_categoria: idCategoria,
      nombre: nombreLibre(),
      precio: 99999999999,
    }),
    (err) => {
      assert.strictEqual(err.code, '22003', `SQLSTATE inesperado: ${err.code}`);
      return true;
    }
  );
});

test('issue-132: el servicio acepta datos PARCIALES sin dar 500', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // Por HTTP el controller manda la fila ya mezclada, pero llamar al servicio
  // con un solo campo daba 23502 (null en "nombre") y por tanto un 500. Las
  // columnas NOT NULL van con COALESCE: null solo puede querer decir "no lo
  // cambies".
  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
    tiempo_preparacion_estimado: 30,
  });
  creados.push(plato.id_plato);

  const cambiado = await platosService.actualizar(plato.id_plato, { precio: 21000 }, { idUsuario: 1 });

  assert.strictEqual(cambiado.precio, 21000);
  assert.strictEqual(cambiado.nombre, plato.nombre, 'el nombre no se perdio');
  assert.strictEqual(cambiado.tiempo_preparacion_estimado, 30);
  assert.strictEqual(cambiado.id_categoria, idCategoria);
});

test('issue-132: actualizar con una categoria inexistente tambien es 409 con motivo', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  await assert.rejects(
    () => platosService.actualizar(plato.id_plato, { id_categoria: 999999 }, { idUsuario: 1 }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
      return true;
    }
  );
});

test('issue-132: el plato creado se puede leer tal como quedo', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const nombre = nombreLibre();
  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre,
    precio: 25000,
    personalizable: true,
    calorias: 300,
  });
  creados.push(plato.id_plato);

  const leido = await platosService.obtenerPorId(plato.id_plato);
  assert.strictEqual(leido.nombre, nombre);
  assert.strictEqual(leido.precio, 25000);
  assert.strictEqual(leido.tiempo_preparacion_estimado, 15);
  assert.strictEqual(leido.personalizable, true);
  assert.strictEqual(leido.calorias, 300);
});

/**
 * El 23503 del HISTORIAL de precios, no el de la categoria (review de #139).
 *
 * Actualizar un plato dispara `tr_historial_precio_plato`
 * (database/scripts/26_configuracion.sql), que escribe en `historial_precios`
 * con el autor que sale de `app.id_usuario`. Esa tabla tiene su propia
 * `fk_historial_precios_usuario` contra `usuarios`: con un id que no existe, el
 * UPDATE falla con 23503 y ANTES salia traducido como "Esa categoria no
 * existe", que manda a buscar el problema al sitio equivocado.
 */
test('review-139: el 23503 del historial NO sale como categoria_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  // Un id de usuario que seguro no existe: es lo que el servicio pone en
  // app.id_usuario, y de ahi lo toma el trigger.
  const { rows: libres } = await sonda.query(
    'SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS inexistente FROM usuarios'
  );
  const idFantasma = Number(libres[0].inexistente);

  await assert.rejects(
    // El precio TIENE que cambiar: el trigger solo escribe cuando cambia
    // (WHEN OLD.precio IS DISTINCT FROM NEW.precio).
    () => platosService.actualizar(plato.id_plato, { precio: 19500 }, { idUsuario: idFantasma }),
    (err) => {
      // Lo que arregla este cambio: NO se disfraza de problema de categoria.
      // (Desde el review de #144 trae su propio motivo, 'autor_inexistente';
      // eso lo fija la prueba de mas abajo. Aqui solo se exige que no sea el
      // de la categoria, que era el fallo original.)
      assert.notStrictEqual(err.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
      assert.notStrictEqual(err.message, platosService.MENSAJE_CATEGORIA_INEXISTENTE);
      return true;
    }
  );

  // Y el plato se quedo como estaba: la transaccion se deshizo.
  const leido = await platosService.obtenerPorId(plato.id_plato);
  assert.strictEqual(leido.precio, 18000);
});

test('review-139: con un usuario que existe, el mismo cambio de precio entra', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  const { rows: usuarios } = await sonda.query(
    'SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1'
  );
  const cambiado = await platosService.actualizar(
    plato.id_plato,
    { precio: 19500 },
    { idUsuario: usuarios[0].id_usuario }
  );

  assert.strictEqual(cambiado.precio, 19500);
  // Y el historial quedo con su autor.
  const { rows: historial } = await sonda.query(
    `SELECT id_usuario, precio_anterior, precio_nuevo FROM historial_precios
      WHERE tipo = 'plato' AND id_referencia = $1 ORDER BY id DESC LIMIT 1`,
    [plato.id_plato]
  );
  assert.strictEqual(historial[0].id_usuario, usuarios[0].id_usuario);
  assert.strictEqual(Number(historial[0].precio_anterior), 18000);
  assert.strictEqual(Number(historial[0].precio_nuevo), 19500);
});

/**
 * El 23503 del AUTOR, contra PostgreSQL real (review de #144).
 *
 * Mismo escenario que la prueba de arriba —el usuario del token ya no existe—,
 * pero ahora el error SÍ se traduce: 409 con `motivo: 'autor_inexistente'` y un
 * mensaje que dice que hay que volver a iniciar sesión. Antes subía pelado y
 * salía como el 409 genérico de clave ajena.
 */
test('review-144: el 23503 del historial sale como 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  const { rows: libres } = await sonda.query(
    'SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS inexistente FROM usuarios'
  );
  const idFantasma = Number(libres[0].inexistente);

  await assert.rejects(
    () => platosService.actualizar(plato.id_plato, { precio: 19500 }, { idUsuario: idFantasma }),
    (err) => {
      assert.strictEqual(err.status, 409, 'traducido, no el 500 ni el generico');
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y el plato se quedo como estaba: la transaccion se deshizo.
  const leido = await platosService.obtenerPorId(plato.id_plato);
  assert.strictEqual(leido.precio, 18000);
});

test('review-144: la FK del AUTOR y la de la CATEGORIA no se confunden', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const plato = await platosService.crear({
    id_categoria: idCategoria,
    nombre: nombreLibre(),
    precio: 18000,
  });
  creados.push(plato.id_plato);

  // Categoria inexistente con un usuario que SI existe: el otro motivo.
  const { rows: usuarios } = await sonda.query(
    'SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1'
  );
  await assert.rejects(
    () => platosService.actualizar(
      plato.id_plato, { id_categoria: 999999 }, { idUsuario: usuarios[0].id_usuario }
    ),
    (err) => {
      assert.strictEqual(err.motivo, platosService.MOTIVO_CATEGORIA_INEXISTENTE);
      return true;
    }
  );
});
