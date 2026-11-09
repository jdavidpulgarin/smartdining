const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const inventarioService = require('../src/services/inventario.service');
const inventarioCtrl = require('../src/controllers/inventario.controller');

// D-17 PR 2: inventario del panel (insumos, movimientos y recetas).
//
// Las tablas, la funcion y las vistas son de 27_inventario.sql. Lo que se
// vigila aqui es el reparto: el backend expone el CRUD, valida lo que la base
// rechazaria con un 422 opaco y NO replica ninguna regla de inventario.
//
//   - stock_actual no se escribe nunca desde el backend: solo con movimientos,
//     y el stock inicial de un insumo nuevo entra como movimiento 'entrada'
//     (la regla del libro es SUM(cantidad) = stock_actual);
//   - el autor del movimiento sale del JWT, con set_config en la MISMA
//     transaccion (fn_usuario_de_sesion);
//   - ?estado=bajo lee la vista v_stock_bajo, no una comparacion propia;
//   - un insumo no se borra, se desactiva;
//   - la receta se reemplaza completa, en una transaccion;
//   - los errores conocidos de la base salen como 409/400 con motivo, no 500.

const admin = () => tokenStaff(1, 'admin');

const INSUMO = {
  id_insumo: 12,
  nombre: 'Queso costeño',
  unidad: 'g',
  stock_actual: 450,
  stock_minimo: 500,
  activo: true,
  bajo: true,
  agotado: false,
  actualizado_en: '2026-11-08T12:00:00.000Z',
};

const MOVIMIENTO = {
  id: 44,
  id_insumo: 12,
  tipo: 'entrada',
  cantidad: 2000,
  stock_resultante: 2450,
  id_detalle: null,
  id_usuario: 1,
  motivo: 'Compra del proveedor',
  creado_en: '2026-11-08T12:00:00.000Z',
};

/** Un error de pg con su SQLSTATE. */
function errorDeLaBase(code, message = 'error de la base') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {{responder?: Function}} opciones Un responder que gana al de serie.
 */
function fakeInventario({ responder = () => undefined } = {}) {
  return instalarFakeDb((sql, params) => {
    const propio = responder(sql, params);
    if (propio !== undefined) return propio;

    if (sql.includes('FROM v_stock_bajo')) {
      return {
        rows: [
          { id_insumo: 3, nombre: 'Masa', unidad: 'porcion', stock_actual: 0, stock_minimo: 10, agotado: true },
          { id_insumo: 12, nombre: 'Queso costeño', unidad: 'g', stock_actual: 450, stock_minimo: 500, agotado: false },
        ],
      };
    }
    if (sql.includes('FROM insumos s WHERE s.id_insumo')) return { rows: [INSUMO] };
    if (sql.includes('FROM insumos s')) return { rows: [INSUMO] };
    if (sql.includes('INSERT INTO insumos')) return { rows: [{ id_insumo: 12 }] };
    if (sql.includes('UPDATE insumos')) return { rows: [{ id_insumo: 12 }] };
    if (sql.includes('registrar_movimiento_inventario')) return { rows: [MOVIMIENTO] };
    if (sql.includes('FROM movimientos_inventario')) return { rows: [MOVIMIENTO] };
    if (sql.includes('FROM recetas_plato r')) {
      return {
        rows: [{ id_insumo: 3, nombre: 'Masa', unidad: 'porcion', cantidad: 1, stock_actual: 40, activo: true }],
      };
    }
    if (sql.includes('FROM recetas_ingrediente r')) {
      return {
        rows: [{ id_insumo: 5, nombre: 'Quinoa', unidad: 'g', cantidad: 80, stock_actual: 900, activo: true }],
      };
    }
    if (sql.includes('FROM platos WHERE id_plato')) return { rows: [{ '1': 1 }] };
    if (sql.includes('FROM ingredientes WHERE id_ingrediente')) return { rows: [{ '1': 1 }] };
    return { rows: [] };
  });
}

