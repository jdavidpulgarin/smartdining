const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {
  instalarFakeDb,
  tokenComensal,
  tokenComensalDeOtraSesion,
  tokenStaff,
  construirTokenQr,
} = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido } = require('./helpers/fake-socket');
const app = require('../server');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado: 'ocupada' };

/** Doble de BD con esa mesa y ese token_qr en la columna. */
function dbConMesa(tokenQr, mesa = MESA) {
  return instalarFakeDb(
    (sql) => (sql.includes('FROM mesas WHERE id_mesa') ? { rows: [{ ...mesa, token_qr: tokenQr }] } : { rows: [] }),
    { tokenQrDeMesa: tokenQr }
  );
}

/** Doble del socket-server que da por válido ese token y rechaza el resto. */
function socketQueValida(tokenValido, idMesa = 5) {
  return instalarFakeSocket((ruta, cuerpo) => {
    if (ruta === '/qr/validar') {
      return cuerpo.token === tokenValido
        ? { valido: true, id_mesa: idMesa, expira_en: Date.now() + 3600000 }
        : { __status: 401, valido: false, motivo: 'firma' };
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// POST /api/mesas/qr/:token/sesion
// ---------------------------------------------------------------------------

test('token válido y vigente en la mesa: emite un JWT de comensal con sid', async () => {
  const { token, sid } = construirTokenQr(5);
  const socket = socketQueValida(token);
  const db = dbConMesa(token);
  try {
    const res = await request(app).post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`);

    assert.strictEqual(res.status, 201);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.strictEqual(payload.rol, 'comensal');
    assert.strictEqual(payload.id_mesa, 5);
    assert.strictEqual(payload.sid, sid, 'el sid del JWT sale del token QR');
    assert.ok(Math.abs(payload.exp - payload.iat - 3 * 60 * 60) <= 1, '3 h de vigencia');
    assert.strictEqual(res.body.mesa.numero, 5);

    assert.ok(socket.buscar('/qr/validar'), 'se consulta al socket-server');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('token que el socket-server rechaza: 401 con el motivo, sin emitir JWT', async () => {
  const socket = instalarFakeSocket(() => ({ __status: 401, valido: false, motivo: 'expirado' }));
  const db = dbConMesa(null);
  try {
    const res = await request(app).post('/api/mesas/qr/token-vencido/sesion');

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'expirado');
    assert.strictEqual(res.body.token, undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('token firmado y vigente pero distinto al de la mesa: 401, no sirve un QR viejo', async () => {
  const { token: tokenViejo } = construirTokenQr(5);
  const { token: tokenActual } = construirTokenQr(5);
  // El socket-server lo da por válido (está bien firmado y no expiró)...
  const socket = instalarFakeSocket(() => ({ valido: true, id_mesa: 5 }));
  // ...pero la mesa ya tiene otro token.
  const db = dbConMesa(tokenActual);
  try {
    const res = await request(app).post(`/api/mesas/qr/${encodeURIComponent(tokenViejo)}/sesion`);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'no_es_el_vigente');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('mesa sin sesión abierta (token_qr NULL): 401', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket(() => ({ valido: true, id_mesa: 5 }));
  const db = dbConMesa(null);
  try {
    const res = await request(app).post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'mesa_sin_sesion');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('socket-server caído al abrir sesión: 503 (aquí sí debe fallar)', async () => {
  const { token } = construirTokenQr(5);
  const socket = socketCaido();
  const db = dbConMesa(token);
  try {
    const res = await request(app).post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`);

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.token, undefined);
    assert.ok(res.body.motivo);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Middleware: el sid ata la sesión al QR vigente
// ---------------------------------------------------------------------------

test('un comensal con sesión vigente pasa el middleware', async () => {
  const db = instalarFakeDb((sql) =>
    sql.includes('FROM pedidos WHERE id_mesa') ? { rows: [] } : { rows: [] }
  );
  try {
    const res = await request(app)
      .get('/api/pedidos/mesa')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_mesa, 5);
  } finally {
    db.restaurar();
  }
});

test('un JWT del grupo anterior (sid distinto) recibe 401 sesión cerrada', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/pedidos/mesa')
      .set('Authorization', `Bearer ${tokenComensalDeOtraSesion(5)}`);

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Sesión de mesa cerrada/);
  } finally {
    db.restaurar();
  }
});

test('si la mesa se liberó (token_qr NULL) la sesión del comensal cae', async () => {
  const jwtComensal = tokenComensal(5);
  // La mesa quedó liberada después de emitir ese JWT.
  const db = instalarFakeDb(() => ({ rows: [] }), { sesionCerrada: true });
  try {
    const res = await request(app)
      .get('/api/pedidos/mesa')
      .set('Authorization', `Bearer ${jwtComensal}`);

    assert.strictEqual(res.status, 401);
    assert.match(res.body.error, /Sesión de mesa cerrada/);
  } finally {
    db.restaurar();
  }
});

test('la comprobación de sesión no aplica al personal', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { sesionCerrada: true });
  try {
    const res = await request(app)
      .get('/api/pedidos/activos')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200, 'un admin no depende de la sesión de mesa');
    assert.strictEqual(db.buscar('SELECT token_qr FROM mesas WHERE id_mesa'), undefined);
  } finally {
    db.restaurar();
  }
});

test('GET /api/pedidos/mesa sin token responde 401', async () => {
  const res = await request(app).get('/api/pedidos/mesa');
  assert.strictEqual(res.status, 401);
});

test('GET /api/pedidos/historial ya no existe: cae en /:id y no devuelve lista', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/pedidos/historial')
      .set('Authorization', `Bearer ${tokenComensal(5)}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.pedidos, undefined);
  } finally {
    db.restaurar();
  }
});
