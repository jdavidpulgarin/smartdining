const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const avisos = require('../src/services/inventario-avisos');
const menuService = require('../src/services/menu.service');

// ISSUE #135: la cache del menu y la disponibilidad por STOCK.
//
// GET /api/menu se cachea 60 s. invalidarMenu() solo se llamaba desde las rutas
// REST que editan la carta, pero la disponibilidad por stock cambia DENTRO de la
// base (un pedido que consume, un movimiento, una receta, un insumo
// desactivado) y solo avisa por el canal 'inventario': durante hasta un minuto
// la carta mostraba como disponible un plato ya agotado.
//
// Lo que se vigila aqui:
//   - un aviso de disponibilidad (plato u opcion) invalida la cache, UNA vez, y
//     tambien si el reenvio al socket-server falla;
//   - un aviso ilegible, incompleto o de otro tipo NO invalida;
//   - el arranque y cada reconexion invalidan tras el recalculo;
//   - la carrera: una lectura que empieza antes de la invalidacion y termina
//     despues NO deja el menu viejo en la cache;
//   - Redis caido no rompe nada;
//   - las rutas de inventario que escriben invalidan despues del COMMIT.

const admin = () => tokenStaff(1, 'admin');

/** Notificador doble que cuenta los reenvios y puede fallar. */
function notifierFalso({ lanza = false, ok = true } = {}) {
  const enviados = [];
  const responder = async (ruta, extra) => {
    enviados.push({ ruta, ...extra });
    if (lanza) throw new Error('el socket-server no responde');
    return { ok };
  };
  return {
    enviados,
    notificarPlatoDisponibilidad: (id, disponible) => responder('plato', { id, disponible }),
    notificarIngredienteDisponibilidad: (id, disponible) => responder('ingrediente', { id, disponible }),
    notificarInventarioAlerta: (cuerpo) => responder('alerta', cuerpo),
  };
}

/** Cuenta las invalidaciones mirando el contador de version del servicio. */
function contadorDeInvalidaciones() {
  const inicial = menuService.versionActual();
  return () => menuService.versionActual() - inicial;
}

const avisoDisponibilidad = (extra = {}) => JSON.stringify({
  tipo: 'disponibilidad', entidad: 'plato', id: 12, disponible: false, motivo: 'stock', ...extra,
});

test.afterEach(() => {
  avisos.reiniciarEstado();
});

// ---------------------------------------------------------------------------
// El aviso del canal invalida la cache
// ---------------------------------------------------------------------------

test('issue-135: un aviso de disponibilidad de PLATO invalida la cache del menu', async () => {
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    const resultado = await avisos.manejarAviso(avisoDisponibilidad(), { notifier });

    assert.deepStrictEqual(resultado, { reenviado: 'disponibilidad' });
    assert.strictEqual(invalidaciones(), 1, 'se invalido UNA vez');
    assert.strictEqual(redis.tiene('cache:menu'), false, 'la clave se borro');
    assert.strictEqual(notifier.enviados.length, 1, 'y el aviso igual se reenvio');
  } finally {
    redis.restaurar();
  }
});

test('issue-135: un aviso de disponibilidad de OPCION tambien invalida', async () => {
  // Una opcion agotada cambia el constructor del plato, que va en el mismo menu.
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    await avisos.manejarAviso(avisoDisponibilidad({ entidad: 'ingrediente', id: 7 }), { notifier });

    assert.strictEqual(invalidaciones(), 1);
    assert.strictEqual(redis.tiene('cache:menu'), false);
    assert.strictEqual(notifier.enviados[0].ruta, 'ingrediente');
  } finally {
    redis.restaurar();
  }
});

