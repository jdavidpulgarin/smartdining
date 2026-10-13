const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');

// mesas.sesion_iniciada_en delimita la VISITA: que pedidos entran en la cuenta
// (script 17). Se fija al pasar de no ocupada a 'ocupada' y NO se toca mientras
// el grupo siga sentado, por mucho que su QR caduque y se genere otro.

const ID_MESA = 5;
const SQL_ABRIR = 'UPDATE mesas SET token_qr = $1';
const jwtMesero = () => tokenStaff(3, 'mesero');

const abrir = () =>
  request(app).post(`/api/mesas/${ID_MESA}/abrir`).set('Authorization', `Bearer ${jwtMesero()}`);

/**
 * @param {{estado?: string, tokenGuardado?: string|null, vigente?: boolean}} opciones
 *   estado/tokenGuardado: como esta la fila de la mesa antes de abrir.
 *   vigente: que responde /qr/validar sobre el token guardado.
 */
function responderMesa({ estado = 'disponible', tokenGuardado = null, vigente = false } = {}) {
  return (sql, params) => {
    if (sql.includes('SELECT * FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return {
        rows: [{ id_mesa: ID_MESA, numero: ID_MESA, estado, token_qr: tokenGuardado }],
      };
    }
    if (sql.includes(SQL_ABRIR)) {
      return {
        rows: [{ id_mesa: ID_MESA, numero: ID_MESA, estado: 'ocupada', token_qr: params[0] }],
      };
    }
    if (sql.includes('UPDATE mesas SET estado = COALESCE')) {
      return { rows: [{ id_mesa: ID_MESA, numero: ID_MESA, estado: params[0], token_qr: null }] };
    }
    return { rows: [] };
  };
}

/** Doble del socket-server: decide si el token guardado sigue vigente. */
function socketConQr(vigente) {
  return (ruta, cuerpo) => {
    if (ruta === '/qr/validar') {
      return vigente
        ? { valido: true, id_mesa: ID_MESA, expira_en: Date.now() + 3600000 }
        : { __status: 401, valido: false, motivo: 'expirado' };
    }
    if (ruta === '/qr/generar') {
      const { token } = construirTokenQr(cuerpo.id_mesa);
      return { __status: 201, token, id_mesa: cuerpo.id_mesa, expira_en: Date.now() + 3600000 };
    }
    return { ok: true };
  };
}

// ---------------------------------------------------------------------------
// Visita nueva: se fija la fecha
// ---------------------------------------------------------------------------

