const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const socketNotifier = require('../src/services/socket.notifier');
const { disponibilidadEfectiva } = require('../src/services/disponibilidad-efectiva');

// ISSUE #136: el aviso del PATCH manual mandaba el interruptor, no el efectivo.
//
// En la base hay dos columnas: `disponible` (el interruptor manual de la cocina,
// D-05) y `stock_suficiente` (lo calcula la base desde el stock de la receta,
// P-19). Lo que ve el comensal es su AND, y es lo que publica
// v_carta_disponible como disponible_efectivo.
//
// El PATCH avisaba con `plato.disponible` a secas: si la cocina encendia a mano
// un plato sin stock, todos los sockets recibian disponible: true, la PWA y el
// KDS lo mostraban disponible, y pedirlo daba 409 sin_stock. El oyente del canal
// 'inventario' ya mandaba el efectivo, asi que los dos caminos se contradecian.
//
// Lo que se vigila aqui: los TRES caminos (PATCH de plato, PATCH de opcion y
// oyente del canal) mandan el mismo valor efectivo.

const cocina = () => tokenStaff(5, 'cocina');
const admin = () => tokenStaff(1, 'admin');

const PLATO = (extra = {}) => ({
  id_plato: 12,
  id_categoria: 2,
  nombre: 'Arepa de Huevo',
  precio: 18000,
  disponible: true,
  stock_suficiente: true,
  tiempo_preparacion_estimado: 15,
  personalizable: false,
  calorias: null,
  ...extra,
});

const INGREDIENTE = (extra = {}) => ({
  id_ingrediente: 7,
  id_paso: 4,
  nombre: 'Panceta Crujiente',
  precio_extra: 3000,
  calorias: 120,
  alergenos: null,
  url_imagen: null,
  disponible: true,
  stock_suficiente: true,
  ...extra,
});

/**
 * @param {{fila: object, tabla: 'platos'|'ingredientes'}} opciones
 *   El doble devuelve la MISMA fila al leer y al escribir, pero con el
 *   `disponible` que pide el PATCH: es lo que hace el UPDATE de verdad.
 */
function fakeCarta({ fila, tabla }) {
  const esPlatos = tabla === 'platos';
  return instalarFakeDb((sql, params) => {
    if (esPlatos) {
      if (sql.includes('SELECT * FROM platos WHERE id_plato')) return { rows: [fila] };
      if (sql.includes('UPDATE platos SET disponible')) {
        return { rows: [{ ...fila, disponible: params[0] }] };
      }
    } else {
      if (sql.includes('FROM ingredientes i') || sql.includes('FROM ingredientes WHERE')) {
        return { rows: [fila] };
      }
      if (sql.includes('UPDATE ingredientes')) {
        // $6 es `disponible` en el UPDATE del servicio del constructor.
        return { rows: [{ ...fila, disponible: params[5] }] };
      }
    }
    return { rows: [] };
  });
}

const patchPlato = (disponible) => request(app)
  .patch('/api/platos/12/disponible')
  .set('Authorization', `Bearer ${cocina()}`)
  .send({ disponible });

const patchIngrediente = (disponible) => request(app)
  .patch('/api/ingredientes/7/disponible')
  .set('Authorization', `Bearer ${cocina()}`)
  .send({ disponible });

/** El `disponible` que viajó en el aviso a esa ruta interna. */
async function avisoDe(socket, ruta) {
  await socketNotifier.esperarAvisos();
  const aviso = socket.buscar(ruta);
  return aviso ? aviso.cuerpo.disponible : undefined;
}

// ---------------------------------------------------------------------------
// El helper
// ---------------------------------------------------------------------------

test('issue-136: el efectivo es el AND de las dos columnas', () => {
  assert.strictEqual(disponibilidadEfectiva({ disponible: true, stock_suficiente: true }), true);
  assert.strictEqual(disponibilidadEfectiva({ disponible: true, stock_suficiente: false }), false);
  assert.strictEqual(disponibilidadEfectiva({ disponible: false, stock_suficiente: true }), false);
  assert.strictEqual(disponibilidadEfectiva({ disponible: false, stock_suficiente: false }), false);
});

test('issue-136: sin stock_suficiente manda el interruptor manual', () => {
  // Es el DEFAULT de la columna (NOT NULL DEFAULT TRUE) y el valor correcto de
  // un plato sin receta, que no controla inventario.
  assert.strictEqual(disponibilidadEfectiva({ disponible: true }), true);
  assert.strictEqual(disponibilidadEfectiva({ disponible: true, stock_suficiente: null }), true);
  assert.strictEqual(disponibilidadEfectiva({ disponible: false }), false);
});

test('issue-136: una fila que no existe no esta disponible', () => {
  assert.strictEqual(disponibilidadEfectiva(null), false);
  assert.strictEqual(disponibilidadEfectiva(undefined), false);
  assert.strictEqual(disponibilidadEfectiva({}), false);
});

// ---------------------------------------------------------------------------
// PATCH /api/platos/:id/disponible
// ---------------------------------------------------------------------------

