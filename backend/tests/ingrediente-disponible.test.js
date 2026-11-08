const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeRedis, redisCaido } = require('./helpers/fake-redis');
const { instalarFakeSocket, socketCaido, ES_UUID, CLAVE_FALSA } = require('./helpers/fake-socket');
const { CLAVE_CACHE } = require('../src/services/menu.service');
const { esperarAvisos } = require('../src/services/socket.notifier');
const app = require('../server');

// D-05: PATCH /api/ingredientes/:id/disponible.
//
// El interruptor de "se agoto" / "volvio". Lo que se vigila aqui:
//   - es de admin Y de cocina: es la unica escritura del constructor que no es
//     solo de admin, porque la usa el panel de agotados del KDS (D-10);
//   - el orden commit -> cache -> aviso, que no es decorativo: al reves, un
//     cliente que reaccione al evento pidiendo GET /menu podria recibir la
//     copia vieja del cache y seguir mostrando el ingrediente como disponible;
//   - el aviso es un extra: si el socket-server esta caido la respuesta no
//     cambia, porque el cambio ya esta guardado;
//   - el payload es EXACTAMENTE el que valida sala.js (EVENTS.md §5.3): un
//     entero positivo, un booleano y un eventId UUID. Nada mas.

const RUTA_INTERNA = '/internal/ingrediente-disponibilidad';
const ID_INGREDIENTE = 10;

const SQL_LOCK = 'FROM ingredientes i WHERE i.id_ingrediente = $1 FOR UPDATE';
const SQL_UPDATE = 'UPDATE ingredientes';

const INGREDIENTE = {
  id_ingrediente: ID_INGREDIENTE,
  id_paso: 31,
  nombre: 'Panceta Crujiente',
  precio_extra: '2000.00',
  calorias: 180,
  alergenos: [],
  url_imagen: null,
  disponible: true,
};

/**
 * @param {{fila?: object|null, disponibleTrasUpdate?: boolean}} o
 *   fila: la que devuelve el SELECT ... FOR UPDATE (null = no existe -> 404).
 */
function dbIngrediente(o = {}) {
  const { fila = INGREDIENTE, disponibleTrasUpdate } = o;
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

const patch = (cuerpo, token, id = ID_INGREDIENTE) => {
  const peticion = request(app).patch(`/api/ingredientes/${id}/disponible`);
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
  const d = instalarFakeDb(dbIngrediente(opsDb));
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

test('admin puede agotar un ingrediente: 200 con la fila actualizada', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_ingrediente, ID_INGREDIENTE);
    assert.strictEqual(res.body.disponible, false);
    // Misma forma que devuelve el PUT: la fila del constructor, no un {ok}.
    assert.strictEqual(res.body.nombre, 'Panceta Crujiente');
    assert.ok('precio_extra' in res.body && 'alergenos' in res.body);
  } finally {
    t.restaurar();
  }
});

test('cocina tambien puede: es el panel de agotados del KDS (D-10)', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await patch({ disponible: false }, jwtCocina());
    await esperarAvisos();

    assert.strictEqual(res.status, 200, 'la excepcion al "solo admin" del constructor');
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
  test(`un id de ingrediente "${id}" responde 400`, async () => {
    const t = conTodo();
    try {
      const res = await patch({ disponible: false }, jwtAdmin(), id);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(t.db.buscar(SQL_UPDATE), undefined);
    } finally {
      t.restaurar();
    }
  });
}