test('abrir una mesa disponible fija sesion_iniciada_en en la misma UPDATE', async () => {
  const socket = instalarFakeSocket(socketConQr(false));
  const db = instalarFakeDb(responderMesa({ estado: 'disponible' }));
  try {
    const res = await abrir();

    assert.strictEqual(res.status, 201);

    const update = db.buscar(SQL_ABRIR);
    assert.ok(update, 'se guarda el token');
    assert.ok(
      update.sql.includes('sesion_iniciada_en = CASE WHEN $3 THEN NOW()'),
      'la fecha va en la MISMA sentencia que el estado y el token'
    );
    assert.strictEqual(update.params[2], true, 'visita nueva: se fija');
    assert.ok(update.sql.includes("estado = 'ocupada'"));

    // Y todo dentro de la misma transaccion.
    const orden = db.ejecutadas.map((q) => q.sql);
    const indice = (f) => orden.findIndex((s) => s.includes(f));
    assert.ok(indice('BEGIN') < indice(SQL_ABRIR));
    assert.ok(indice(SQL_ABRIR) < indice('COMMIT'));
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

for (const estado of ['reservada', 'mantenimiento']) {
  test(`abrir una mesa '${estado}' tambien cuenta como visita nueva`, async () => {
    const socket = instalarFakeSocket(socketConQr(false));
    const db = instalarFakeDb(responderMesa({ estado }));
    try {
      const res = await abrir();

      assert.strictEqual(res.status, 201);
      assert.strictEqual(db.buscar(SQL_ABRIR).params[2], true, 'no estaba ocupada');
    } finally {
      db.restaurar();
      socket.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// Misma visita: NO se toca
// ---------------------------------------------------------------------------

test('abrir una mesa ya ocupada con QR vigente no cambia la fecha', async () => {
  const { token } = construirTokenQr(ID_MESA);
  const socket = instalarFakeSocket(socketConQr(true));
  const db = instalarFakeDb(
    responderMesa({ estado: 'ocupada', tokenGuardado: token, vigente: true })
  );
  try {
    const res = await abrir();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.reutilizado, true, 'se reutiliza el mismo QR');
    assert.strictEqual(
      db.buscar(SQL_ABRIR),
      undefined,
      'no se toca la fila: ni token, ni estado, ni sesion_iniciada_en'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('abrir una mesa ya ocupada con QR caducado genera otro token pero NO reinicia la visita', async () => {
  const { token: caducado } = construirTokenQr(ID_MESA);
  const socket = instalarFakeSocket(socketConQr(false));
  const db = instalarFakeDb(
    responderMesa({ estado: 'ocupada', tokenGuardado: caducado, vigente: false })
  );
  try {
    const res = await abrir();

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.reutilizado, false, 'hay token nuevo');

    const update = db.buscar(SQL_ABRIR);
    assert.ok(update, 'se guarda el token nuevo');
    assert.strictEqual(
      update.params[2],
      false,
      'misma visita: lo que el grupo ya pidio tiene que seguir en su cuenta'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Los demas caminos
// ---------------------------------------------------------------------------

test('rotar el QR no toca sesion_iniciada_en', async () => {
  const { token } = construirTokenQr(ID_MESA);
  const socket = instalarFakeSocket(socketConQr(true));
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT * FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ id_mesa: ID_MESA, numero: ID_MESA, estado: 'ocupada', token_qr: token }] };
    }
    if (sql.includes('UPDATE mesas SET token_qr = $1 WHERE id_mesa = $2')) {
      return { rows: [{ id_mesa: ID_MESA, numero: ID_MESA, estado: 'ocupada', token_qr: params[0] }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post(`/api/mesas/${ID_MESA}/rotar-qr`)
      .set('Authorization', `Bearer ${jwtMesero()}`);

    assert.strictEqual(res.status, 201);
    const update = db.buscar('UPDATE mesas SET token_qr = $1 WHERE id_mesa = $2');
    assert.ok(update, 'solo cambia el token');
    assert.ok(
      !update.sql.includes('sesion_iniciada_en'),
      'rotar el QR es la misma visita: cambia la credencial, no el grupo'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('liberar la mesa no borra sesion_iniciada_en', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ id_mesa: ID_MESA }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post(`/api/mesas/${ID_MESA}/liberar`)
      .set('Authorization', `Bearer ${jwtMesero()}`);

    assert.strictEqual(res.status, 200);
    const update = db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL');
    assert.ok(update);
    assert.ok(
      !update.sql.includes('sesion_iniciada_en'),
      'queda como historial; la proxima apertura la reemplaza'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('PATCH /estado a ocupada desde otro estado empieza una visita', async () => {
  const db = instalarFakeDb(responderMesa());
  try {
    const res = await request(app)
      .patch(`/api/mesas/${ID_MESA}/estado`)
      .set('Authorization', `Bearer ${jwtMesero()}`)
      .send({ estado: 'ocupada' });

    assert.strictEqual(res.status, 200);
    const update = db.buscar('UPDATE mesas SET estado = COALESCE');
    assert.ok(
      update.sql.includes('WHEN $1 = $3 AND estado <> $3 THEN NOW()'),
      'solo si pasa de no ocupada a ocupada, comparando contra el estado viejo en la misma sentencia'
    );
    assert.strictEqual(update.params[2], 'ocupada');
  } finally {
    db.restaurar();
  }
});

test('PATCH /estado a otro valor no inventa una visita', async () => {
  const db = instalarFakeDb(responderMesa());
  try {
    const res = await request(app)
      .patch(`/api/mesas/${ID_MESA}/estado`)
      .set('Authorization', `Bearer ${jwtMesero()}`)
      .send({ estado: 'reservada' });

    assert.strictEqual(res.status, 200);
    // El CASE lo decide en SQL: con 'reservada' la rama NOW() no se cumple.
    assert.strictEqual(db.buscar('UPDATE mesas SET estado = COALESCE').params[0], 'reservada');
  } finally {
    db.restaurar();
  }
});

test('una mesa creada ya ocupada arranca con su sesion', async () => {
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('INSERT INTO mesas')) {
      return { rows: [{ id_mesa: 99, numero: params[0], estado: params[3], token_qr: null }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/mesas')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ numero: 99, estado: 'ocupada' });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO mesas');
    assert.ok(insert.sql.includes('CASE WHEN $4 = $6 THEN NOW() ELSE NULL END'));
    assert.strictEqual(insert.params[5], 'ocupada');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Las consultas propias filtran por sesion
// ---------------------------------------------------------------------------

test('el reparto de un pago interno solo mira los pedidos de la visita actual', async () => {
  const previo = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = CLAVE_FALSA;
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ id_mesa: ID_MESA }] };
    }
    if (sql.includes('SUM(ROUND(obtener_saldo_pendiente')) {
      return { rows: [{ saldo_centavos: '0' }] };
    }
    if (sql.includes('obtener_saldo_pendiente(p.id_pedido) * 100')) {
      return { rows: [{ id_pedido: 87, estado: 'entregado', saldo_centavos: '3000000' }] };
    }
    if (sql.includes('INSERT INTO transacciones')) return { rows: [] };
    return { rows: [] };
  });
  try {
    await request(app)
      .post('/api/transacciones/internal')
      .set('x-internal-key', CLAVE_FALSA)
      .send({
        referencia_externa: 'SD-5-sesion',
        id_transaccion_pasarela: '1132-sesion',
        pasarela: 'wompi',
        id_mesa: ID_MESA,
        modo: 'igual',
        monto_centavos: 3000000,
        moneda: 'COP',
      });

    for (const fragmento of ['obtener_saldo_pendiente(p.id_pedido) * 100', 'SUM(ROUND(obtener_saldo_pendiente']) {
      const consulta = db.buscar(fragmento);
      assert.ok(consulta, fragmento);
      assert.ok(
        consulta.sql.includes('JOIN mesas m ON m.id_mesa = p.id_mesa'),
        'se une con mesas para leer la sesion'
      );
      assert.ok(
        consulta.sql.includes('m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en'),
        'mismo criterio que obtener_cuenta_mesa y procesar_pago_comensal_mesa'
      );
    }
  } finally {
    db.restaurar();
    socket.restaurar();
    if (previo === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = previo;
  }
});

test('el conteo de pedidos abiertos de la mesa tambien filtra por sesion', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ id_mesa: ID_MESA }] };
    }
    return { rows: [] };
  });
  try {
    await request(app)
      .post(`/api/mesas/${ID_MESA}/liberar`)
      .set('Authorization', `Bearer ${jwtMesero()}`);

    const conteo = db.buscar('count(*)::int AS n');
    assert.ok(conteo);
    assert.ok(
      conteo.sql.includes('m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en'),
      'un pedido colgado de un grupo anterior no debe bloquear la mesa del actual'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('la cuenta de la mesa la delimita la funcion de la base, no el backend', async () => {
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT 1 FROM mesas WHERE id_mesa')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) {
      return {
        rows: [{
          cuenta: {
            id_mesa: Number(params[0]),
            sesion_iniciada_en: '2026-10-13T03:00:00.000Z',
            total_mesa: 30000,
            pagado_mesa: 0,
            saldo_mesa: 30000,
            comensales: [{ comensal: 'Carla', subtotal: 30000, pagado: 0, saldo: 30000 }],
          },
        }],
      };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .get(`/api/mesas/${ID_MESA}/cuenta`)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    assert.strictEqual(res.status, 200);
    assert.ok(
      db.buscar('obtener_cuenta_mesa_json'),
      'se delega en la funcion del script 17, que ya filtra por sesion'
    );
    assert.ok('sesion_iniciada_en' in res.body, 'la respuesta dice de que visita habla');
    assert.deepStrictEqual(
      res.body.comensales.map((c) => c.comensal),
      ['Carla'],
      'solo el grupo actual'
    );
  } finally {
    db.restaurar();
  }
});