test('issue-135: se invalida ANTES de reenviar, y aunque el reenvio falle', async () => {
  // Si el socket-server esta caido, el aviso en vivo se pierde; lo que no puede
  // perderse es que la siguiente peticion del comensal vea la carta real.
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso({ lanza: true });
  const invalidaciones = contadorDeInvalidaciones();
  try {
    // Desde la cola de avisos (avisos-stock-cola.js) una excepcion del
    // notificador es un fallo reintentable mas: manejarAviso ya no lanza.
    await assert.doesNotReject(() => avisos.manejarAviso(avisoDisponibilidad(), { notifier }));

    assert.strictEqual(invalidaciones(), 1, 'la cache se invalido igual');
    assert.strictEqual(redis.tiene('cache:menu'), false);
  } finally {
    redis.restaurar();
  }
});

test('issue-135: tambien invalida si el socket-server contesta mal', async () => {
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso({ ok: false });
  const invalidaciones = contadorDeInvalidaciones();
  try {
    await avisos.manejarAviso(avisoDisponibilidad(), { notifier });

    assert.strictEqual(invalidaciones(), 1);
  } finally {
    redis.restaurar();
  }
});

test('issue-135: un aviso de stock_bajo NO invalida el menu', async () => {
  // El stock bajo es una alerta para el panel: no cambia lo que ve el comensal.
  // Si cambia la disponibilidad, llega su propio aviso de disponibilidad.
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    await avisos.manejarAviso(
      JSON.stringify({
        tipo: 'stock_bajo', id_insumo: 3, nombre: 'Masa', unidad: 'porcion',
        stock_actual: 1, stock_minimo: 5,
      }),
      { notifier }
    );

    assert.strictEqual(invalidaciones(), 0);
    assert.strictEqual(redis.tiene('cache:menu'), true, 'la cache sigue ahi');
  } finally {
    redis.restaurar();
  }
});

test('issue-135: un aviso ilegible o incompleto NO invalida', async () => {
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const notifier = notifierFalso();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    const malos = [
      '{roto',
      'null',
      JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', disponible: true }),
      JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 12 }),
      JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 0, disponible: true }),
      JSON.stringify({ tipo: 'disponibilidad', entidad: 'mesa', id: 12, disponible: true }),
      JSON.stringify({ tipo: 'receta_cambiada', id: 1 }),
    ];
    for (const payload of malos) {
      const resultado = await avisos.manejarAviso(payload, { notifier });
      assert.ok(resultado.ignorado, payload.slice(0, 40));
    }

    assert.strictEqual(invalidaciones(), 0, 'nada invalido la cache');
    assert.strictEqual(redis.tiene('cache:menu'), true);
    assert.deepStrictEqual(notifier.enviados, []);
  } finally {
    redis.restaurar();
  }
});

