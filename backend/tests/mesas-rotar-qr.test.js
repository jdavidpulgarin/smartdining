const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza' };

/** Doble de BD con la fila de la mesa en el estado y con el token indicados. */
function dbMesa(estado = 'ocupada', tokenQr = 'token-anterior') {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: estado ? [{ ...MESA, estado, token_qr: tokenQr }] : [] };
    }
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
