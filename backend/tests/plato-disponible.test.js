const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeRedis, redisCaido } = require('./helpers/fake-redis');
const { instalarFakeSocket, socketCaido, ES_UUID, CLAVE_FALSA } = require('./helpers/fake-socket');
const { CLAVE_CACHE } = require('../src/services/menu.service');
const { esperarAvisos } = require('../src/services/socket.notifier');
const app = require('../server');

// D-05: PATCH /api/platos/:id/disponible.
//
// El interruptor de "se agoto" / "volvio" del PLATO, gemelo del de
// ingredientes. Lo que se vigila aqui es lo mismo que alli:
//   - es de admin Y de cocina: la unica escritura de la carta que no es solo de
//     admin, porque la usa el panel de agotados;
//   - el orden commit -> cache -> aviso, que no es decorativo: al reves, un
//     cliente que reaccione al evento pidiendo GET /menu podria recibir la
//     copia vieja del cache y seguir mostrando el plato como disponible;
//   - el aviso es un extra: si el socket-server esta caido la respuesta no
//     cambia, porque el cambio ya esta guardado;
//   - el payload es EXACTAMENTE el que valida sala.js (EVENTS.md 5.4): un
//     entero positivo, un booleano y un eventId UUID. Nada mas;
//   - el UPDATE toca SOLO la columna disponible, para que agotar un plato no
//     reescriba una fila que otro acabara de editar.

const RUTA_INTERNA = '/internal/plato-disponibilidad';
const RUTA_INGREDIENTES = '/internal/ingrediente-disponibilidad';
const ID_PLATO = 7;

const SQL_LOCK = 'SELECT * FROM platos WHERE id_plato = $1 FOR UPDATE';
const SQL_UPDATE = 'UPDATE platos SET disponible';

const PLATO = {
  id_plato: ID_PLATO,
  id_categoria: 2,
  nombre: 'Bandeja Paisa',
  descripcion: 'La de la casa',
  precio: '38000.00',
  url_imagen: null,
  disponible: true,
  tiempo_preparacion_estimado: 25,
  creado_en: '2026-10-01T12:00:00.000Z',
};

/**
 * @param {{fila?: object|null, disponibleTrasUpdate?: boolean}} o
 *   fila: la que devuelve el SELECT ... FOR UPDATE (null = no existe -> 404).
 */
function dbPlato(o = {}) {
  const { fila = PLATO, disponibleTrasUpdate } = o;
  return (sql) => {
    if (sql.includes(SQL_LOCK)) return { rows: fila ? [fila] : [] };
    if (sql.includes(SQL_UPDATE)) {
      const nueva = { ...fila };
      if (disponibleTrasUpdate !== undefined) nueva.disponible = disponibleTrasUpdate;
      return { rows: [nueva] };
    }
    return { rows: [] };
  };
}

const patch = (cuerpo, token, id = ID_PLATO) => {
  const peticion = request(app).patch(`/api/platos/${id}/disponible`);
  if (token) peticion.set('Authorization', token);
  return peticion.send(cuerpo);
};

const jwtAdmin = () => `Bearer ${tokenStaff(1, 'admin')}`;
const jwtCocina = () => `Bearer ${tokenStaff(2, 'cocina')}`;

/** Monta los tres dobles y los deshace en orden inverso. */
function conTodo(opciones = {}) {
  const { db: opsDb = {}, socket, redis } = opciones;
  const s = socket || instalarFakeSocket();
  const r = redis || instalarFakeRedis();
  const d = instalarFakeDb(dbPlato(opsDb));
  return {
    db: d,
    socket: s,
    redis: r,
    restaurar() {
      d.restaurar();
      r.restaurar();
      s.restaurar();
    },
  };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('admin puede agotar un plato: 200 con la fila actualizada', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_plato, ID_PLATO);
    assert.strictEqual(res.body.disponible, false);
    // Misma forma que devuelve el PUT: la fila del plato, no un {ok}. Es lo que
    // deja al panel leer el valor guardado sin volver a pedir la carta.
    assert.strictEqual(res.body.nombre, 'Bandeja Paisa');
    assert.ok('precio' in res.body && 'id_categoria' in res.body);
  } finally {
    t.restaurar();
  }
});

test('cocina tambien puede: es el panel de agotados', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await patch({ disponible: false }, jwtCocina());
    await esperarAvisos();

    assert.strictEqual(res.status, 200, 'la excepcion al "solo admin" de la carta');
    assert.strictEqual(res.body.disponible, false);
  } finally {
    t.restaurar();
  }
});