test('issue-136: encender a mano un plato SIN stock avisa disponible:false', async () => {
  // El caso del issue: la cocina lo repone, pero el inventario no alcanza.
  const db = fakeCarta({ fila: PLATO({ disponible: false, stock_suficiente: false }), tabla: 'platos' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await patchPlato(true);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.disponible, true, 'el interruptor SI quedo encendido');
    assert.strictEqual(
      await avisoDe(socket, '/internal/plato-disponibilidad'),
      false,
      'pero el aviso lleva el efectivo'
    );
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: encender a mano un plato CON stock avisa disponible:true', async () => {
  const db = fakeCarta({ fila: PLATO({ disponible: false, stock_suficiente: true }), tabla: 'platos' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchPlato(true);

    assert.strictEqual(await avisoDe(socket, '/internal/plato-disponibilidad'), true);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: apagar a mano avisa false, haya stock o no', async () => {
  for (const stock of [true, false]) {
    const db = fakeCarta({ fila: PLATO({ stock_suficiente: stock }), tabla: 'platos' });
    const socket = instalarFakeSocket(() => ({ ok: true }));
    const redis = instalarFakeRedis();
    try {
      await patchPlato(false);

      assert.strictEqual(
        await avisoDe(socket, '/internal/plato-disponibilidad'),
        false,
        `stock_suficiente=${stock}`
      );
    } finally {
      redis.restaurar();
      socket.restaurar();
      db.restaurar();
    }
  }
});

test('issue-136: un plato sin la columna en la fila avisa el interruptor', async () => {
  // Defensa: si una consulta dejara de traer stock_suficiente, el aviso vuelve
  // a ser el de antes de P-19 en vez de apagar la carta entera.
  const fila = PLATO();
  delete fila.stock_suficiente;
  const db = fakeCarta({ fila, tabla: 'platos' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchPlato(true);

    assert.strictEqual(await avisoDe(socket, '/internal/plato-disponibilidad'), true);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: el id del aviso sigue siendo el del plato', async () => {
  const db = fakeCarta({ fila: PLATO({ stock_suficiente: false }), tabla: 'platos' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchPlato(true);
    await socketNotifier.esperarAvisos();

    const aviso = socket.buscar('/internal/plato-disponibilidad');
    assert.strictEqual(aviso.cuerpo.id_plato, 12);
    assert.ok(aviso.cuerpo.eventId, 'y lleva su eventId');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/ingredientes/:id/disponible
// ---------------------------------------------------------------------------

test('issue-136: reponer a mano una opcion SIN stock avisa disponible:false', async () => {
  const db = fakeCarta({
    fila: INGREDIENTE({ disponible: false, stock_suficiente: false }),
    tabla: 'ingredientes',
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await patchIngrediente(true);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(
      await avisoDe(socket, '/internal/ingrediente-disponibilidad'),
      false,
      'el aviso de la opcion tambien lleva el efectivo'
    );
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: reponer una opcion CON stock avisa true', async () => {
  const db = fakeCarta({
    fila: INGREDIENTE({ disponible: false, stock_suficiente: true }),
    tabla: 'ingredientes',
  });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchIngrediente(true);

    assert.strictEqual(await avisoDe(socket, '/internal/ingrediente-disponibilidad'), true);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: agotar a mano una opcion avisa false', async () => {
  const db = fakeCarta({ fila: INGREDIENTE(), tabla: 'ingredientes' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchIngrediente(false);

    assert.strictEqual(await avisoDe(socket, '/internal/ingrediente-disponibilidad'), false);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

test('issue-136: el servicio de ingredientes devuelve stock_suficiente', async () => {
  // Sin la columna en el RETURNING, el controlador no podria calcular el
  // efectivo y el arreglo no serviria para las opciones.
  const db = fakeCarta({ fila: INGREDIENTE({ stock_suficiente: false }), tabla: 'ingredientes' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    const res = await patchIngrediente(true);

    assert.strictEqual(res.body.stock_suficiente, false);
    const update = db.buscar('UPDATE ingredientes');
    assert.ok(update.sql.includes('stock_suficiente'), 'esta en el RETURNING');
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Los tres caminos coinciden
// ---------------------------------------------------------------------------

test('issue-136: el PATCH y el oyente del canal mandan el MISMO valor', async () => {
  // El oyente ya mandaba el efectivo (lo calcula la base y viaja en el payload
  // como `disponible`); ahora el PATCH tambien. Con un plato encendido a mano y
  // sin stock, los dos dicen false.
  const avisos = require('../src/services/inventario-avisos');
  const db = fakeCarta({ fila: PLATO({ disponible: true, stock_suficiente: false }), tabla: 'platos' });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const redis = instalarFakeRedis();
  try {
    await patchPlato(true);
    const porElPatch = await avisoDe(socket, '/internal/plato-disponibilidad');

    const porElCanal = [];
    await avisos.manejarAviso(
      JSON.stringify({
        tipo: 'disponibilidad', entidad: 'plato', id: 12, disponible: false, motivo: 'stock',
      }),
      {
        notifier: {
          async notificarPlatoDisponibilidad(id, disponible) {
            porElCanal.push(disponible);
            return { ok: true };
          },
        },
      }
    );

    assert.strictEqual(porElPatch, false);
    assert.deepStrictEqual(porElCanal, [false]);
  } finally {
    redis.restaurar();
    socket.restaurar();
    db.restaurar();
    avisos.reiniciarEstado();
  }
});

test('issue-136: GET /api/platos y GET /api/platos/:id traen stock_suficiente', async () => {
  // Es lo que el KDS necesita para pintar "agotado por stock" al recargar
  // (issue #137): sin ese campo solo tiene el interruptor manual.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM platos')) return { rows: [PLATO({ stock_suficiente: false })] };
    return { rows: [] };
  });
  try {
    const lista = await request(app).get('/api/platos');
    const uno = await request(app).get('/api/platos/12');

    assert.strictEqual(lista.status, 200);
    assert.strictEqual(lista.body.platos[0].stock_suficiente, false);
    assert.strictEqual(lista.body.platos[0].disponible, true);
    assert.strictEqual(uno.body.stock_suficiente, false);
  } finally {
    db.restaurar();
  }
});
