const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, ES_UUID } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const { VIGENCIA_SIN_CELULAR: VIGENCIA } = alias;
const socketNotifier = require('../src/services/socket.notifier');

// D-18: comensales SIN CELULAR de la mesa.
//
// Alguien se sienta sin telefono y el mesero pide por esa persona. No hay tabla
// nueva: vive en la MISMA reserva de alias que las sesiones de QR, con la misma
// validacion, pero con vigencia de 24 h (la de sd:mesa:{id}:sin_celular del
// socket-server) en vez de las 3 h del JWT del comensal.
//
// Lo que se vigila aqui:
//   - la sesion de la mesa se comprueba ANTES de reservar, para no dejar un
//     alias reservado en una mesa que nadie va a usar;
//   - el alias que viaja al socket es SIEMPRE el normalizado, porque §6.4
//     compara texto identico al quitar: con otra capitalizacion, la persona se
//     quedaria sentada para siempre;
//   - no se quita a alguien que ya tiene platos: su consumo quedaria sin dueno
//     y otro podria reservar su nombre y heredarselos;
//   - los reintentos son solo ante ERROR_INTERNO y con el MISMO eventId;
//   - los avisos de una misma mesa salen en serie.

const MESA = 5;

/** Mesa con sesion abierta, que es el caso normal. */
const mesaOcupada = (id = MESA) => ({
  id_mesa: id, numero: id, capacidad: 4, ubicacion: 'Terraza', estado: 'ocupada', token_qr: 'tok',
});

/**
 * @param {{mesa?: object|null, cuenta?: object|null}} opciones
 *   `mesa`: fila que devuelve SELECT * FROM mesas (null = 404).
 *   `cuenta`: lo que devuelve obtener_cuenta_mesa_json (null = mesa inexistente).
 */
function fakeMesa({ mesa = mesaOcupada(), cuenta = { id_mesa: MESA, comensales: [] } } = {}) {
  return instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) return { rows: mesa ? [mesa] : [] };
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: cuenta ? [{ '1': 1 }] : [] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta }] };
    return undefined;
  });
}

const mesero = () => tokenStaff(9, 'mesero');
const admin = () => tokenStaff(1, 'admin');

const agregar = (token, cuerpo, id = MESA) => request(app)
  .post(`/api/mesas/${id}/comensales`)
  .set('Authorization', `Bearer ${token}`)
  .send(cuerpo);

const quitar = (token, aliasUrl, id = MESA) => request(app)
  .delete(`/api/mesas/${id}/comensales/${encodeURIComponent(aliasUrl)}`)
  .set('Authorization', `Bearer ${token}`);

/** Cada prueba usa una mesa distinta: la reserva en memoria dura todo el proceso. */
let siguienteMesa = 900;
const mesaNueva = () => (siguienteMesa += 1);

// ---------------------------------------------------------------------------
// liberar(): suelta UN alias, no la mesa entera
// ---------------------------------------------------------------------------

test('d-18: liberar borra SOLO ese alias del hash de la mesa', async () => {
  const redis = instalarFakeRedis();
  try {
    const ana = alias.normalizarAlias('Ana');
    const beto = alias.normalizarAlias('Beto');
    await alias.reservar(MESA, ana, { vigencia: VIGENCIA });
    await alias.reservar(MESA, beto, { vigencia: VIGENCIA });

    const suelta = await alias.liberar(MESA, ana.clave);

    assert.deepStrictEqual(suelta, { ok: true });
    const hash = redis.valorDe(alias.llave(MESA));
    assert.strictEqual(hash[ana.clave], undefined, 'Ana se fue');
    assert.ok(hash[beto.clave], 'Beto sigue sentado');
    assert.deepStrictEqual(redis.todas('hDel'), [{ op: 'hDel', clave: alias.llave(MESA), campo: 'ana' }]);
  } finally {
    redis.restaurar();
  }
});

test('d-18: liberar NO usa del, que borraria los alias de todos', async () => {
  const redis = instalarFakeRedis();
  try {
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: VIGENCIA });
    await alias.liberar(MESA, 'ana');
    assert.deepStrictEqual(redis.todas('del'), [], 'olvidarMesa es otra cosa');
  } finally {
    redis.restaurar();
  }
});