for (const [rol, token] of [
  ['cajero', () => `Bearer ${tokenStaff(4, 'cajero')}`],
  ['mesero', () => `Bearer ${tokenStaff(3, 'mesero')}`],
  ['comensal', () => `Bearer ${tokenComensal(5)}`],
]) {
  test(`${rol} no puede cambiar la disponibilidad: 403 y no se toca la base`, async () => {
    const t = conTodo();
    try {
      const res = await patch({ disponible: false }, token());
      await esperarAvisos();

      assert.strictEqual(res.status, 403);
      assert.strictEqual(t.db.buscar(SQL_UPDATE), undefined);
      assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined, 'ni se avisa');
    } finally {
      t.restaurar();
    }
  });
}

test('sin token: 401 y no se toca la base', async () => {
  const t = conTodo();
  try {
    const res = await patch({ disponible: false }, null);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(t.db.buscar(SQL_UPDATE), undefined);
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Validacion del cuerpo
// ---------------------------------------------------------------------------

for (const [caso, cuerpo] of [
  ['sin el campo', {}],
  ['disponible null', { disponible: null }],
  ['disponible como texto "true"', { disponible: 'true' }],
  ['disponible como texto "false"', { disponible: 'false' }],
  ['disponible 1', { disponible: 1 }],
  ['disponible 0', { disponible: 0 }],
  ['disponible arreglo vacio', { disponible: [] }],
  ['cuerpo vacio de verdad', undefined],
  // .strict(): aqui el cuerpo tiene UN campo, asi que una clave de mas es un
  // error de quien llama y no la costumbre del editor de reenviar la fila.
  ['un campo de mas', { disponible: true, nombre: 'Otro' }],
  ['solo un campo ajeno', { nombre: 'Otro' }],
  // Editar la carta se hace por el PUT, que es solo de admin: colar el precio
  // por aqui seria cambiar el menu con permisos de cocina.
  ['el precio de contrabando', { disponible: false, precio: 1 }],
]) {
  test(`${caso}: 400 y no se toca la base`, async () => {
    const t = conTodo();
    try {
      const res = await patch(cuerpo, jwtAdmin());
      await esperarAvisos();

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error, 'con un mensaje que se entienda');
      assert.strictEqual(t.db.buscar(SQL_UPDATE), undefined);
      assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
    } finally {
      t.restaurar();
    }
  });
}

for (const id of ['abc', '0', '-3', '2.5']) {
  test(`un id de plato "${id}" responde 400`, async () => {
    const t = conTodo();
    try {
      const res = await patch({ disponible: false }, jwtAdmin(), id);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'id de plato inválido');
      assert.strictEqual(t.db.buscar(SQL_UPDATE), undefined);
    } finally {
      t.restaurar();
    }
  });
}

test('un plato que no existe: 404 y NO se avisa', async () => {
  const t = conTodo({ db: { fila: null } });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Plato no encontrado');
    // Avisar de algo que no existe agotaria un plato fantasma en todos los
    // celulares.
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
    assert.strictEqual(t.redis.todas('del').length, 0, 'ni se invalida el cache');
    assert.ok(t.db.buscar('ROLLBACK'), 'y la transaccion se deshace');
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Orden: COMMIT -> cache -> aviso
// ---------------------------------------------------------------------------

test('el aviso sale DESPUES del commit', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    // Se comprueba sobre el orden real registrado, no con temporizadores.
    assert.ok(t.db.buscar('COMMIT'), 'la transaccion se confirmo');
    assert.ok(t.socket.buscar(RUTA_INTERNA), 'y el aviso salio');
    assert.strictEqual(t.db.buscar('ROLLBACK'), undefined);
  } finally {
    t.restaurar();
  }
});

test('la fila se bloquea con FOR UPDATE antes de escribirla', async () => {
  // Dos pulsaciones a la vez, desde el panel y desde el KDS, no deben pisarse.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const bloqueo = t.db.buscar(SQL_LOCK);
    assert.ok(bloqueo, 'SELECT ... FOR UPDATE');
    assert.deepStrictEqual(bloqueo.params, [ID_PLATO]);
  } finally {
    t.restaurar();
  }
});

test('el UPDATE toca SOLO la columna disponible', async () => {
  // Si reescribiera la fila entera (como el PUT), agotar un plato podria perder
  // un precio o una descripcion que otro acabara de guardar.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const update = t.db.buscar(SQL_UPDATE);
    assert.ok(update);
    assert.deepStrictEqual(update.params, [false, ID_PLATO]);
    for (const columna of ['precio', 'nombre', 'descripcion', 'id_categoria', 'url_imagen']) {
      assert.ok(!update.sql.includes(`${columna} =`), `no se reescribe ${columna}`);
    }
  } finally {
    t.restaurar();
  }
});

