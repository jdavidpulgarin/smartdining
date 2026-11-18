const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, CLAVE_FALSA } = require('./helpers/fake-socket');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const alias = require('../src/services/alias-comensal');
const ctrl = require('../src/controllers/mesas.controller');
const app = require('../server');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza' };

/**
 * Doble de BD con la fila de la mesa en el estado y con el token indicados.
 * `conPedidos` simula pedidos de la sesión actual (la guarda de continuidad).
 */
function dbMesa(estado = 'ocupada', tokenQr = 'token-anterior', { conPedidos = false } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return {
        rows: estado
          ? [{ ...MESA, id_mesa: Number(params[0]), estado, token_qr: tokenQr, sesion_iniciada_en: null }]
          : [],
      };
    }
    if (sql.includes('FROM pedidos p')) return { rows: [{ hay: conPedidos }] };
    if (sql.includes('UPDATE mesas SET token_qr = $1 WHERE id_mesa = $2')) {
      return { rows: [{ ...MESA, estado, token_qr: params[0] }] };
    }
    return { rows: [] };
  });
}

const rotar = (jwt, id = 5) => {
  const r = request(app).post(`/api/mesas/${id}/rotar-qr`);
  return jwt ? r.set('Authorization', `Bearer ${jwt}`) : r;
};