test('d-18: tras liberar, ese nombre se puede volver a reservar', async () => {
  const redis = instalarFakeRedis();
  try {
    const ana = alias.normalizarAlias('Ana');
    assert.deepStrictEqual(await alias.reservar(MESA, ana, { vigencia: VIGENCIA }), { ok: true });
    assert.deepStrictEqual(await alias.reservar(MESA, ana, { vigencia: VIGENCIA }), { enUso: true });

    await alias.liberar(MESA, ana.clave);
    assert.deepStrictEqual(await alias.reservar(MESA, ana, { vigencia: VIGENCIA }), { ok: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: liberar un alias que no estaba no es un error', async () => {
  const redis = instalarFakeRedis();
  try {
    // Mismo criterio que §6.4: quitar a quien no esta es la misma situacion
    // final, no un fallo.
    assert.deepStrictEqual(await alias.liberar(MESA, 'nadie'), { ok: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: con Redis caido, liberar avisa que no pudo', async () => {
  const redis = instalarFakeRedis({ caido: true });
  try {
    assert.deepStrictEqual(await alias.liberar(MESA, 'ana'), { noDisponible: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: si Redis falla en el hDel, tampoco dice que lo solto', async () => {
  const redis = instalarFakeRedis({ falloEn: ['hDel'] });
  try {
    assert.deepStrictEqual(await alias.liberar(MESA, 'ana'), { noDisponible: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: sin Redis (desarrollo) liberar borra del respaldo en memoria', async () => {
  // Sin REDIS_URL no hay cliente: alias-comensal usa el Map en memoria.
  const mesa = mesaNueva();
  const ana = alias.normalizarAlias('Ana');
  assert.deepStrictEqual(await alias.reservar(mesa, ana, { vigencia: VIGENCIA }), { ok: true });
  assert.deepStrictEqual(await alias.reservar(mesa, ana, { vigencia: VIGENCIA }), { enUso: true });

  assert.deepStrictEqual(await alias.liberar(mesa, ana.clave), { ok: true });
  assert.deepStrictEqual(await alias.reservar(mesa, ana, { vigencia: VIGENCIA }), { ok: true });
});

test('d-18: en memoria, liberar no toca a los demas comensales', async () => {
  const mesa = mesaNueva();
  const ana = alias.normalizarAlias('Ana');
  const beto = alias.normalizarAlias('Beto');
  await alias.reservar(mesa, ana, { vigencia: VIGENCIA });
  await alias.reservar(mesa, beto, { vigencia: VIGENCIA });

  await alias.liberar(mesa, ana.clave);

  assert.deepStrictEqual(await alias.reservar(mesa, beto, { vigencia: VIGENCIA }), { enUso: true });
});

// ---------------------------------------------------------------------------
// POST /api/mesas/:id/comensales — permisos y validacion
// ---------------------------------------------------------------------------

test('d-18: sin token, 401; con otros roles, 403', async () => {
  const db = fakeMesa();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    assert.strictEqual((await request(app).post(`/api/mesas/${MESA}/comensales`).send({ alias: 'Abuela' })).status, 401);
    for (const rol of ['cajero', 'cocina']) {
      const res = await agregar(tokenStaff(4, rol), { alias: 'Abuela' });
      assert.strictEqual(res.status, 403, rol);
    }
    // El comensal tampoco: agregar personas a la mesa es de sala.
    const res = await request(app)
      .post(`/api/mesas/${MESA}/comensales`)
      .set('Authorization', `Bearer ${tokenComensal(MESA)}`)
      .send({ alias: 'Abuela' });
    assert.strictEqual(res.status, 403);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('d-18: el alias se valida con la MISMA regla de las sesiones de QR', async () => {
  const db = fakeMesa();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Los mismos casos que rechaza normalizarAlias (R-18): no hay una segunda
    // regla que acepte lo que la otra rechaza.
    for (const malo of [undefined, null, 5, '', ' ', 'A', 'a'.repeat(41), '<script>', 'Ana/Beto']) {
      const res = await agregar(mesero(), malo === undefined ? {} : { alias: malo });
      assert.strictEqual(res.status, 400, JSON.stringify(malo));
      assert.strictEqual(res.body.campo, 'alias');
    }
    assert.ok(!db.buscar('hSetNX'), 'no se reservo nada');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('d-18: un id de mesa que no es entero positivo es 400', async () => {
  const db = fakeMesa();
  try {
    for (const malo of ['abc', '0', '-3', '1.5']) {
      const res = await agregar(mesero(), { alias: 'Abuela' }, malo);
      assert.strictEqual(res.status, 400, malo);
    }
  } finally {
    db.restaurar();
  }
});

test('d-18: una mesa que no existe es 404', async () => {
  const db = fakeMesa({ mesa: null });
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /no encontrada/i);
  } finally {
    db.restaurar();
  }
});

test('d-18: una mesa sin sesion abierta es 409, y NO se reserva el alias', async () => {
  for (const estado of ['disponible', 'reservada', 'mantenimiento']) {
    const db = fakeMesa({ mesa: { ...mesaOcupada(), estado, token_qr: null } });
    const redis = instalarFakeRedis();
    const socket = instalarFakeSocket(() => ({ ok: true }));
    try {
      const res = await agregar(mesero(), { alias: 'Abuela' });

      assert.strictEqual(res.status, 409, estado);
      assert.strictEqual(res.body.motivo, 'mesa_sin_sesion');
      // La comprobacion va ANTES de reservar: si no, quedaria un alias
      // reservado en una mesa que nadie va a usar.
      assert.deepStrictEqual(redis.todas('hSetNX'), [], 'no se reservo nada');
      assert.deepStrictEqual(socket.avisos, [], 'ni se aviso al socket');
    } finally {
      socket.restaurar();
      redis.restaurar();
      db.restaurar();
    }
  }
});

// ---------------------------------------------------------------------------
// POST — camino feliz y reserva de 24 h
// ---------------------------------------------------------------------------

test('d-18: da de alta al comensal y devuelve el alias normalizado', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await agregar(mesero(), { alias: '  La   Abuela ' });

    assert.strictEqual(res.status, 201);
    // Espacios recortados y colapsados, como en las sesiones de QR.
    assert.deepStrictEqual(res.body, { id_mesa: MESA, alias: 'La Abuela' });
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: el admin tambien puede', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    assert.strictEqual((await agregar(admin(), { alias: 'Abuela' })).status, 201);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: la reserva dura 24 h, no las 3 h del JWT del comensal', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });

    // Es la vigencia de sd:mesa:{id}:sin_celular (EVENTS.md §6.4). Con 3 h el
    // alias se liberaria a media tarde con la persona todavia sentada.
    assert.strictEqual(redis.ttlDe(alias.llave(MESA)), 24 * 60 * 60);
    assert.strictEqual(alias.segundos(VIGENCIA), 86400);
    // La constante vive en un solo sitio y tiene que coincidir con el TTL de
    // sd:mesa:{id}:sin_celular del socket-server (EVENTS.md §6.4).
    assert.strictEqual(VIGENCIA, '24h');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: se guarda en el MISMO hash de alias que las sesiones de QR', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });

    const hash = redis.valorDe(alias.llave(MESA));
    assert.ok(hash.abuela, 'la clave normalizada es el campo del hash');
    assert.strictEqual(JSON.parse(hash.abuela).alias, 'Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un alias ya usado en la mesa es 409', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    assert.strictEqual((await agregar(mesero(), { alias: 'Abuela' })).status, 201);

    // Y una variante por mayusculas o tildes es el mismo nombre (misma clave).
    const repetido = await agregar(mesero(), { alias: 'abuéla' });
    assert.strictEqual(repetido.status, 409);
    assert.strictEqual(repetido.body.motivo, 'alias_en_uso');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: con Redis caido no se da de alta a nadie (503)', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });

    // Igual que las sesiones de QR: sin unicidad garantizada no se sienta a
    // nadie, porque se le podrian cargar los platos a otra persona.
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, 'alias_no_disponible');
    assert.deepStrictEqual(socket.avisos, [], 'no se aviso de un alta que no ocurrio');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El aviso al socket-server (§6.4)
// ---------------------------------------------------------------------------

test('d-18: el aviso lleva el cuerpo exacto del contrato', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    const aviso = socket.buscar('/internal/mesa-comensal');
    assert.ok(aviso, 'se aviso a la ruta de §6.4');
    assert.deepStrictEqual(Object.keys(aviso.cuerpo).sort(), ['accion', 'alias', 'eventId', 'id_mesa']);
    assert.strictEqual(aviso.cuerpo.id_mesa, MESA);
    assert.strictEqual(aviso.cuerpo.alias, 'Abuela');
    assert.strictEqual(aviso.cuerpo.accion, 'agregar');
    assert.match(aviso.cuerpo.eventId, ES_UUID);
    assert.strictEqual(aviso.cabeceras['x-internal-key'], socket.clave);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: viaja el alias NORMALIZADO, no lo que escribio el mesero', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: '  La   Abuela ' });
    await socketNotifier.esperarAvisos();

    // §6.4 compara texto IDENTICO para quitar: si se mandara el texto crudo,
    // el quitar posterior no coincidiria y la persona se quedaria sentada.
    assert.strictEqual(socket.buscar('/internal/mesa-comensal').cuerpo.alias, 'La Abuela');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: cada accion lleva su propio eventId', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    await agregar(mesero(), { alias: 'Abuelo' });
    await socketNotifier.esperarAvisos();

    const ids = socket.todos('/internal/mesa-comensal').map((a) => a.cuerpo.eventId);
    assert.strictEqual(ids.length, 2);
    assert.strictEqual(new Set(ids).size, 2, 'un eventId por accion');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: si la ruta R-19 no existe todavia (404), el alta sigue siendo 201', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 404, ok: false, codigo: 'NO_ENCONTRADA' }));
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    // La reserva ya esta hecha y el backend es la fuente de verdad.
    assert.strictEqual(res.status, 201);
    assert.strictEqual(redis.valorDe(alias.llave(MESA)).abuela !== undefined, true, 'el alias sigue reservado');
    assert.strictEqual(socket.todos('/internal/mesa-comensal').length, 1, 'un 404 no se reintenta');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: con el socket-server caido, el alta sigue siendo 201', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = socketCaido();
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(socket.todos('/internal/mesa-comensal').length, 1, 'tampoco se reintenta');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un 409 del socket libera el alias reservado y responde 409', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 409, ok: false, codigo: 'LIMITE_COMENSALES' }));
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'LIMITE_COMENSALES');
    assert.match(res.body.error, /maximo|máximo/i);
    // Sin esto quedaria una reserva sin presencia: nadie podria volver a usar
    // ese nombre y la persona no apareceria en la mesa.
    assert.strictEqual(redis.valorDe(alias.llave(MESA)).abuela, undefined, 'el alias se solto');
    assert.strictEqual(socket.todos('/internal/mesa-comensal').length, 1, 'un 4xx no se reintenta');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un 409 ALIAS_EN_USO del socket se traduce para quien esta en sala', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 409, ok: false, codigo: 'ALIAS_EN_USO' }));
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /ya lo usa otra persona/i);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Reintentos (§6.4): solo ERROR_INTERNO, mismo eventId
// ---------------------------------------------------------------------------

test('d-18: un 503 ERROR_INTERNO se reintenta con el MISMO eventId', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  let intentos = 0;
  const socket = instalarFakeSocket(() => {
    intentos += 1;
    // Falla las dos primeras veces y a la tercera aplica.
    if (intentos < 3) return { __status: 503, ok: false, codigo: 'ERROR_INTERNO' };
    return { ok: true, duplicado: false };
  });
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    const enviados = socket.todos('/internal/mesa-comensal');
    assert.strictEqual(enviados.length, 3, 'tres intentos');
    const ids = new Set(enviados.map((a) => a.cuerpo.eventId));
    // El mismo eventId es lo que hace seguro repetir: el socket-server
    // deduplica por backend:mesa-comensal:{eventId}.
    assert.strictEqual(ids.size, 1, 'el mismo eventId en los tres');
    assert.strictEqual(res.status, 201);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: los reintentos tienen tope', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 500, ok: false, codigo: 'ERROR_INTERNO' }));
  try {
    const res = await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    assert.strictEqual(socket.todos('/internal/mesa-comensal').length, socketNotifier.MAX_INTENTOS);
    assert.strictEqual(res.status, 201, 'el alta no depende del aviso');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un 503 NO_CONFIGURADO NO se reintenta', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 503, ok: false, codigo: 'NO_CONFIGURADO' }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    await socketNotifier.esperarAvisos();

    // No se arregla reintentando: al socket-server le falta INTERNAL_API_KEY.
    assert.strictEqual(socket.todos('/internal/mesa-comensal').length, 1);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: ningun 4xx se reintenta', async () => {
  for (const status of [400, 401, 409]) {
    const db = fakeMesa();
    const redis = instalarFakeRedis();
    const socket = instalarFakeSocket(() => ({ __status: status, ok: false, codigo: 'PAYLOAD_INVALIDO' }));
    try {
      await agregar(mesero(), { alias: 'Abuela' });
      await socketNotifier.esperarAvisos();
      assert.strictEqual(socket.todos('/internal/mesa-comensal').length, 1, `status ${status}`);
    } finally {
      socket.restaurar();
      redis.restaurar();
      db.restaurar();
    }
  }
});

test('d-18: esReintentable solo acepta 500/502/503 con ERROR_INTERNO', () => {
  const si = (motivo) => socketNotifier.esReintentable({ ok: false, motivo, respuesta: { codigo: 'ERROR_INTERNO' } });
  assert.strictEqual(si('HTTP_500'), true);
  assert.strictEqual(si('HTTP_502'), true);
  assert.strictEqual(si('HTTP_503'), true);

  assert.strictEqual(si('HTTP_404'), false);
  assert.strictEqual(si('HTTP_409'), false);
  assert.strictEqual(si('TIMEOUT'), false);
  assert.strictEqual(si('INALCANZABLE'), false);
  assert.strictEqual(si('SIN_CONFIGURAR'), false);

  // Mismo status, otro codigo: no.
  assert.strictEqual(
    socketNotifier.esReintentable({ ok: false, motivo: 'HTTP_503', respuesta: { codigo: 'NO_CONFIGURADO' } }),
    false
  );
  // Sin cuerpo tampoco se adivina.
  assert.strictEqual(socketNotifier.esReintentable({ ok: false, motivo: 'HTTP_500' }), false);
  assert.strictEqual(socketNotifier.esReintentable({ ok: true }), false);
  assert.strictEqual(socketNotifier.esReintentable(null), false);
});

test('d-18: los avisos que ya existian NO reintentan', async () => {
  // El reintento es una capa aparte: `enviar` sigue sin reintentar, así que un
  // aviso de disponibilidad con ERROR_INTERNO se manda una sola vez.
  const socket = instalarFakeSocket(() => ({ __status: 500, ok: false, codigo: 'ERROR_INTERNO' }));
  try {
    await socketNotifier.notificarPlatoDisponibilidad(7, false);
    assert.strictEqual(socket.todos('/internal/plato-disponibilidad').length, 1);
  } finally {
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Serie por mesa y el 'agregar' obsoleto
// ---------------------------------------------------------------------------

test('d-18: los avisos de una misma mesa salen EN SERIE', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const orden = [];
  let enVuelo = 0;
  const socket = instalarFakeSocket(async (ruta, cuerpo) => {
    enVuelo += 1;
    assert.strictEqual(enVuelo, 1, 'nunca hay dos avisos de la mesa a la vez');
    orden.push(`${cuerpo.accion}:${cuerpo.alias}`);
    await new Promise((r) => setTimeout(r, 5));
    enVuelo -= 1;
    return { ok: true };
  });
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    await quitar(mesero(), 'Abuela');
    await socketNotifier.esperarAvisos();

    // Sin la cadena por mesa, el quitar podria adelantarse al agregar y la
    // persona se quedaria sentada.
    assert.deepStrictEqual(orden, ['agregar:Abuela', 'quitar:Abuela']);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: una mesa lenta no bloquea a otra', async () => {
  const otra = 6;
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) return { rows: [mesaOcupada(MESA)] };
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ '1': 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) return { rows: [{ cuenta: { comensales: [] } }] };
    return undefined;
  });
  const redis = instalarFakeRedis();
  const empezados = [];
  const socket = instalarFakeSocket(async (ruta, cuerpo) => {
    empezados.push(cuerpo.id_mesa);
    // La mesa 5 tarda; la 6 no debe esperarla.
    if (cuerpo.id_mesa === MESA) await new Promise((r) => setTimeout(r, 30));
    return { ok: true };
  });
  try {
    const lenta = agregar(mesero(), { alias: 'Abuela' }, MESA);
    const rapida = agregar(mesero(), { alias: 'Abuelo' }, otra);
    await Promise.all([lenta, rapida]);
    await socketNotifier.esperarAvisos();

    assert.strictEqual(empezados.length, 2);
    assert.ok(empezados.includes(MESA) && empezados.includes(otra));
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un agregar que falla no se reintenta si ya se pidio quitar', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const enviados = [];
  const socket = instalarFakeSocket((ruta, cuerpo) => {
    enviados.push(cuerpo.accion);
    // El 'agregar' falla con ERROR_INTERNO (reintentable); el 'quitar' aplica.
    if (cuerpo.accion === 'agregar') return { __status: 503, ok: false, codigo: 'ERROR_INTERNO' };
    return { ok: true };
  });
  try {
    // El alta no se espera: mientras reintenta su aviso, entra el quitar.
    const alta = agregar(mesero(), { alias: 'Abuela' });
    const baja = quitar(mesero(), 'Abuela');
    await Promise.all([alta, baja]);
    await socketNotifier.esperarAvisos();

    // Reintentar el 'agregar' volveria a sentar a alguien que el mesero acaba
    // de quitar, asi que se abandona en cuanto hay un 'quitar' mas nuevo.
    const agregares = enviados.filter((a) => a === 'agregar').length;
    assert.ok(agregares < socketNotifier.MAX_INTENTOS, `se reintento ${agregares} veces`);
    assert.ok(enviados.includes('quitar'), 'el quitar si se envio');
    assert.strictEqual(enviados[enviados.length - 1], 'quitar', 'y es el ultimo');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un quitar que falla SI se reintenta: es el estado final', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ __status: 503, ok: false, codigo: 'ERROR_INTERNO' }));
  try {
    await quitar(mesero(), 'Abuela');
    await socketNotifier.esperarAvisos();

    assert.strictEqual(
      socket.todos('/internal/mesa-comensal').filter((a) => a.cuerpo.accion === 'quitar').length,
      socketNotifier.MAX_INTENTOS
    );
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/mesas/:id/comensales/:alias
// ---------------------------------------------------------------------------

test('d-18: quitar sin token es 401; con otros roles, 403', async () => {
  const db = fakeMesa();
  try {
    assert.strictEqual((await request(app).delete(`/api/mesas/${MESA}/comensales/Abuela`)).status, 401);
    for (const rol of ['cajero', 'cocina']) {
      assert.strictEqual((await quitar(tokenStaff(4, rol), 'Abuela')).status, 403, rol);
    }
  } finally {
    db.restaurar();
  }
});

test('d-18: un alias invalido en la URL es 400', async () => {
  const db = fakeMesa();
  try {
    for (const malo of ['A', 'a'.repeat(41), '   ', '<x>']) {
      const res = await quitar(mesero(), malo);
      assert.strictEqual(res.status, 400, malo);
      assert.strictEqual(res.body.campo, 'alias');
    }
  } finally {
    db.restaurar();
  }
});

test('d-18: quitar de una mesa que no existe es 404', async () => {
  const db = fakeMesa({ cuenta: null });
  try {
    const res = await quitar(mesero(), 'Abuela');
    assert.strictEqual(res.status, 404);
  } finally {
    db.restaurar();
  }
});

test('d-18: SIN platos se quita y responde 204', async () => {
  const db = fakeMesa({ cuenta: { id_mesa: MESA, comensales: [] } });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    const res = await quitar(mesero(), 'Abuela');

    assert.strictEqual(res.status, 204);
    assert.deepStrictEqual(res.body, {});
    assert.strictEqual(redis.valorDe(alias.llave(MESA)).abuela, undefined, 'el alias se solto');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: CON platos no se quita: 409 con mensaje claro', async () => {
  const db = fakeMesa({
    cuenta: {
      id_mesa: MESA,
      comensales: [{ comensal: 'Abuela', items_pedidos: 2, subtotal: '40000', pagado: '0', saldo: '40000' }],
    },
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    const res = await quitar(mesero(), 'Abuela');

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_con_platos');
    assert.match(res.body.error, /platos en la cuenta/i);
    assert.ok(redis.valorDe(alias.llave(MESA)).abuela, 'sigue reservado');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: los platos se buscan por CLAVE del alias, no por el texto', async () => {
  // La cuenta agrupa por btrim(dp.comensal), que distingue mayusculas y
  // tildes: si se comparara el texto, quitar a "abuela" pasaria aunque
  // hubiera platos cargados a "Abuela", que es la misma persona.
  const db = fakeMesa({
    cuenta: {
      id_mesa: MESA,
      comensales: [{ comensal: 'Abuéla', items_pedidos: 1, subtotal: '20000', pagado: '0', saldo: '20000' }],
    },
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Se da de alta con tilde y se quita sin ella: misma clave, misma persona.
    assert.strictEqual((await agregar(mesero(), { alias: 'Abuéla' })).status, 201);

    const res = await quitar(mesero(), 'abuela');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_con_platos');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: quitar a alguien que no esta reservado es 204 idempotente', async () => {
  // Criterio de siempre: no hay nada que soltar y pedirlo dos veces no es un
  // error. Es lo mismo que hace §6.4 con un 'quitar' de quien no esta.
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await quitar(mesero(), 'Nadie');
    assert.strictEqual(res.status, 204);

    await socketNotifier.esperarAvisos();
    // Se avisa igual: el TTL de aqui y el del socket-server son dos relojes
    // distintos y alla puede seguir en la lista.
    assert.strictEqual(socket.buscar('/internal/mesa-comensal').cuerpo.accion, 'quitar');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: los platos de OTRO comensal no estorban', async () => {
  const db = fakeMesa({
    cuenta: {
      id_mesa: MESA,
      comensales: [{ comensal: 'Ana', items_pedidos: 3, subtotal: '60000', pagado: '0', saldo: '60000' }],
    },
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    assert.strictEqual((await quitar(mesero(), 'Abuela')).status, 204);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: un comensal con 0 items si se puede quitar', async () => {
  // Puede salir en la cuenta por un pago sin consumo (FULL OUTER JOIN de
  // obtener_cuenta_mesa): lo que bloquea son los PLATOS.
  const db = fakeMesa({
    cuenta: {
      id_mesa: MESA,
      comensales: [{ comensal: 'Abuela', items_pedidos: 0, subtotal: '0', pagado: '0', saldo: '0' }],
    },
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });
    assert.strictEqual((await quitar(mesero(), 'Abuela')).status, 204);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: el aviso de quitar lleva accion quitar y el alias normalizado', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await quitar(mesero(), '  la   abuela ');
    await socketNotifier.esperarAvisos();

    const aviso = socket.buscar('/internal/mesa-comensal');
    assert.strictEqual(aviso.cuerpo.accion, 'quitar');
    assert.strictEqual(aviso.cuerpo.alias, 'la abuela', 'normalizado, no el texto de la URL');
    assert.match(aviso.cuerpo.eventId, ES_UUID);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: con Redis caido, quitar responde 503 y no avisa', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await quitar(mesero(), 'Abuela');

    // Responder 204 seria mentir: la reserva sigue ahi.
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, 'alias_no_disponible');
    assert.deepStrictEqual(socket.avisos, []);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La marca sin_celular: quien entro por QR no se puede quitar desde aqui
// ---------------------------------------------------------------------------

test('d-18: el alta MARCA el alias como sin celular', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await agregar(mesero(), { alias: 'Abuela' });

    const guardado = JSON.parse(redis.valorDe(alias.llave(MESA)).abuela);
    assert.strictEqual(guardado.alias, 'Abuela');
    assert.strictEqual(guardado[alias.MARCA_SIN_CELULAR], true);
    // Y el resto del valor sigue igual que siempre.
    assert.ok(guardado.en, 'conserva la marca de tiempo');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: la sesion por QR NO lleva la marca', async () => {
  const redis = instalarFakeRedis();
  try {
    // El flujo del QR llama a reservar sin `extra`: el valor guardado no cambia.
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });

    const guardado = JSON.parse(redis.valorDe(alias.llave(MESA)).ana);
    assert.deepStrictEqual(Object.keys(guardado).sort(), ['alias', 'en']);
    assert.strictEqual(guardado[alias.MARCA_SIN_CELULAR], undefined);
  } finally {
    redis.restaurar();
  }
});

test('d-18: esSinCelular distingue los tres casos', async () => {
  const redis = instalarFakeRedis();
  try {
    // No existe.
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'nadie'), { noExiste: true });

    // Existe, pero es de QR (sin marca).
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'ana'), { sinCelular: false });

    // Existe y es sin celular.
    await alias.reservar(MESA, alias.normalizarAlias('Abuela'), {
      vigencia: VIGENCIA,
      extra: { [alias.MARCA_SIN_CELULAR]: true },
    });
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'abuela'), { sinCelular: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: esSinCelular con Redis caido no adivina', async () => {
  const redis = instalarFakeRedis({ caido: true });
  try {
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'abuela'), { noDisponible: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: si falla el hGet, tampoco adivina', async () => {
  const redis = instalarFakeRedis({ falloEn: ['hGet'] });
  try {
    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'abuela'), { noDisponible: true });
  } finally {
    redis.restaurar();
  }
});

test('d-18: un valor guardado ilegible se trata como de QR', async () => {
  // Ante la duda no se suelta la reserva de nadie: solo cuesta un 409.
  const redis = instalarFakeRedis({ inicial: {} });
  try {
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });
    // Se corrompe el valor a mano, como si lo hubiera escrito otra version.
    const hash = redis.valorDe(alias.llave(MESA));
    hash.ana = 'esto-no-es-json';
    redis.poner(alias.llave(MESA), hash);

    assert.deepStrictEqual(await alias.esSinCelular(MESA, 'ana'), { sinCelular: false });
  } finally {
    redis.restaurar();
  }
});

test('d-18: esSinCelular funciona con el respaldo en memoria', async () => {
  // Sin REDIS_URL: la marca se guarda y se lee del Map en memoria.
  const mesa = mesaNueva();
  assert.deepStrictEqual(await alias.esSinCelular(mesa, 'abuela'), { noExiste: true });

  await alias.reservar(mesa, alias.normalizarAlias('Ana'), { vigencia: '3h' });
  assert.deepStrictEqual(await alias.esSinCelular(mesa, 'ana'), { sinCelular: false });

  await alias.reservar(mesa, alias.normalizarAlias('Abuela'), {
    vigencia: VIGENCIA,
    extra: { [alias.MARCA_SIN_CELULAR]: true },
  });
  assert.deepStrictEqual(await alias.esSinCelular(mesa, 'abuela'), { sinCelular: true });
});

test('d-18: en memoria, una reserva vencida cuenta como que no existe', async () => {
  const mesa = mesaNueva();
  const reloj = { t: 1_000_000 };
  await alias.reservar(mesa, alias.normalizarAlias('Abuela'), {
    vigencia: '1s',
    ahora: () => reloj.t,
    extra: { [alias.MARCA_SIN_CELULAR]: true },
  });
  assert.deepStrictEqual(await alias.esSinCelular(mesa, 'abuela', { ahora: () => reloj.t }), {
    sinCelular: true,
  });

  reloj.t += 2000;
  assert.deepStrictEqual(await alias.esSinCelular(mesa, 'abuela', { ahora: () => reloj.t }), {
    noExiste: true,
  });
});

test('d-18: NO se puede quitar a alguien que entro por QR: 409', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Ana abrio su sesion escaneando el QR: su reserva no lleva la marca.
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });

    const res = await quitar(mesero(), 'Ana');

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_con_sesion');
    assert.match(res.body.error, /con su celular/i);

    // Y lo importante: su reserva sigue intacta y no se avisó nada.
    assert.ok(redis.valorDe(alias.llave(MESA)).ana, 'la reserva de Ana sigue ahi');
    assert.deepStrictEqual(redis.todas('hDel'), [], 'no se llamo a liberar');
    assert.deepStrictEqual(socket.avisos, [], 'ni se aviso al socket');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: una reserva VIEJA sin marca tampoco se puede quitar', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Como la escribiria una version anterior a este cambio: { alias, en } y
    // nada mas. No se puede saber de donde salio, asi que falla cerrada.
    redis.poner(alias.llave(MESA), {
      abuela: JSON.stringify({ alias: 'Abuela', en: '2026-11-08T10:00:00.000Z' }),
    });

    const res = await quitar(mesero(), 'Abuela');

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_con_sesion');
    assert.deepStrictEqual(socket.avisos, []);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: la marca se comprueba ANTES de los platos', async () => {
  // Si se mirara primero la cuenta, alguien con sesion de QR y sin platos se
  // podria quitar, y su nombre quedaria libre para otro comensal.
  const db = fakeMesa({ cuenta: { id_mesa: MESA, comensales: [] } });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    await alias.reservar(MESA, alias.normalizarAlias('Ana'), { vigencia: '3h' });

    const res = await quitar(mesero(), 'Ana');
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'comensal_con_sesion', 'no el de los platos');
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: con Redis caido no se decide nada: 503 antes de tocar la reserva', async () => {
  const db = fakeMesa();
  const redis = instalarFakeRedis({ caido: true });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const res = await quitar(mesero(), 'Abuela');

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, 'alias_no_disponible');
    assert.deepStrictEqual(socket.avisos, []);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: con el respaldo en memoria, el de QR tampoco se quita', async () => {
  const mesa = mesaNueva();
  const db = fakeMesa({ mesa: mesaOcupada(mesa), cuenta: { id_mesa: mesa, comensales: [] } });
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    // Sin fake-redis: alias-comensal usa el Map en memoria.
    await alias.reservar(mesa, alias.normalizarAlias('Ana'), { vigencia: '3h' });

    const deQr = await quitar(mesero(), 'Ana', mesa);
    assert.strictEqual(deQr.status, 409);
    assert.strictEqual(deQr.body.motivo, 'comensal_con_sesion');

    // Y el sin celular de la misma mesa sí.
    assert.strictEqual((await agregar(mesero(), { alias: 'Abuela' }, mesa)).status, 201);
    assert.strictEqual((await quitar(mesero(), 'Abuela', mesa)).status, 204);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El pedido del mesero y la cuenta (punto 4: verificar, no cambiar)
// ---------------------------------------------------------------------------

test('d-18: el mesero puede pedir con el alias del comensal sin celular', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) return { rows: [mesaOcupada(MESA)] };
    if (sql.includes('INSERT INTO pedidos')) {
      return { rows: [{ id_pedido: 77, id_mesa: MESA, estado: 'recibido', total: '20000', codigo_pedido: 'P-77' }] };
    }
    return undefined;
  });
  const redis = instalarFakeRedis();
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const alta = await agregar(mesero(), { alias: 'Abuela' });
    assert.strictEqual(alta.status, 201);

    const pedido = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${mesero()}`)
      .send({ id_mesa: MESA, items: [{ id_plato: 1, cantidad: 1, comensal: alta.body.alias }] });

    assert.strictEqual(pedido.status, 201);
    // El alias queda en su columna (detalles_pedido.comensal), que es de donde
    // la cuenta agrupa por persona. No hace falta ningun cambio para esto.
    const insert = db.buscar('INSERT INTO detalles_pedido');
    assert.ok(insert, 'se inserto el detalle');
    assert.ok(insert.params.includes('Abuela'), `el alias viaja al INSERT: ${JSON.stringify(insert.params)}`);
  } finally {
    socket.restaurar();
    redis.restaurar();
    db.restaurar();
  }
});

test('d-18: la cuenta de la mesa muestra al comensal sin celular', async () => {
  const db = fakeMesa({
    cuenta: {
      id_mesa: MESA,
      comensales: [{ comensal: 'Abuela', items_pedidos: 1, subtotal: '20000', pagado: '0', saldo: '20000' }],
    },
  });
  try {
    const res = await request(app)
      .get(`/api/mesas/${MESA}/cuenta`)
      .set('Authorization', `Bearer ${mesero()}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.comensales.map((c) => c.comensal), ['Abuela']);
  } finally {
    db.restaurar();
  }
});