const get = (url) => request(app).get(url).set('Authorization', `Bearer ${admin()}`);
const post = (url, cuerpo) => request(app).post(url).set('Authorization', `Bearer ${admin()}`).send(cuerpo);
const put = (url, cuerpo) => request(app).put(url).set('Authorization', `Bearer ${admin()}`).send(cuerpo);

// ---------------------------------------------------------------------------
// GET /api/inventario/insumos
// ---------------------------------------------------------------------------

test('d-17b: la lista de insumos sale de la tabla, con bajo y agotado', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/inventario/insumos');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.insumos[0], INSUMO);
    // bajo y agotado se calculan EN SQL, para que la señal sea la misma que la
    // de v_stock_bajo y no dos comparaciones en dos lenguajes.
    const consulta = db.buscar('FROM insumos s');
    assert.ok(consulta.sql.includes('s.stock_actual <= s.stock_minimo'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: estado=bajo lee la VISTA v_stock_bajo', async () => {
  // Es la definicion de "bajo" de la base: asi el panel y el aviso
  // inventario:alerta hablan exactamente de lo mismo.
  const db = fakeInventario();
  try {
    const res = await get('/api/inventario/insumos?estado=bajo');

    assert.strictEqual(res.status, 200);
    assert.ok(db.buscar('FROM v_stock_bajo'), 'se leyo la vista');
    assert.ok(!db.buscar('FROM insumos s'), 'y no la tabla');
    assert.strictEqual(res.body.insumos[0].agotado, true, 'lo agotado va primero');
  } finally {
    db.restaurar();
  }
});

test('d-17b: los NUMERIC salen como numeros JSON, no como texto', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/inventario/insumos');

    assert.strictEqual(typeof res.body.insumos[0].stock_actual, 'number');
    assert.strictEqual(typeof res.body.insumos[0].stock_minimo, 'number');
  } finally {
    db.restaurar();
  }
});

test('d-17b: un filtro que no esta en la lista es 400, no se ignora', async () => {
  // Un ?estado=bajos que devolviera todo haria creer al panel que no hay
  // faltantes.
  const db = fakeInventario();
  try {
    for (const url of [
      '/api/inventario/insumos?estado=bajos',
      '/api/inventario/insumos?activo=si',
      '/api/inventario/insumos?limite=0',
      '/api/inventario/insumos?limite=-5',
      '/api/inventario/insumos?orden=nombre',
    ]) {
      const res = await get(url);
      assert.strictEqual(res.status, 400, url);
    }
  } finally {
    db.restaurar();
  }
});

test('d-17b: activo y q llegan a la consulta como parametros', async () => {
  const db = fakeInventario();
  try {
    await get('/api/inventario/insumos?activo=false&q=queso');

    const consulta = db.buscar('FROM insumos s');
    assert.strictEqual(consulta.params[0], false);
    assert.strictEqual(consulta.params[1], 'queso');
  } finally {
    db.restaurar();
  }
});

