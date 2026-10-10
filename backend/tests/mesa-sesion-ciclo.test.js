const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, construirTokenQr } = require('./helpers/fake-db');
const { instalarFakeSocket, socketCaido, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');
const mesasService = require('../src/services/mesas.service');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado: 'disponible' };

/** Doble de BD que simula la fila de la mesa, con el token_qr que se le pase. */
function dbMesa(tokenQr, estado = 'disponible') {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ ...MESA, estado, token_qr: tokenQr }] };
    }
    if (sql.includes('UPDATE mesas SET token_qr = $1')) {
      return { rows: [{ ...MESA, estado: 'ocupada', token_qr: params[0] }] };
    }
    if (sql.includes('UPDATE mesas SET estado = $1, token_qr = NULL')) {
      return { rows: [{ ...MESA, estado: 'disponible', token_qr: null }] };
    }
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// POST /api/mesas/:id/abrir
// ---------------------------------------------------------------------------

test('abrir una mesa sin token pide uno a /qr/generar y lo guarda', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/generar') return { __status: 201, token, id_mesa: 5, expira_en: Date.now() + 3600000 };
    return { ok: true };
  });
  const db = dbMesa(null);
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, token);
    assert.strictEqual(res.body.reutilizado, false);
    assert.strictEqual(res.body.mesa.estado, 'ocupada');

    // La url se arma desde FRONTEND_CLIENTE_URL
    assert.match(res.body.url, /^http:\/\/localhost:5173\/\?token=/);
    assert.ok(res.body.url.includes(encodeURIComponent(token)));

    // Se guardó el token y la mesa quedó ocupada, con la fila bloqueada.
    assert.ok(db.buscar('FROM mesas WHERE id_mesa = $1 FOR UPDATE'), 'debe bloquear la fila');
    const guardado = db.buscar('UPDATE mesas SET token_qr = $1');
    assert.strictEqual(guardado.params[0], token);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('abrir reenvía el JWT del mesero a /qr/generar', async () => {
  const { token } = construirTokenQr(5);
  const jwtMesero = tokenStaff(3, 'mesero');
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5 } : { ok: true }
  );
  const db = dbMesa(null);
  try {
    await request(app).post('/api/mesas/5/abrir').set('Authorization', `Bearer ${jwtMesero}`);

    const aviso = socket.buscar('/qr/generar');
    assert.strictEqual(aviso.cabeceras.Authorization, `Bearer ${jwtMesero}`);
    assert.ok(!aviso.cabeceras['x-internal-key'], '/qr/generar no usa la clave interna');
    assert.deepStrictEqual(aviso.cuerpo, { id_mesa: 5 });
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('abrir dos veces devuelve el MISMO token (idempotente)', async () => {
  const { token } = construirTokenQr(5);
  let generaciones = 0;
  const socket = instalarFakeSocket((ruta, cuerpo) => {
    if (ruta === '/qr/generar') {
      generaciones += 1;
      return { __status: 201, token, id_mesa: 5 };
    }
    if (ruta === '/qr/validar') {
      // El token ya guardado sigue vigente.
      return cuerpo.token === token ? { valido: true, id_mesa: 5 } : { __status: 401, valido: false, motivo: 'firma' };
    }
    return { ok: true };
  });

  // Primera llamada: la mesa está 'disponible' y sin token. Segunda: ya quedó
  // 'ocupada' con su token, que es cuando corresponde reutilizarlo.
  let tokenEnLaMesa = null;
  let estadoMesa = 'disponible';
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
      return { rows: [{ ...MESA, estado: estadoMesa, token_qr: tokenEnLaMesa }] };
    }
    if (sql.includes('UPDATE mesas SET token_qr = $1')) {
      tokenEnLaMesa = params[0];
      estadoMesa = 'ocupada';
      return { rows: [{ ...MESA, estado: 'ocupada', token_qr: params[0] }] };
    }
    return { rows: [] };
  });

  try {
    const primera = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);
    const segunda = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(primera.status, 201);
    assert.strictEqual(segunda.status, 201);
    assert.strictEqual(segunda.body.token, primera.body.token, 'el token debe ser el mismo');
    assert.strictEqual(primera.body.reutilizado, false);
    assert.strictEqual(segunda.body.reutilizado, true);
    assert.strictEqual(generaciones, 1, 'solo se genera un QR');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el token guardado ya expiró, abrir genera uno nuevo', async () => {
  const { token: viejo } = construirTokenQr(5);
  const { token: nuevo } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/validar') return { __status: 401, valido: false, motivo: 'expirado' };
    if (ruta === '/qr/generar') return { __status: 201, token: nuevo, id_mesa: 5 };
    return { ok: true };
  });
  const db = dbMesa(viejo, 'ocupada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, nuevo);
    assert.strictEqual(res.body.reutilizado, false);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('socket-server caído al abrir: 503 y la mesa no se toca', async () => {
  const socket = socketCaido();
  const db = dbMesa(null);
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 503);
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr = $1'), undefined, 'no debe guardar nada');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server rechaza el rol (403), abrir responde 403', async () => {
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar'
      ? { __status: 403, ok: false, codigo: 'NO_AUTORIZADO', mensaje: 'Tu rol no puede generar QR' }
      : { ok: true }
  );
  const db = dbMesa(null);
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /no puede generar QR/);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('abrir exige rol mesero o admin', async () => {
  for (const rol of ['cajero', 'cocina']) {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(9, rol)}`);
    assert.strictEqual(res.status, 403, `${rol} no debe poder abrir mesas`);
  }
  const sinToken = await request(app).post('/api/mesas/5/abrir');
  assert.strictEqual(sinToken.status, 401);
});

test('abrir una mesa que no existe: 404', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/mesas/99/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 404);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/mesas/:id/liberar
// ---------------------------------------------------------------------------

test('liberar deja la mesa disponible, borra el token y avisa al socket-server', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket();
  const db = dbMesa(token, 'ocupada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/liberar')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'disponible');
    assert.strictEqual(res.body.token_qr, null);

    assert.ok(db.buscar('FROM mesas WHERE id_mesa = $1 FOR UPDATE'), 'con la fila bloqueada');
    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'));

    const aviso = socket.buscar('/internal/mesa-liberada');
    assert.ok(aviso, 'debe avisar al socket-server');
    assert.deepStrictEqual(aviso.cuerpo, { id_mesa: 5 });
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server falla, la liberación no se revierte', async () => {
  const { token } = construirTokenQr(5);
  const socket = socketCaido();
  const db = dbMesa(token, 'ocupada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/liberar')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200, 'la mesa queda liberada igual');
    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('liberar exige rol mesero o admin', async () => {
  const res = await request(app)
    .post('/api/mesas/5/liberar')
    .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);
  assert.strictEqual(res.status, 403);
});

// ---------------------------------------------------------------------------
// Liberación automática al cerrarse el último pedido
// ---------------------------------------------------------------------------

test('cancelar el último pedido de la mesa la libera', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      return { rows: [{ id_pedido: 87, id_mesa: 5, estado: 'cancelado' }] };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/pedidos/87/cancelar')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200);
    assert.ok(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), 'la mesa se libera');
    assert.ok(socket.buscar('/internal/mesa-liberada'));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si quedan otros pedidos abiertos, cerrar uno NO libera la mesa', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    (sql) => {
      if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
      if (sql.includes('UPDATE pedidos SET estado')) {
        return { rows: [{ id_pedido: 87, id_mesa: 5, estado: 'cancelado' }] };
      }
      return { rows: [] };
    },
    { pedidosAbiertos: 1 }
  );
  try {
    const res = await request(app)
      .post('/api/pedidos/87/cancelar')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), undefined);
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('dos pedidos de la misma mesa cerrándose a la vez la liberan una sola vez', async () => {
  // Se simula la carrera: el UPDATE de liberación solo afecta filas cuando la
  // mesa todavía no estaba liberada, igual que el WHERE real del servicio.
  let mesaLiberada = false;
  const intentos = [];

  const clienteFalso = {
    query: async (sql, params = []) => {
      if (sql.includes('count(*)::int AS n FROM pedidos')) return { rows: [{ n: 0 }] };
      if (sql.includes('UPDATE mesas SET estado = $1, token_qr = NULL')) {
        intentos.push(params[1]);
        if (mesaLiberada) return { rows: [] }; // ya estaba liberada: 0 filas
        mesaLiberada = true;
        return { rows: [{ id_mesa: params[1] }] };
      }
      return { rows: [] };
    },
  };

  const primera = await mesasService.liberarSiNoQuedanPedidosAbiertos(clienteFalso, 5);
  const segunda = await mesasService.liberarSiNoQuedanPedidosAbiertos(clienteFalso, 5);

  assert.strictEqual(primera, true, 'el primer cierre libera la mesa');
  assert.strictEqual(segunda, false, 'el segundo ve que ya estaba liberada');
  assert.strictEqual(intentos.length, 2, 'ambos lo intentan...');
  assert.strictEqual(intentos.filter(Boolean).length, 2);
});

test('la liberación automática bloquea la fila de la mesa antes de decidir', async () => {
  const consultas = [];
  const clienteFalso = {
    query: async (sql) => {
      consultas.push(sql);
      if (sql.includes('count(*)::int AS n FROM pedidos')) return { rows: [{ n: 0 }] };
      return { rows: [{ id_mesa: 5 }] };
    },
  };

  await mesasService.liberarSiNoQuedanPedidosAbiertos(clienteFalso, 5);

  assert.ok(consultas[0].includes('FOR UPDATE'), 'lo primero es bloquear la mesa');
  assert.ok(consultas[1].includes('count(*)::int AS n FROM pedidos'), 'luego contar los abiertos');
});

test('si no se puede leer el conteo de pedidos abiertos, NO se libera la mesa', async () => {
  const clienteFalso = {
    query: async (sql) => {
      if (sql.includes('count(*)::int AS n FROM pedidos')) return { rows: [] }; // sin datos
      return { rows: [{ id_mesa: 5 }] };
    },
  };

  const liberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(clienteFalso, 5);
  assert.strictEqual(liberada, false, 'ante la duda, la mesa se queda ocupada');
});

// ---------------------------------------------------------------------------
// Liberar a mano es solo para grupos que se van SIN pedir
// ---------------------------------------------------------------------------

test('liberar una mesa con pedidos abiertos responde 409 y no cambia nada', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket();
  // La mesa tiene 2 pedidos abiertos.
  const db = instalarFakeDb(
    (sql) => {
      if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
        return { rows: [{ ...MESA, estado: 'ocupada', token_qr: token }] };
      }
      return { rows: [] };
    },
    { pedidosAbiertos: 2 }
  );
  try {
    const res = await request(app)
      .post('/api/mesas/5/liberar')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(
      res.body.error,
      'La mesa tiene pedidos abiertos; cóbralos o cancélalos antes de liberarla'
    );
    assert.strictEqual(res.body.pedidos_abiertos, 2);

    // Nada cambió: ni la mesa ni el aviso al socket-server.
    assert.strictEqual(db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL'), undefined);
    assert.strictEqual(socket.buscar('/internal/mesa-liberada'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('el chequeo de pedidos abiertos va con la mesa ya bloqueada', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    (sql) => {
      if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
        return { rows: [{ ...MESA, estado: 'ocupada', token_qr: token }] };
      }
      return { rows: [] };
    },
    { pedidosAbiertos: 1 }
  );
  try {
    await request(app).post('/api/mesas/5/liberar').set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    const orden = db.ejecutadas.map((q) => q.sql);
    const iBloqueo = orden.findIndex((s) => s.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE'));
    const iConteo = orden.findIndex((s) => s.includes('count(*)::int AS n FROM pedidos'));
    assert.ok(iBloqueo >= 0 && iConteo > iBloqueo, 'primero se bloquea la mesa, luego se cuenta');
    // Y todo dentro de la misma transacción, que se deshace.
    assert.ok(orden.some((s) => /^\s*BEGIN/.test(s)));
    assert.ok(orden.some((s) => /^\s*ROLLBACK/.test(s)));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('sin pedidos abiertos, liberar sí procede', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(
    (sql) => {
      if (sql.includes('FROM mesas WHERE id_mesa = $1 FOR UPDATE')) {
        return { rows: [{ ...MESA, estado: 'ocupada', token_qr: token }] };
      }
      return { rows: [] };
    },
    { pedidosAbiertos: 0 }
  );
  try {
    const res = await request(app)
      .post('/api/mesas/5/liberar')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.estado, 'disponible');
    assert.ok(socket.buscar('/internal/mesa-liberada'));
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El QR se reutiliza solo si la mesa está 'ocupada'
// ---------------------------------------------------------------------------

test("una mesa 'disponible' con token_qr sobrante recibe un QR nuevo", async () => {
  const { token: sobrante } = construirTokenQr(5);
  const { token: nuevo } = construirTokenQr(5);
  let validaciones = 0;
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/validar') {
      validaciones += 1;
      return { valido: true, id_mesa: 5 }; // seguiría siendo válido...
    }
    if (ruta === '/qr/generar') return { __status: 201, token: nuevo, id_mesa: 5 };
    return { ok: true };
  });
  // ...pero la mesa está 'disponible': ese token es resto de una sesión cerrada.
  const db = dbMesa(sobrante, 'disponible');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, nuevo, 'debe generar uno nuevo');
    assert.strictEqual(res.body.reutilizado, false);
    assert.strictEqual(validaciones, 0, 'ni se molesta en validar el sobrante');

    // Y reemplaza el guardado.
    assert.strictEqual(db.buscar('UPDATE mesas SET token_qr = $1').params[0], nuevo);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test("una mesa 'ocupada' con token vigente sí lo reutiliza", async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta, cuerpo) => {
    if (ruta === '/qr/validar') {
      return cuerpo.token === token ? { valido: true, id_mesa: 5 } : { __status: 401, valido: false, motivo: 'firma' };
    }
    if (ruta === '/qr/generar') throw new Error('no debería generar otro');
    return { ok: true };
  });
  const db = dbMesa(token, 'ocupada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, token);
    assert.strictEqual(res.body.reutilizado, true);
    assert.strictEqual(socket.buscar('/qr/generar'), undefined);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test("una mesa 'reservada' con token_qr también recibe uno nuevo", async () => {
  const { token: sobrante } = construirTokenQr(5);
  const { token: nuevo } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar' ? { __status: 201, token: nuevo, id_mesa: 5 } : { ok: true }
  );
  const db = dbMesa(sobrante, 'reservada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.token, nuevo, 'solo se reutiliza en ocupada');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Modelo "QR en vidrio" (opción A): la tablet de la mesa muestra el QR y se
// refresca cuando el backend avisa a /internal/qr-rotado.
// ---------------------------------------------------------------------------

test('abrir con token nuevo avisa a /internal/qr-rotado con { id_mesa, token_qr }', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5 } : { ok: true }
  );
  const db = dbMesa(null, 'disponible');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.reutilizado, false);

    const aviso = socket.buscar('/internal/qr-rotado');
    assert.ok(aviso, 'debe avisarse a la tablet de la mesa');
    // Exactamente esas dos claves y esos valores: el token va completo, sin recortar.
    assert.deepStrictEqual(aviso.cuerpo, { id_mesa: 5, token_qr: token });
    assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('el token que se avisa es el completo, sin recortar', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) =>
    ruta === '/qr/generar' ? { __status: 201, token, id_mesa: 5 } : { ok: true }
  );
  const db = dbMesa(null, 'disponible');
  try {
    await request(app).post('/api/mesas/5/abrir').set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    const enviado = socket.buscar('/internal/qr-rotado').cuerpo.token_qr;
    assert.strictEqual(enviado.length, token.length);
    assert.ok(enviado.length > 128, 'los tokens v1 pasan de 128: no se recortan para que quepan');
    assert.strictEqual(enviado.split('.').length, 3, 'sigue siendo v1.<datos>.<firma>');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('abrir reutilizando el QR de una mesa ocupada NO avisa a la tablet', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta, cuerpo) => {
    if (ruta === '/qr/validar') {
      return cuerpo.token === token ? { valido: true, id_mesa: 5 } : { __status: 401, valido: false, motivo: 'firma' };
    }
    return { ok: true };
  });
  const db = dbMesa(token, 'ocupada');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.reutilizado, true);
    assert.strictEqual(
      socket.buscar('/internal/qr-rotado'),
      undefined,
      'la tablet ya muestra ese QR: reenviarlo solo la haría parpadear'
    );
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('si el socket-server está caído, la mesa se abre igual', async () => {
  const { token } = construirTokenQr(5);
  // Cae todo menos /qr/generar: el QR se obtiene, pero el aviso a la tablet falla.
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/generar') return { __status: 201, token, id_mesa: 5 };
    const err = new Error('connect ECONNREFUSED 127.0.0.1:4001');
    err.name = 'TypeError';
    return err;
  });
  const db = dbMesa(null, 'disponible');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201, 'la mesa se abre igual');
    assert.strictEqual(res.body.token, token);
    assert.ok(db.buscar('UPDATE mesas SET token_qr = $1'), 'y el token quedó guardado');
    assert.ok(socket.buscar('/internal/qr-rotado'), 'se intentó avisar');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('un 400 del socket-server por el límite de longitud no rompe el abrir', async () => {
  const { token } = construirTokenQr(5);
  const socket = instalarFakeSocket((ruta) => {
    if (ruta === '/qr/generar') return { __status: 201, token, id_mesa: 5 };
    if (ruta === '/internal/qr-rotado') {
      // Lo que responde hoy el socket-server: MAX_TOKEN_QR_MOSTRADO = 128.
      return {
        __status: 400,
        ok: false,
        codigo: 'PAYLOAD_INVALIDO',
        mensaje: 'token_qr debe ser un texto de 1 a 128 caracteres',
      };
    }
    return { ok: true };
  });
  const db = dbMesa(null, 'disponible');
  try {
    const res = await request(app)
      .post('/api/mesas/5/abrir')
      .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`);

    assert.strictEqual(res.status, 201, 'abrir la mesa no depende de la tablet');
    assert.strictEqual(res.body.token, token, 'y el token se devuelve completo');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('notificarQrRotado deja el motivo del 400 en el log', async () => {
  const socket = instalarFakeSocket(() => ({
    __status: 400,
    ok: false,
    codigo: 'PAYLOAD_INVALIDO',
    mensaje: 'token_qr debe ser un texto de 1 a 128 caracteres',
  }));
  const errores = [];
  const errorOriginal = console.error;
  console.error = (...args) => errores.push(args.join(' '));
  try {
    const { notificarQrRotado } = require('../src/services/socket.notifier');
    const { token } = construirTokenQr(5);
    const r = await notificarQrRotado(5, token);

    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.motivo, 'HTTP_400');

    const log = errores.join('\n');
    assert.match(log, /qr-rotado/);
    assert.match(log, /1 a 128 caracteres/, 'el motivo del socket-server debe quedar en el log');
    assert.match(log, new RegExp(String(token.length)), 'y la longitud real que se envió');
  } finally {
    console.error = errorOriginal;
    socket.restaurar();
  }
});