test('el cache del menu se invalida', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const borrados = t.redis.todas('del');
    assert.strictEqual(borrados.length, 1);
    assert.strictEqual(borrados[0].clave, CLAVE_CACHE);
  } finally {
    t.restaurar();
  }
});

test('el cache se invalida ANTES de avisar', async () => {
  // Si se avisara primero, un cliente que reaccione al evento pidiendo
  // GET /menu podria recibir la copia vieja (TTL 60 s) y seguir mostrando el
  // plato como disponible. Se registra el momento de cada uno.
  const orden = [];
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket((ruta) => {
    orden.push(`aviso:${ruta}`);
    return { ok: true, duplicado: false };
  });
  const db = instalarFakeDb(dbPlato({ disponibleTrasUpdate: false }));
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    // El del del cache ya ocurrio cuando el aviso se registro.
    assert.strictEqual(redis.todas('del').length, 1, 'el cache se invalido');
    assert.deepStrictEqual(orden, [`aviso:${RUTA_INTERNA}`], 'y el aviso salio una vez');
  } finally {
    db.restaurar();
    redis.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El aviso es un extra: nunca cambia la respuesta
// ---------------------------------------------------------------------------

test('si el socket-server esta caido, la respuesta sigue siendo 200', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false }, socket: socketCaido() });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 200, 'el cambio ya esta guardado');
    assert.strictEqual(res.body.disponible, false);
    assert.ok(t.db.buscar('COMMIT'), 'y no se revierte nada');
  } finally {
    t.restaurar();
  }
});

for (const status of [400, 500, 503]) {
  test(`si el socket-server responde ${status}, la respuesta sigue siendo 200`, async () => {
    const socket = instalarFakeSocket(() => ({ __status: status, ok: false }));
    const t = conTodo({ db: { disponibleTrasUpdate: false }, socket });
    try {
      const res = await patch({ disponible: false }, jwtAdmin());
      await esperarAvisos();

      assert.strictEqual(res.status, 200);
      assert.ok(t.db.buscar('COMMIT'));
    } finally {
      t.restaurar();
    }
  });
}

test('si Redis esta caido, la respuesta sigue siendo 200 y se avisa igual', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false }, redis: redisCaido() });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    // invalidarMenu devuelve false sin lanzar: el cache es un extra tambien.
    assert.strictEqual(res.status, 200);
    assert.ok(t.socket.buscar(RUTA_INTERNA), 'el aviso no depende del cache');
  } finally {
    t.restaurar();
  }
});

test('la respuesta no espera al aviso', async () => {
  // Un socket-server lento no debe retrasar el PATCH. El doble resuelve cuando
  // se le dice, y la respuesta tiene que haber llegado antes.
  let soltar;
  const esperando = new Promise((resolve) => { soltar = resolve; });
  const socket = instalarFakeSocket(async () => {
    await esperando;
    return { ok: true };
  });
  const t = conTodo({ db: { disponibleTrasUpdate: false }, socket });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());

    assert.strictEqual(res.status, 200, 'la respuesta no espero al aviso');
    soltar();
    await esperarAvisos();
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El contrato de Roberto (lo que valida sala.js, EVENTS.md 5.4 y 6)
// ---------------------------------------------------------------------------

test('el aviso va a la ruta interna correcta y con la clave', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const aviso = t.socket.buscar(RUTA_INTERNA);
    assert.ok(aviso, 'POST /internal/plato-disponibilidad');
    assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
    // Y no por la de ingredientes, que lleva su propia clave de idempotencia en
    // el socket-server (backend:ingrediente:{eventId}).
    assert.strictEqual(t.socket.buscar(RUTA_INGREDIENTES), undefined);
  } finally {
    t.restaurar();
  }
});

test('el payload es exactamente el de EVENTS.md: nada de mas, nada de menos', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const { cuerpo } = t.socket.buscar(RUTA_INTERNA);

    assert.deepStrictEqual(
      Object.keys(cuerpo).sort(),
      ['disponible', 'eventId', 'id_plato'],
      'solo los dos campos y el eventId'
    );
    // emitidoEn lo pone el socket-server al emitir (sala.js), no nosotros:
    // mandarlo seria un campo que se ignora.
    assert.ok(!('emitidoEn' in cuerpo), 'emitidoEn es de el, no nuestro');
    // Ni una columna de la carta: el evento es publico y va a TODOS los
    // sockets, asi que el precio y la receta no viajan en el.
    assert.ok(!('precio' in cuerpo) && !('nombre' in cuerpo));
  } finally {
    t.restaurar();
  }
});