test('d-17b: el limite se acota al tope, no se pasa tal cual', async () => {
  const db = fakeInventario();
  try {
    await get('/api/inventario/insumos?limite=9999');

    assert.strictEqual(db.buscar('FROM insumos s').params[2], inventarioService.MAX_INSUMOS);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// GET /api/inventario/insumos/:id
// ---------------------------------------------------------------------------

test('d-17b: un insumo se devuelve con su id', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/inventario/insumos/12');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.insumo, INSUMO);
  } finally {
    db.restaurar();
  }
});

test('d-17b: un insumo que no existe es 404 y un id raro 400', async () => {
  const db = fakeInventario({ responder: (sql) => (sql.includes('FROM insumos s WHERE') ? { rows: [] } : undefined) });
  try {
    assert.strictEqual((await get('/api/inventario/insumos/99')).status, 404);
  } finally {
    db.restaurar();
  }

  const db2 = fakeInventario();
  try {
    for (const malo of ['abc', '0', '-3', '1.5']) {
      assert.strictEqual((await get(`/api/inventario/insumos/${malo}`)).status, 400, malo);
    }
  } finally {
    db2.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/inventario/insumos
// ---------------------------------------------------------------------------

test('d-17b: el stock inicial entra como MOVIMIENTO, no como columna', async () => {
  // La regla del libro es SUM(movimientos.cantidad) = stock_actual: si el stock
  // inicial se escribiera en la columna, el libro arrancaria torcido.
  const db = fakeInventario();
  try {
    const res = await post('/api/inventario/insumos', {
      nombre: 'Queso costeño',
      unidad: 'g',
      stock_minimo: 500,
      stock_inicial: 2000,
    });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO insumos');
    assert.ok(!insert.sql.includes('stock_actual'), 'el INSERT no escribe el stock');
    const mov = db.buscar('registrar_movimiento_inventario');
    assert.ok(mov, 'el stock inicial pasa por la funcion de la base');
    assert.strictEqual(mov.params[1], 'entrada');
    assert.strictEqual(mov.params[2], 2000);
    assert.deepStrictEqual(res.body.movimiento, MOVIMIENTO);
  } finally {
    db.restaurar();
  }
});

test('d-17b: sin stock_inicial no hay movimiento', async () => {
  const db = fakeInventario();
  try {
    const res = await post('/api/inventario/insumos', { nombre: 'Masa' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.movimiento, null);
    assert.ok(!db.buscar('registrar_movimiento_inventario'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: crear y su movimiento van en UNA transaccion, con el autor del JWT', async () => {
  const db = fakeInventario();
  try {
    await post('/api/inventario/insumos', { nombre: 'Masa', stock_inicial: 10 });

    // Las primeras consultas son del middleware de autenticacion, asi que lo
    // que se comprueba es el ORDEN relativo, no una posicion fija.
    const sqls = db.ejecutadas.map((q) => q.sql);
    const donde = (fragmento) => sqls.findIndex((sql) => sql.includes(fragmento));

    assert.ok(donde('BEGIN') >= 0, 'hay transaccion');
    assert.ok(sqls.includes('COMMIT'));
    const autor = db.buscar('set_config');
    assert.ok(autor, 'se fija app.id_usuario');
    assert.deepStrictEqual(autor.params, ['app.id_usuario', '1']);
    // El set_config va DENTRO de la transaccion y ANTES de escribir: si no,
    // fn_usuario_de_sesion() no lo veria y el movimiento quedaria sin autor.
    assert.ok(donde('BEGIN') < donde('set_config'));
    assert.ok(donde('set_config') < donde('INSERT INTO insumos'));
    assert.ok(donde('INSERT INTO insumos') < donde('registrar_movimiento_inventario'));
    assert.ok(donde('registrar_movimiento_inventario') < sqls.indexOf('COMMIT'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: un nombre repetido es 409 nombre_en_uso, no 500', async () => {
  const db = fakeInventario({
    responder: (sql) => {
      if (sql.includes('INSERT INTO insumos')) throw errorDeLaBase('23505', 'uq insumos_nombre');
      return undefined;
    },
  });
  try {
    const res = await post('/api/inventario/insumos', { nombre: 'Queso costeño' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, inventarioService.MOTIVO_NOMBRE_EN_USO);
    assert.strictEqual(res.body.error, inventarioService.MENSAJE_NOMBRE_EN_USO);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: el cuerpo de crear es estricto y valida contra los CHECK de la tabla', async () => {
  const db = fakeInventario();
  try {
    const malos = [
      [{}, 'sin nombre'],
      [{ nombre: '' }, 'nombre vacio'],
      [{ nombre: 'a'.repeat(81) }, 'nombre largo'],
      [{ nombre: 'Masa', unidad: 'kilo' }, 'unidad fuera del CHECK'],
      [{ nombre: 'Masa', stock_minimo: -1 }, 'minimo negativo'],
      [{ nombre: 'Masa', stock_minimo: 1.234 }, 'tres decimales'],
      [{ nombre: 'Masa', stock_inicial: 0 }, 'entrada de 0'],
      [{ nombre: 'Masa', stock_inicial: -5 }, 'entrada negativa'],
      [{ nombre: 'Masa', stock_actual: 10 }, 'stock_actual no se escribe aqui'],
      [{ nombre: 'Masa', activo: true }, 'activo no se crea aqui'],
    ];
    for (const [cuerpo, caso] of malos) {
      const res = await post('/api/inventario/insumos', cuerpo);
      assert.strictEqual(res.status, 400, caso);
      assert.ok(res.body.error, caso);
    }
    assert.ok(!db.buscar('INSERT INTO insumos'), 'nada llego a la base');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/inventario/insumos/:id
// ---------------------------------------------------------------------------

test('d-17b: el PUT actualiza solo los campos enviados', async () => {
  const db = fakeInventario();
  try {
    const res = await put('/api/inventario/insumos/12', { stock_minimo: 800 });

    assert.strictEqual(res.status, 200);
    const update = db.buscar('UPDATE insumos');
    assert.ok(update.sql.includes('stock_minimo = $2'));
    assert.ok(!update.sql.includes('nombre ='), 'no reescribe lo que no se mando');
    assert.deepStrictEqual(update.params, [12, 800]);
  } finally {
    db.restaurar();
  }
});

test('d-17b: el PUT NO acepta stock_actual (es 400, no se ignora)', async () => {
  // Ignorarlo dejaria a quien llama creyendo que corrigio el stock.
  const db = fakeInventario();
  try {
    const res = await put('/api/inventario/insumos/12', { stock_actual: 999 });

    assert.strictEqual(res.status, 400);
    assert.ok(!db.buscar('UPDATE insumos'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: desactivar un insumo es la baja; no hay DELETE', async () => {
  const db = fakeInventario();
  try {
    const res = await put('/api/inventario/insumos/12', { activo: false });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(db.buscar('UPDATE insumos').params, [12, false]);

    // Y la ruta de borrado no existe: las recetas y los movimientos lo
    // referencian con ON DELETE RESTRICT.
    const borrado = await request(app)
      .delete('/api/inventario/insumos/12')
      .set('Authorization', `Bearer ${admin()}`);
    assert.strictEqual(borrado.status, 404);
  } finally {
    db.restaurar();
  }
});

test('d-17b: un cuerpo vacio en el PUT es 400', async () => {
  const db = fakeInventario();
  try {
    assert.strictEqual((await put('/api/inventario/insumos/12', {})).status, 400);
    assert.strictEqual((await put('/api/inventario/insumos/12', { activo: 'false' })).status, 400);
  } finally {
    db.restaurar();
  }
});

test('d-17b: el PUT sobre un insumo que no existe es 404', async () => {
  const db = fakeInventario({
    responder: (sql) => (sql.includes('UPDATE insumos') ? { rows: [] } : undefined),
  });
  try {
    const res = await put('/api/inventario/insumos/99', { stock_minimo: 1 });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, inventarioCtrl.MENSAJE_INSUMO_NO_ENCONTRADO);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/inventario/insumos/:id/movimientos
// ---------------------------------------------------------------------------

test('d-17b: el movimiento lo escribe la funcion de la base, no un UPDATE', async () => {
  const db = fakeInventario();
  try {
    const res = await post('/api/inventario/insumos/12/movimientos', {
      tipo: 'entrada',
      cantidad: 2000,
      motivo: 'Compra del proveedor',
    });

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body.movimiento, MOVIMIENTO);
    assert.strictEqual(res.body.stock_actual, MOVIMIENTO.stock_resultante);
    const llamada = db.buscar('registrar_movimiento_inventario');
    assert.deepStrictEqual(llamada.params, [12, 'entrada', 2000, 'Compra del proveedor']);
    // El backend NO toca el stock: la funcion bloquea el insumo y lo mueve.
    assert.ok(!db.buscar('UPDATE insumos'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: el autor del movimiento sale del JWT, en la misma transaccion', async () => {
  const db = fakeInventario();
  try {
    await request(app)
      .post('/api/inventario/insumos/12/movimientos')
      .set('Authorization', `Bearer ${tokenStaff(7, 'admin')}`)
      .send({ tipo: 'merma', cantidad: 50 });

    const autor = db.buscar('set_config');
    assert.deepStrictEqual(autor.params, ['app.id_usuario', '7']);
    // is_local en true: el valor muere con la transaccion y no se filtra a la
    // siguiente peticion que use esa conexion del pool.
    assert.ok(autor.sql.includes('set_config($1, $2, true)'));
    const sqls = db.ejecutadas.map((q) => q.sql);
    assert.ok(sqls.indexOf('BEGIN') < sqls.findIndex((s) => s.includes('set_config')));
    assert.ok(
      sqls.findIndex((s) => s.includes('set_config'))
        < sqls.findIndex((s) => s.includes('registrar_movimiento_inventario'))
    );
  } finally {
    db.restaurar();
  }
});

test('d-17b: entrada y merma exigen cantidad > 0; ajuste acepta signo', async () => {
  // El signo de entrada y merma lo pone el TIPO. El ajuste es el unico con
  // signo: es lo que permite corregir un conteo en los dos sentidos, y es lo
  // que acepta la funcion de la base.
  const db = fakeInventario();
  try {
    for (const cuerpo of [
      { tipo: 'entrada', cantidad: -5 },
      { tipo: 'merma', cantidad: -5 },
      { tipo: 'entrada', cantidad: 0 },
      { tipo: 'ajuste', cantidad: 0 },
      { tipo: 'reserva', cantidad: 5 },
      { tipo: 'devolucion', cantidad: 5 },
      { tipo: 'entrada', cantidad: 1.234 },
      { tipo: 'entrada' },
      { cantidad: 5 },
      { tipo: 'entrada', cantidad: 5, id_detalle: 700 },
    ]) {
      const res = await post('/api/inventario/insumos/12/movimientos', cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(cuerpo));
    }
    assert.ok(!db.buscar('registrar_movimiento_inventario'), 'nada llego a la base');

    const ajuste = await post('/api/inventario/insumos/12/movimientos', { tipo: 'ajuste', cantidad: -12 });
    assert.strictEqual(ajuste.status, 201, 'un ajuste negativo si vale');
  } finally {
    db.restaurar();
  }
});

test('d-17b: SD002 sale como 400 movimiento_invalido con el stock', async () => {
  const db = fakeInventario({
    responder: (sql) => {
      if (sql.includes('registrar_movimiento_inventario')) {
        const err = errorDeLaBase('SD002', 'El movimiento dejaría "Queso costeño" en negativo: hay 450.00 g');
        err.detail = JSON.stringify({ id_insumo: 12, insumo: 'Queso costeño', stock_actual: 450, cantidad: -1000 });
        throw err;
      }
      return undefined;
    },
  });
  try {
    const res = await post('/api/inventario/insumos/12/movimientos', { tipo: 'merma', cantidad: 1000 });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'movimiento_invalido');
    assert.strictEqual(res.body.stock_actual, 450);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: un movimiento sobre un insumo que no existe es 404', async () => {
  // La funcion lanza no_data_found (P0002): para esta API es un 404, no un 500.
  const db = fakeInventario({
    responder: (sql) => {
      if (sql.includes('registrar_movimiento_inventario')) {
        throw errorDeLaBase('P0002', 'El insumo 99 no existe');
      }
      return undefined;
    },
  });
  try {
    const res = await post('/api/inventario/insumos/99/movimientos', { tipo: 'entrada', cantidad: 5 });

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, inventarioCtrl.MENSAJE_INSUMO_NO_ENCONTRADO);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// GET /api/inventario/insumos/:id/movimientos
// ---------------------------------------------------------------------------

test('d-17b: el historial sale lo mas reciente primero y con todos los tipos', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/inventario/insumos/12/movimientos');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.movimientos, [MOVIMIENTO]);
    const consulta = db.buscar('FROM movimientos_inventario');
    assert.ok(consulta.sql.includes('ORDER BY creado_en DESC'));
    // Sin filtro por tipo: las reservas y devoluciones son parte del libro y
    // sin ellas la lista no cuadraria con el stock.
    assert.ok(!consulta.sql.includes("tipo IN ('entrada'"));
  } finally {
    db.restaurar();
  }
});

test('d-17b: limite y desde se validan y viajan como parametros', async () => {
  const db = fakeInventario();
  try {
    await get('/api/inventario/insumos/12/movimientos?limite=5&desde=2026-11-01T00:00:00.000Z');
    const consulta = db.buscar('FROM movimientos_inventario');
    assert.strictEqual(consulta.params[1], '2026-11-01T00:00:00.000Z');
    assert.strictEqual(consulta.params[2], 5);

    for (const url of [
      '/api/inventario/insumos/12/movimientos?limite=0',
      '/api/inventario/insumos/12/movimientos?limite=abc',
      '/api/inventario/insumos/12/movimientos?desde=ayer',
      '/api/inventario/insumos/12/movimientos?tipo=entrada',
    ]) {
      assert.strictEqual((await get(url)).status, 400, url);
    }
  } finally {
    db.restaurar();
  }
});

test('d-17b: el historial de un insumo que no existe es 404, no una lista vacia', async () => {
  const db = fakeInventario({
    responder: (sql) => (sql.includes('FROM insumos s WHERE') ? { rows: [] } : undefined),
  });
  try {
    const res = await get('/api/inventario/insumos/99/movimientos');

    assert.strictEqual(res.status, 404);
    assert.ok(!db.buscar('FROM movimientos_inventario'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------

test('d-17b: la receta de un plato trae el nombre y el stock de cada insumo', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/platos/12/receta');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_plato, 12);
    assert.deepStrictEqual(res.body.receta, [
      { id_insumo: 3, nombre: 'Masa', unidad: 'porcion', cantidad: 1, stock_actual: 40, activo: true },
    ]);
  } finally {
    db.restaurar();
  }
});

test('d-17b: la receta de una opcion usa su propia tabla y su propia clave', async () => {
  const db = fakeInventario();
  try {
    const res = await get('/api/ingredientes/5/receta');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_ingrediente, 5);
    assert.ok(db.buscar('FROM recetas_ingrediente r'));
    assert.ok(!db.buscar('FROM recetas_plato r'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: el PUT de la receta borra la anterior e inserta, en una transaccion', async () => {
  const db = fakeInventario();
  try {
    const res = await put('/api/platos/12/receta', {
      insumos: [{ id_insumo: 3, cantidad: 1 }, { id_insumo: 12, cantidad: 30 }],
    });

    assert.strictEqual(res.status, 200);
    const sqls = db.ejecutadas.map((q) => q.sql);
    assert.ok(sqls.includes('BEGIN'), 'hay transaccion');
    assert.ok(sqls.includes('COMMIT'));
    assert.ok(db.buscar('DELETE FROM recetas_plato'), 'reemplaza, no parchea');
    assert.strictEqual(db.todas('INSERT INTO recetas_plato').length, 2);
    // El borrado va ANTES de las inserciones, y todo dentro de la transaccion:
    // una receta a medias no significa nada.
    assert.ok(
      sqls.findIndex((s) => s.includes('DELETE FROM recetas_plato'))
        < sqls.findIndex((s) => s.includes('INSERT INTO recetas_plato'))
    );
  } finally {
    db.restaurar();
  }
});

test('d-17b: una receta vacia deja el plato sin receta', async () => {
  const db = fakeInventario({
    responder: (sql) => (sql.includes('FROM recetas_plato r') ? { rows: [] } : undefined),
  });
  try {
    const res = await put('/api/platos/12/receta', { insumos: [] });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.receta, []);
    assert.ok(db.buscar('DELETE FROM recetas_plato'));
    assert.ok(!db.buscar('INSERT INTO recetas_plato'), 'no inserta nada');
  } finally {
    db.restaurar();
  }
});

test('d-17b: un id_insumo repetido es 400 insumo_repetido y dice cual', async () => {
  // La tabla tiene PK (id_plato, id_insumo): repetir no es "la suma", es
  // ambiguo, y el segundo INSERT chocaria con un 23505 que nombra el constraint.
  const db = fakeInventario();
  try {
    const res = await put('/api/platos/12/receta', {
      insumos: [{ id_insumo: 3, cantidad: 1 }, { id_insumo: 3, cantidad: 2 }],
    });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, inventarioCtrl.MOTIVO_INSUMO_REPETIDO);
    assert.match(res.body.error, /3/);
    assert.ok(!db.buscar('DELETE FROM recetas_plato'), 'no se toco la receta');
  } finally {
    db.restaurar();
  }
});

test('d-17b: un insumo que no existe en la receta es 409 insumo_inexistente', async () => {
  const db = fakeInventario({
    responder: (sql) => {
      if (sql.includes('INSERT INTO recetas_plato')) {
        throw errorDeLaBase('23503', 'fk recetas_plato_id_insumo_fkey');
      }
      return undefined;
    },
  });
  try {
    const res = await put('/api/platos/12/receta', { insumos: [{ id_insumo: 999, cantidad: 1 }] });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, inventarioService.MOTIVO_INSUMO_INEXISTENTE);
    assert.ok(db.buscar('ROLLBACK'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: el cuerpo de la receta es estricto', async () => {
  const db = fakeInventario();
  try {
    const malos = [
      {},
      { insumos: 'tres' },
      { insumos: [{ id_insumo: 0, cantidad: 1 }] },
      { insumos: [{ id_insumo: 3, cantidad: 0 }] },
      { insumos: [{ id_insumo: 3, cantidad: -1 }] },
      { insumos: [{ id_insumo: 3, cantidad: 1.234 }] },
      { insumos: [{ id_insumo: 3 }] },
      { insumos: [{ id_insumo: 3, cantidad: 1, nombre: 'Masa' }] },
      { insumos: [{ id_insumo: 3, cantidad: 1 }], extra: true },
      { insumos: Array.from({ length: 51 }, (_, i) => ({ id_insumo: i + 1, cantidad: 1 })) },
    ];
    for (const cuerpo of malos) {
      const res = await put('/api/platos/12/receta', cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(cuerpo).slice(0, 60));
    }
    assert.ok(!db.buscar('DELETE FROM recetas_plato'));
  } finally {
    db.restaurar();
  }
});

test('d-17b: la receta de un plato o una opcion que no existen es 404', async () => {
  const db = fakeInventario({
    responder: (sql) => {
      if (sql.includes('FROM platos WHERE id_plato')) return { rows: [] };
      if (sql.includes('FROM ingredientes WHERE id_ingrediente')) return { rows: [] };
      return undefined;
    },
  });
  try {
    assert.strictEqual((await get('/api/platos/99/receta')).status, 404);
    assert.strictEqual((await put('/api/platos/99/receta', { insumos: [] })).status, 404);
    assert.strictEqual((await get('/api/ingredientes/99/receta')).status, 404);
    assert.strictEqual((await put('/api/ingredientes/99/receta', { insumos: [] })).status, 404);
    assert.ok(!db.buscar('DELETE FROM recetas_plato'), 'no se borra la receta de un plato que no existe');
  } finally {
    db.restaurar();
  }
});

test('d-17b: el PUT de la receta tambien fija el autor de la transaccion', async () => {
  const db = fakeInventario();
  try {
    await put('/api/platos/12/receta', { insumos: [{ id_insumo: 3, cantidad: 1 }] });

    assert.deepStrictEqual(db.buscar('set_config').params, ['app.id_usuario', '1']);
  } finally {
    db.restaurar();
  }
});
