const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const app = require('../server');

// Mesa tal como está en la base: CON token_qr.
function mesaEnBase(tokenQr, estado = 'ocupada') {
  return { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado, token_qr: tokenQr };
}

/** ¿Aparece el token en cualquier parte del cuerpo de la respuesta? */
function filtraToken(body, token) {
  return JSON.stringify(body).includes(token);
}

test('GET /api/mesas/:id (pública) no devuelve token_qr', async () => {
  const { token } = construirTokenQr(5);
  const db = instalarFakeDb((sql) =>
    sql.includes('FROM mesas WHERE id_mesa') ? { rows: [mesaEnBase(token)] } : { rows: [] }
  );
  try {
    const res = await request(app).get('/api/mesas/5');

    assert.strictEqual(res.status, 200);
    assert.ok(!('token_qr' in res.body), 'no debe existir la clave token_qr');
    assert.ok(!filtraToken(res.body, token), 'el token no debe aparecer en ninguna parte');

    // Y sigue devolviendo lo que la PWA sí necesita.
    assert.deepStrictEqual(res.body, {
      id_mesa: 5,
      numero: 5,
      capacidad: 4,
      ubicacion: 'Terraza',
      estado: 'ocupada',
    });
  } finally {
    db.restaurar();
  }
});

test('GET /api/mesas (personal) no devuelve token_qr, solo si hay sesión abierta', async () => {
  const { token } = construirTokenQr(5);
  const db = instalarFakeDb((sql) =>
    sql.includes('FROM mesas ORDER BY numero')
      ? { rows: [mesaEnBase(token, 'ocupada'), { ...mesaEnBase(null, 'disponible'), id_mesa: 6, numero: 6 }] }
      : { rows: [] }
  );
  try {
    const res = await request(app)
      .get('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200);
    assert.ok(!filtraToken(res.body, token), 'el token no debe viajar en el listado');
    for (const m of res.body.mesas) {
      assert.ok(!('token_qr' in m), `la mesa ${m.id_mesa} no debe traer token_qr`);
    }

    // sesion_abierta es lo que el panel necesita del token.
    assert.strictEqual(res.body.mesas[0].sesion_abierta, true, 'la ocupada tiene sesión');
    assert.strictEqual(res.body.mesas[1].sesion_abierta, false, 'la libre no');
  } finally {
    db.restaurar();
  }
});

test('POST /api/mesas (admin) tampoco devuelve token_qr', async () => {
  const { token } = construirTokenQr(5);
  const db = instalarFakeDb((sql) =>
    sql.includes('INSERT INTO mesas') ? { rows: [mesaEnBase(token, 'disponible')] } : { rows: [] }
  );
  try {
    const res = await request(app)
      .post('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ numero: 9, capacidad: 4 });

    assert.strictEqual(res.status, 201);
    assert.ok(!('token_qr' in res.body));
    assert.ok(!filtraToken(res.body, token));
  } finally {
    db.restaurar();
  }
});

test('PATCH /api/mesas/:id/estado tampoco devuelve token_qr', async () => {
  const { token } = construirTokenQr(5);
  const db = instalarFakeDb((sql) =>
    sql.includes('UPDATE mesas SET estado = COALESCE') ? { rows: [mesaEnBase(token, 'reservada')] } : { rows: [] }
  );
  try {
    const res = await request(app)
      .patch('/api/mesas/5/estado')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
      .send({ estado: 'reservada' });

    assert.strictEqual(res.status, 200);
    assert.ok(!('token_qr' in res.body));
    assert.ok(!filtraToken(res.body, token));
    assert.strictEqual(res.body.sesion_abierta, true);
  } finally {
    db.restaurar();
  }
});

test('POST /api/mesas/qr/:token/sesion no devuelve el token_qr de la mesa', async () => {
  const { token } = construirTokenQr(5);
  const { instalarFakeSocket } = require('./helpers/fake-socket');
  const socket = instalarFakeSocket(() => ({ valido: true, id_mesa: 5, expira_en: Date.now() + 3600000 }));
  const db = instalarFakeDb(
    (sql) => (sql.includes('FROM mesas WHERE id_mesa') ? { rows: [mesaEnBase(token)] } : { rows: [] }),
    { tokenQrDeMesa: token }
  );
  try {
    const res = await request(app).post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`);

    assert.strictEqual(res.status, 201);
    assert.ok(!('token_qr' in res.body.mesa), 'la mesa de la respuesta no lleva token_qr');
    // El JWT sí lleva el sid (no el token), y el token del QR ya lo tiene quien escaneó.
    assert.ok(!filtraToken(res.body.mesa, token));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('la ruta GET /api/mesas/qr/:token ya no existe', async () => {
  const { token } = construirTokenQr(5);
  const res = await request(app).get(`/api/mesas/qr/${encodeURIComponent(token)}`);

  // Cae en GET /:id, que no encuentra esa "mesa": nunca responde con una mesa.
  assert.notStrictEqual(res.status, 200);
  assert.ok(!filtraToken(res.body || {}, token));
});

test('POST /api/mesas/:id/abrir SÍ devuelve el token: es quien imprime el QR', async () => {
  const { token } = construirTokenQr(5);
  const { instalarFakeSocket } = require('./helpers/fake-socket');
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5 } : { ok: true }
  );
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) return { rows: [mesaEnBase(null, 'disponible')] };
    if (sql.includes('UPDATE mesas SET token_qr = $1')) return { rows: [mesaEnBase(params[0], 'ocupada')] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, token, 'aquí el token es el producto del endpoint');
    // Pero la mesa anidada sigue sin exponerlo por duplicado.
    assert.ok(!('token_qr' in res.body.mesa));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});