test('issue-135: con Redis caido el aviso sigue su curso', async () => {
  const redis = instalarFakeRedis({ caido: true });
  const notifier = notifierFalso();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    const resultado = await avisos.manejarAviso(avisoDisponibilidad(), { notifier });

    assert.deepStrictEqual(resultado, { reenviado: 'disponibilidad' });
    // La version sube igual: lo que protege es la lectura en vuelo, y eso no
    // depende de Redis.
    assert.strictEqual(invalidaciones(), 1);
    assert.strictEqual(notifier.enviados.length, 1);
  } finally {
    redis.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El arranque y la reconexion
// ---------------------------------------------------------------------------

/** Cliente de pg doble, lo justo para ponerLaCartaAlDia. */
function clienteFalso() {
  return {
    consultas: [],
    async query(sql) {
      this.consultas.push(sql);
      if (sql.includes('fn_recalcular_toda_la_carta')) return { rows: [{ cambios: 2 }] };
      if (sql.includes('v_carta_disponible')) {
        return { rows: [{ tipo: 'plato', id: 12, disponible_efectivo: false, motivo: 'stock' }] };
      }
      return { rows: [] };
    },
    on() { return this; },
    async connect() {},
    async end() {},
  };
}

test('issue-135: el arranque invalida la cache tras el recalculo', async () => {
  // Mientras el backend estaba caido el stock pudo cambiar: la cache puede tener
  // una carta anterior, y el recalculo no la toca.
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const invalidaciones = contadorDeInvalidaciones();
  try {
    const resumen = await avisos.ponerLaCartaAlDia(clienteFalso(), { notifier: notifierFalso() });

    assert.strictEqual(resumen.recalculados, 2);
    assert.strictEqual(resumen.cacheInvalidada, true);
    assert.ok(invalidaciones() >= 1, 'se invalido al arrancar');
    assert.strictEqual(redis.tiene('cache:menu'), false);
  } finally {
    redis.restaurar();
  }
});

test('issue-135: cada reconexion del canal vuelve a invalidar', async () => {
  const redis = instalarFakeRedis();
  const invalidaciones = contadorDeInvalidaciones();
  try {
    const cliente = clienteFalso();
    await avisos.ponerLaCartaAlDia(cliente, { notifier: notifierFalso() });
    const tras1 = invalidaciones();
    await avisos.ponerLaCartaAlDia(cliente, { notifier: notifierFalso() });

    assert.ok(invalidaciones() > tras1, 'la segunda pasada invalida otra vez');
  } finally {
    redis.restaurar();
  }
});

test('issue-135: si el recalculo falla, la cache se invalida igual', async () => {
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  const cliente = {
    consultas: [],
    async query(sql) {
      this.consultas.push(sql);
      if (sql.includes('fn_recalcular_toda_la_carta')) throw new Error('la funcion no existe');
      return { rows: [] };
    },
  };
  try {
    const resumen = await avisos.ponerLaCartaAlDia(cliente, { notifier: notifierFalso() });

    assert.strictEqual(resumen.recalculados, null);
    assert.strictEqual(resumen.cacheInvalidada, true);
  } finally {
    redis.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La carrera lectura / invalidacion
// ---------------------------------------------------------------------------

test('issue-135: una lectura que empezo ANTES de la invalidacion no cachea lo viejo', async () => {
  // El caso: GET /menu empieza a leer, el stock cambia y se invalida, y la
  // lectura termina despues con el menu VIEJO. Sin la version, lo guardaba y el
  // TTL lo mantenia 60 s: el mismo fallo por la ventana contraria.
  const redis = instalarFakeRedis();
  let soltarLaBase;
  let avisarQueLaBaseArranco;
  // La base ya se consulto: con esto la invalidacion cae DESPUES de que
  // obtenerMenu anotara la version, que es el orden de la carrera de verdad.
  const laBaseArranco = new Promise((resolve) => {
    avisarQueLaBaseArranco = resolve;
  });
  const db = instalarFakeDb((sql) => {
    if (sql.includes('obtener_menu_completo')) {
      return new Promise((resolve) => {
        soltarLaBase = () => resolve({ rows: [{ menu: [{ categoria: 'VIEJO' }] }] });
        avisarQueLaBaseArranco();
      });
    }
    return { rows: [] };
  });
  try {
    const lectura = menuService.obtenerMenu();
    await laBaseArranco;
    // La invalidacion ocurre mientras la base todavia no contesto.
    await menuService.invalidarMenu();
    soltarLaBase();
    const { menu } = await lectura;

    // La respuesta sale (es lo que se acaba de leer), pero NO se cachea.
    assert.deepStrictEqual(menu, [{ categoria: 'VIEJO' }]);
    assert.strictEqual(redis.tiene('cache:menu'), false, 'no quedo el menu viejo en la cache');
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

test('issue-135: una lectura sin invalidacion de por medio SI cachea', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('obtener_menu_completo')) return { rows: [{ menu: [{ categoria: 'Entradas' }] }] };
    return { rows: [] };
  });
  try {
    const { menu, desdeCache } = await menuService.obtenerMenu();

    assert.strictEqual(desdeCache, false);
    assert.deepStrictEqual(menu, [{ categoria: 'Entradas' }]);
    assert.strictEqual(redis.tiene('cache:menu'), true, 'la cache sigue sirviendo');
    assert.strictEqual(redis.ttlDe('cache:menu'), menuService.TTL_SEGUNDOS);
  } finally {
    db.restaurar();
    redis.restaurar();
  }
});

test('issue-135: invalidarMenu sube la version aunque Redis este caido', async () => {
  const redis = instalarFakeRedis({ caido: true });
  const antes = menuService.versionActual();
  try {
    const borrado = await menuService.invalidarMenu();

    assert.strictEqual(borrado, false, 'sin Redis no hay nada que borrar');
    assert.strictEqual(menuService.versionActual(), antes + 1);
  } finally {
    redis.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Las rutas de inventario que escriben
// ---------------------------------------------------------------------------

const INSUMO = {
  id_insumo: 12, nombre: 'Queso', unidad: 'g', stock_actual: 450, stock_minimo: 500,
  activo: true, bajo: true, agotado: false, actualizado_en: '2026-11-09T12:00:00.000Z',
};
const MOVIMIENTO = {
  id: 44, id_insumo: 12, tipo: 'merma', cantidad: -50, stock_resultante: 400,
  id_detalle: null, id_usuario: 1, motivo: null, creado_en: '2026-11-09T12:00:00.000Z',
};

function fakeInventario() {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM insumos s WHERE s.id_insumo')) return { rows: [INSUMO] };
    if (sql.includes('INSERT INTO insumos')) return { rows: [{ id_insumo: 12 }] };
    if (sql.includes('UPDATE insumos')) return { rows: [{ id_insumo: 12 }] };
    if (sql.includes('registrar_movimiento_inventario')) return { rows: [MOVIMIENTO] };
    if (sql.includes('FROM platos WHERE id_plato')) return { rows: [{ '1': 1 }] };
    if (sql.includes('FROM ingredientes WHERE id_ingrediente')) return { rows: [{ '1': 1 }] };
    if (sql.includes('FROM recetas_plato r')) return { rows: [] };
    if (sql.includes('FROM recetas_ingrediente r')) return { rows: [] };
    return { rows: [] };
  });
}

test('issue-135: las escrituras de inventario invalidan la cache tras el COMMIT', async () => {
  // Cinturon de seguridad para el admin que edita y recarga en el mismo
  // segundo: no depende del orden de llegada del NOTIFY.
  const escrituras = [
    ['POST movimiento', () => request(app)
      .post('/api/inventario/insumos/12/movimientos')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ tipo: 'merma', cantidad: 50 }), 201],
    ['POST insumo', () => request(app)
      .post('/api/inventario/insumos')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ nombre: 'Masa nueva' }), 201],
    ['PUT insumo', () => request(app)
      .put('/api/inventario/insumos/12')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ activo: false }), 200],
    ['PUT receta de plato', () => request(app)
      .put('/api/platos/12/receta')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ insumos: [] }), 200],
    ['PUT receta de opcion', () => request(app)
      .put('/api/ingredientes/7/receta')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ insumos: [] }), 200],
  ];

  for (const [caso, llamar, status] of escrituras) {
    const db = fakeInventario();
    const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
    try {
      const res = await llamar();

      assert.strictEqual(res.status, status, caso);
      assert.strictEqual(redis.tiene('cache:menu'), false, `${caso} invalido la cache`);
    } finally {
      redis.restaurar();
      db.restaurar();
    }
  }
});

test('issue-135: una LECTURA de inventario no invalida nada', async () => {
  const db = fakeInventario();
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  try {
    const res = await request(app)
      .get('/api/inventario/insumos/12')
      .set('Authorization', `Bearer ${admin()}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(redis.tiene('cache:menu'), true);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});

test('issue-135: una escritura que falla no invalida la cache', async () => {
  // Si no se escribio nada, la carta no cambio.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM insumos s WHERE s.id_insumo')) return { rows: [] };
    return { rows: [] };
  });
  const redis = instalarFakeRedis({ inicial: { 'cache:menu': '[]' } });
  try {
    const res = await request(app)
      .post('/api/inventario/insumos/99/movimientos')
      .set('Authorization', `Bearer ${admin()}`)
      .send({ tipo: 'entrada', cantidad: 'mucho' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(redis.tiene('cache:menu'), true);
  } finally {
    redis.restaurar();
    db.restaurar();
  }
});