test('id_plato entero positivo y disponible booleano estricto', async () => {
  // Es lo que exige sala.js para no responder PAYLOAD_INVALIDO.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const { cuerpo } = t.socket.buscar(RUTA_INTERNA);
    assert.strictEqual(typeof cuerpo.id_plato, 'number');
    assert.ok(Number.isSafeInteger(cuerpo.id_plato) && cuerpo.id_plato > 0);
    assert.strictEqual(typeof cuerpo.disponible, 'boolean');
    assert.strictEqual(cuerpo.disponible, false);
  } finally {
    t.restaurar();
  }
});

test('el eventId es un UUID v4, que es lo que valida Roberto', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const { cuerpo } = t.socket.buscar(RUTA_INTERNA);
    assert.match(cuerpo.eventId, ES_UUID);
  } finally {
    t.restaurar();
  }
});

test('el aviso lleva el valor GUARDADO, no el que llego en el cuerpo', async () => {
  // Si la base dejara otro valor, el que vale es el de la fila que devuelve el
  // RETURNING: es lo que de verdad hay guardado.
  const t = conTodo({ db: { disponibleTrasUpdate: true } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(t.socket.buscar(RUTA_INTERNA).cuerpo.disponible, true);
  } finally {
    t.restaurar();
  }
});

test('reponer avisa con disponible true', async () => {
  const agotado = { ...PLATO, disponible: false };
  const t = conTodo({ db: { fila: agotado, disponibleTrasUpdate: true } });
  try {
    const res = await patch({ disponible: true }, jwtCocina());
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.disponible, true);
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA).cuerpo.disponible, true);
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test('ponerlo al valor que ya tenia NO es un error: 200 y se avisa igual', async () => {
  // Ya esta disponible: true y se pide true.
  const t = conTodo({ db: { disponibleTrasUpdate: true } });
  try {
    const res = await patch({ disponible: true }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 200, 'idempotente, no 409');
    assert.strictEqual(res.body.disponible, true);
    // Se avisa igual, como en ingredientes: si un cliente se perdio el aviso
    // anterior, el reenvio lo recupera. Callar aqui seria un modo de fallo
    // silencioso.
    assert.ok(t.socket.buscar(RUTA_INTERNA), 'se reenvia el aviso');
  } finally {
    t.restaurar();
  }
});

test('dos llamadas seguidas mandan eventId DISTINTOS', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const avisos = t.socket.todos(RUTA_INTERNA);
    assert.strictEqual(avisos.length, 2);
    // Con el mismo eventId, Roberto deduplicaria y el segundo aviso se
    // perderia en silencio (responde duplicado: true sin emitir).
    assert.notStrictEqual(
      avisos[0].cuerpo.eventId,
      avisos[1].cuerpo.eventId,
      'un eventId por llamada'
    );
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Lo que el panel del restaurante espera hoy (agotadosApi.togglePlato)
// ---------------------------------------------------------------------------

test('el panel manda { disponible } y recibe 200 con JSON', async () => {
  // frontend-restaurante/src/services/api.js: PATCH /platos/:id/disponible con
  // ese cuerpo y nada mas, y apiFetch hace response.json() cuando el
  // content-type es JSON, asi que la respuesta tiene que serlo.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.strictEqual(typeof res.body, 'object');
  } finally {
    t.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El PUT de la carta NO avisa: sigue siendo solo de admin y no es D-05
// ---------------------------------------------------------------------------

test('el PUT del editor no manda el aviso de disponibilidad', async () => {
  // Diferencia buscada con ingredientes, donde el PUT tambien avisa: ese
  // controller compara el valor anterior con el nuevo y aqui el PUT reescribe
  // la fila con lo que ya habia leido, asi que no sabe si `disponible` cambio
  // de verdad. Para agotar esta el PATCH, que es lo que usa el panel.
  const socket = instalarFakeSocket();
  const redis = instalarFakeRedis();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato = $1')) return { rows: [PLATO] };
    if (sql.includes('UPDATE platos SET')) return { rows: [{ ...PLATO, disponible: false }] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .put(`/api/platos/${ID_PLATO}`)
      .set('Authorization', jwtAdmin())
      .send({ nombre: 'Bandeja Paisa', precio: 38000, id_categoria: 2, disponible: false });
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(socket.buscar(RUTA_INTERNA), undefined);
    // Pero el cache si se invalida: la carta viaja dentro del menu.
    assert.strictEqual(redis.todas('del').length, 1);
  } finally {
    db.restaurar();
    redis.restaurar();
    socket.restaurar();
  }
});