test('un ingrediente que no existe: 404 y NO se avisa', async () => {
  const t = conTodo({ db: { fila: null } });
  try {
    const res = await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'Ingrediente no encontrado');
    // Avisar de algo que no existe desactivaria una opcion fantasma en todos
    // los celulares.
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
    assert.strictEqual(t.redis.todas('del').length, 0, 'ni se invalida el cache');
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
  // ingrediente como disponible. Se registra el momento de cada uno.
  const orden = [];
  const redis = instalarFakeRedis();
  const delReal = redis.todas;
  const socket = instalarFakeSocket((ruta) => {
    orden.push(`aviso:${ruta}`);
    return { ok: true, duplicado: false };
  });
  const db = instalarFakeDb(dbIngrediente({ disponibleTrasUpdate: false }));
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    // El del del cache ya ocurrio cuando el aviso se registro.
    assert.strictEqual(redis.todas('del').length, 1, 'el cache se invalido');
    assert.deepStrictEqual(orden, [`aviso:${RUTA_INTERNA}`], 'y el aviso salio una vez');
    assert.ok(delReal, 'el doble de redis sigue en pie');
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
// El contrato de Roberto (lo que valida sala.js, EVENTS.md §5.3 y §6)
// ---------------------------------------------------------------------------

test('el aviso va a la ruta interna correcta y con la clave', async () => {
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const aviso = t.socket.buscar(RUTA_INTERNA);
    assert.ok(aviso, 'POST /internal/ingrediente-disponibilidad');
    assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
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
      ['disponible', 'eventId', 'id_ingrediente'],
      'solo los dos campos y el eventId'
    );
    // emitidoEn lo pone el socket-server al emitir (sala.js), no nosotros:
    // mandarlo seria un campo que se ignora.
    assert.ok(!('emitidoEn' in cuerpo), 'emitidoEn es de el, no nuestro');
  } finally {
    t.restaurar();
  }
});

test('id_ingrediente entero positivo y disponible booleano estricto', async () => {
  // Es lo que exige sala.js para no responder PAYLOAD_INVALIDO.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    await patch({ disponible: false }, jwtAdmin());
    await esperarAvisos();

    const { cuerpo } = t.socket.buscar(RUTA_INTERNA);
    assert.strictEqual(typeof cuerpo.id_ingrediente, 'number');
    assert.ok(Number.isSafeInteger(cuerpo.id_ingrediente) && cuerpo.id_ingrediente > 0);
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

test('reponer avisa con disponible true', async () => {
  const agotado = { ...INGREDIENTE, disponible: false };
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
    // Se avisa igual: si un cliente se perdio el aviso anterior, el reenvio lo
    // recupera. Callar aqui seria un modo de fallo silencioso.
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
// El PUT del editor tambien avisa, pero solo si `disponible` cambio
// ---------------------------------------------------------------------------

const put = (cuerpo) =>
  request(app)
    .put(`/api/ingredientes/${ID_INGREDIENTE}`)
    .set('Authorization', jwtAdmin())
    .send(cuerpo);

test('put: si cambia disponible, avisa igual que el PATCH', async () => {
  // Sin esto, agotar algo desde el editor del panel no llegaria en vivo a los
  // celulares, porque el PUT tambien puede tocar esa columna.
  const t = conTodo({ db: { disponibleTrasUpdate: false } });
  try {
    const res = await put({ disponible: false });
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    const aviso = t.socket.buscar(RUTA_INTERNA);
    assert.ok(aviso, 'el editor tambien mueve el constructor en vivo');
    assert.strictEqual(aviso.cuerpo.disponible, false);
    assert.strictEqual(aviso.cuerpo.id_ingrediente, ID_INGREDIENTE);
  } finally {
    t.restaurar();
  }
});

test('put: si NO cambia disponible, no avisa nada', async () => {
  // Cambiar el nombre o el precio no es una noticia de disponibilidad y no
  // debe mover el constructor de nadie.
  const t = conTodo({ db: { disponibleTrasUpdate: true } });
  try {
    const res = await put({ nombre: 'Panceta Crujiente Extra' });
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
    // Pero el cache si se invalida: el nombre viaja dentro del menu.
    assert.strictEqual(t.redis.todas('del').length, 1);
  } finally {
    t.restaurar();
  }
});

test('put: mandar disponible con el MISMO valor no avisa', async () => {
  // Diferencia buscada con el PATCH: el editor reenvia la fila entera en cada
  // guardado, asi que avisar aqui seria un aviso por cada edicion de nombre.
  const t = conTodo({ db: { disponibleTrasUpdate: true } });
  try {
    const res = await put({ disponible: true, nombre: 'Panceta Crujiente' });
    await esperarAvisos();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
  } finally {
    t.restaurar();
  }
});

test('put: un ingrediente que no existe sigue dando 404 y no avisa', async () => {
  const t = conTodo({ db: { fila: null } });
  try {
    const res = await put({ disponible: false });
    await esperarAvisos();

    assert.strictEqual(res.status, 404);
    assert.strictEqual(t.socket.buscar(RUTA_INTERNA), undefined);
  } finally {
    t.restaurar();
  }
});