test('rotar-qr pide un token nuevo, lo guarda bajo bloqueo y avisa a la tablet después del commit', async () => {
  const { token } = construirTokenQr(5);
  const jwtMesero = tokenStaff(3, 'mesero');
  const socket = instalarFakeSocket((ruta) => (
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5, expira_en: 123 } : { ok: true }
  ));
  const db = dbMesa('ocupada');
  try {
    const res = await rotar(jwtMesero);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.url.includes(encodeURIComponent(token)));
    assert.strictEqual(res.body.expira_en, 123);
    assert.deepStrictEqual(res.body.mesa, { id_mesa: 5, numero: 5, estado: 'ocupada' });
    // El token solo viaja dentro de la url.
    assert.strictEqual(res.body.token, undefined);
    const { url, ...resto } = res.body;
    assert.ok(!JSON.stringify(resto).includes(token), 'ningún otro campo lleva el token');

    assert.ok(db.buscar('FOR UPDATE'), 'bloquea la fila');
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr = $1').params[0], token);
    const sqls = db.ejecutadas.map((q) => q.sql);
    assert.ok(sqls.indexOf('COMMIT') > sqls.findIndex((q) => q.includes('UPDATE mesas SET token_qr')));

    // /qr/generar con el JWT del personal; /internal/qr-rotado con la clave interna.
    const generar = socket.buscar('/qr/generar');
    assert.strictEqual(generar.cabeceras.Authorization, `Bearer ${jwtMesero}`);
    assert.ok(!generar.cabeceras['x-internal-key']);
    const aviso = socket.buscar('/internal/qr-rotado');
    assert.deepStrictEqual(aviso.cuerpo, { id_mesa: 5, token_qr: token });
    assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('rotar-qr exige mesero o admin', async () => {
  const socket = instalarFakeSocket();
  const db = dbMesa('ocupada');
  try {
    assert.strictEqual((await rotar(null)).status, 401);
    for (const rol of ['cajero', 'cocina']) {
      assert.strictEqual((await rotar(tokenStaff(1, rol))).status, 403, rol);
    }
    assert.strictEqual((await rotar(tokenComensal(5))).status, 403);
    assert.strictEqual(socket.avisos.length, 0, 'nadie sin permiso llega al socket-server');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('rotar-qr de una mesa no ocupada responde 409 y no toca nada', async () => {
  const socket = instalarFakeSocket();
  const db = dbMesa('disponible', null);
  try {
    const res = await rotar(tokenStaff(1, 'admin'));
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.estado, 'disponible');
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr'), undefined);
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(socket.avisos.length, 0);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('rotar-qr: id inválido 400, mesa inexistente 404', async () => {
  const socket = instalarFakeSocket();
  const db = dbMesa(null);
  try {
    assert.strictEqual((await rotar(tokenStaff(1, 'mesero'), 'x')).status, 400);
    assert.strictEqual((await rotar(tokenStaff(1, 'mesero'), 99)).status, 404);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('rotar-qr con el socket-server caído responde 503 y no guarda ni avisa', async () => {
  const socket = socketCaido();
  const db = dbMesa('ocupada');
  try {
    const res = await rotar(tokenStaff(1, 'mesero'));
    assert.strictEqual(res.status, 503);
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr'), undefined);
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(socket.buscar('/internal/qr-rotado'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('rotar-qr: si el socket-server rechaza el rol, se propaga 403 sin guardar', async () => {
  const socket = instalarFakeSocket((ruta) => (
    ruta === '/qr/generar' ? { __status: 403, ok: false, mensaje: 'Tu rol no puede generar QR' } : { ok: true }
  ));
  const db = dbMesa('ocupada');
  try {
    const res = await rotar(tokenStaff(1, 'mesero'));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// solo_si_vacia (#174): la misma guarda de continuidad que la rotación interna
// ---------------------------------------------------------------------------

const rotarCon = (cuerpo, id = 5, jwt = tokenStaff(3, 'mesero')) =>
  request(app).post(`/api/mesas/${id}/rotar-qr`).set('Authorization', `Bearer ${jwt}`).send(cuerpo);

let mesaSoloSiVacia = 810;

/** Socket que entrega un token nuevo, Redis falso, y la base con `opcionesDb`. */
function escenarioGuarda({ conPedidos = false } = {}, opcionesRedis = {}) {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) => (
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5, expira_en: 123 } : { ok: true }
  ));
  const redis = instalarFakeRedis(opcionesRedis);
  const db = dbMesa('ocupada', 'token-anterior', { conPedidos });
  return {
    token, socket, db,
    restaurar() { db.restaurar(); redis.restaurar(); socket.restaurar(); },
  };
}

/** Lo que tiene que pasar cuando la guarda frena: ni token nuevo ni aviso. */
function noRoto(e) {
  assert.strictEqual(e.db.buscar('UPDATE mesas SET token_qr'), undefined, 'el token no cambia');
  assert.ok(e.db.buscar('ROLLBACK'));
  assert.strictEqual(e.socket.buscar('/qr/generar'), undefined, 'ni se pide un token nuevo');
  assert.strictEqual(e.socket.buscar('/internal/qr-rotado'), undefined);
}

test('solo_si_vacia con la mesa vacía: rota igual que hoy, con la guarda dentro de la transacción', async () => {
  const id = mesaSoloSiVacia++;
  const e = escenarioGuarda();
  try {
    const res = await rotarCon({ solo_si_vacia: true }, id);
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.url.includes(encodeURIComponent(e.token)));
    assert.strictEqual(res.body.expira_en, 123);
    assert.strictEqual(res.body.token, undefined);
    assert.strictEqual(e.db.buscar('UPDATE mesas SET token_qr = $1').params[0], e.token);

    // BEGIN -> FOR UPDATE -> guarda (pedidos) -> UPDATE -> COMMIT.
    const sqls = e.db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    assert.ok(i('BEGIN') < i('FOR UPDATE'));
    assert.ok(i('FOR UPDATE') < i('FROM pedidos p'));
    assert.ok(i('FROM pedidos p') < i('UPDATE mesas SET token_qr'));
    assert.ok(i('UPDATE mesas SET token_qr') < i('COMMIT'));
  } finally {
    e.restaurar();
  }
});

test('solo_si_vacia con un pedido en la sesión: 409 mesa_con_comensales y NO rota', async () => {
  const e = escenarioGuarda({ conPedidos: true });
  try {
    const res = await rotarCon({ solo_si_vacia: true }, mesaSoloSiVacia++);
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.conComensales);
    assert.ok(res.body.error);
    noRoto(e);
  } finally {
    e.restaurar();
  }
});

for (const [caso, opciones] of [
  ['alguien entró por QR y reservó su nombre', { vigencia: '3h' }],
  ['el personal reservó el nombre de alguien sin celular', {
    vigencia: alias.VIGENCIA_SIN_CELULAR, extra: { [alias.MARCA_SIN_CELULAR]: true },
  }],
]) {
  test(`solo_si_vacia: ${caso} -> 409 mesa_con_comensales y NO rota`, async () => {
    const id = mesaSoloSiVacia++;
    const e = escenarioGuarda();
    try {
      await alias.reservar(id, alias.normalizarAlias('Ana'), opciones);
      const res = await rotarCon({ solo_si_vacia: true }, id);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.conComensales);
      noRoto(e);
    } finally {
      await alias.olvidarMesa(id);
      e.restaurar();
    }
  });
}

test('solo_si_vacia con Redis caído: 503 alias_no_disponible y NO rota', async () => {
  const e = escenarioGuarda({}, { caido: true });
  try {
    const res = await rotarCon({ solo_si_vacia: true }, mesaSoloSiVacia++);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, ctrl.MOTIVOS_ROTACION.reservasNoDisponibles);
    noRoto(e);
  } finally {
    e.restaurar();
  }
});

for (const [caso, cuerpo] of [['sin cuerpo', undefined], ['cuerpo {}', {}], ['solo_si_vacia: false', { solo_si_vacia: false }]]) {
  test(`${caso} y con comensales: rota como hoy (el "Nuevo QR" manual), sin mirar la guarda`, async () => {
    const id = mesaSoloSiVacia++;
    const e = escenarioGuarda({ conPedidos: true });
    try {
      await alias.reservar(id, alias.normalizarAlias('Ana'), { vigencia: '3h' });
      const res = cuerpo === undefined ? await rotar(tokenStaff(3, 'mesero'), id) : await rotarCon(cuerpo, id);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(e.db.buscar('UPDATE mesas SET token_qr = $1').params[0], e.token);
      assert.strictEqual(e.db.buscar('FROM pedidos p'), undefined, 'sin solo_si_vacia no hay guarda');
    } finally {
      await alias.olvidarMesa(id);
      e.restaurar();
    }
  });
}

for (const [caso, cuerpo] of [
  ['un campo extra', { solo_si_vacia: true, forzar: true }],
  ['solo_si_vacia como texto', { solo_si_vacia: 'true' }],
  ['solo_si_vacia null', { solo_si_vacia: null }],
  ['un arreglo', [true]],
]) {
  test(`rotar-qr con ${caso} -> 400 cuerpo_invalido, sin tocar nada`, async () => {
    const e = escenarioGuarda();
    try {
      const res = await rotarCon(cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.ok(res.body.error);
      // requireAuth sí consulta (el usuario activo); la rotación no empieza.
      assert.strictEqual(e.db.buscar('BEGIN'), undefined);
      assert.strictEqual(e.db.buscar('FOR UPDATE'), undefined);
      assert.strictEqual(e.db.buscar('UPDATE mesas SET token_qr'), undefined);
      assert.strictEqual(e.socket.avisos.length, 0);
    } finally {
      e.restaurar();
    }
  });
}

test('rotar-qr responde aunque falle el aviso a la tablet (el token ya quedó guardado)', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/generar') return { __status: 201, token, id_mesa: 5 };
    return new Error('connect ECONNREFUSED');
  });
  const db = dbMesa('ocupada');
  try {
    const res = await rotar(tokenStaff(1, 'mesero'));
    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr = $1').params[0], token);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});
