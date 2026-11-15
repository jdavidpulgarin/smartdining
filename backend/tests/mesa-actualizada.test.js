const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, ES_UUID } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const mesasService = require('../src/services/mesas.service');
const transaccionesService = require('../src/services/transacciones.service');
const pedidosService = require('../src/services/pedidos.service');
const kdsService = require('../src/services/kds.service');
const app = require('../server');

// T12: POST /internal/mesa-actualizada (socket-server/EVENTS.md §5.7) después
// del COMMIT de cada camino que cambia una mesa, por la cadena de avisos (la
// respuesta no lo espera). Aquí: el motivo y los campos de cada camino, que
// token_qr nunca viaja, y que un fallo del aviso no rompe la respuesta.
//
// Los servicios se reemplazan (lo que hacen contra la base ya lo prueban sus
// suites); la base doble solo contesta la RELECTURA de la mesa que hace
// services/avisos-mesa.js después del COMMIT.

const RUTA = '/internal/mesa-actualizada';
const ID_MESA = 5;
const SQL_RELECTURA = '(token_qr IS NOT NULL) AS sesion_abierta';

/** La fila confirmada, como la devuelve la relectura (sin token_qr). */
const fila = (extra = {}) => ({
  id_mesa: ID_MESA, numero: 5, capacidad: 4, estado: 'disponible', ubicacion: 'Terraza', activa: true, sesion_abierta: false, ...extra,
});

/** Reemplaza funciones de un módulo y devuelve cómo deshacerlo. */
function reemplazar(objeto, cambios) {
  const originales = {};
  for (const [k, fn] of Object.entries(cambios)) {
    originales[k] = objeto[k];
    objeto[k] = fn;
  }
  return () => Object.assign(objeto, originales);
}

/**
 * Base doble + socket-server doble + servicios reemplazados.
 * @param {{mesa?: object|null, falloRelectura?: boolean, socket?: Function, stubs?: Array<[object, object]>}} o
 */
function escenario({ mesa = fila(), falloRelectura = false, socket, stubs = [] } = {}) {
  const db = instalarFakeDb((sql) => {
    if (sql.includes(SQL_RELECTURA)) {
      if (falloRelectura) throw Object.assign(new Error('la base no responde'), { code: '57P01' });
      return { rows: mesa ? [mesa] : [] };
    }
    return { rows: [] };
  });
  const s = instalarFakeSocket(socket || (() => ({ ok: true, duplicado: false })));
  const deshacer = stubs.map(([obj, cambios]) => reemplazar(obj, cambios));
  return {
    db,
    socket: s,
    avisos: () => s.todos(RUTA).map((a) => a.cuerpo),
    restaurar() {
      deshacer.forEach((d) => d());
      s.restaurar();
      db.restaurar();
    },
  };
}

const admin = () => `Bearer ${tokenStaff(1, 'admin')}`;
const mesero = () => `Bearer ${tokenStaff(2, 'mesero')}`;
const cajero = () => `Bearer ${tokenStaff(4, 'cajero')}`;

/** El cuerpo completo esperado (sin eventId, que se comprueba aparte). */
function esperado(mesa, motivo) {
  const c = {
    id_mesa: mesa.id_mesa, numero: mesa.numero, capacidad: mesa.capacidad, estado: mesa.estado,
    ubicacion: mesa.ubicacion, activa: mesa.activa, sesion_abierta: mesa.sesion_abierta,
  };
  if (motivo) c.motivo = motivo;
  return c;
}

function unAviso(e) {
  const avisos = e.avisos();
  assert.strictEqual(avisos.length, 1, `un solo mesa-actualizada: ${JSON.stringify(avisos)}`);
  const [cuerpo] = avisos;
  assert.match(cuerpo.eventId, ES_UUID);
  assert.ok(!('token_qr' in cuerpo), 'token_qr nunca viaja');
  assert.ok(!JSON.stringify(cuerpo).includes('tok-secreto'), 'ni su valor');
  const { eventId, ...resto } = cuerpo;
  return resto;
}

// ---------------------------------------------------------------------------
// Cada camino: motivo y campos
// ---------------------------------------------------------------------------

test('t12: abrir mesa -> motivo "abierta" con la mesa confirmada (ocupada, sesion_abierta) y sin token_qr', async () => {
  const mesa = fila({ estado: 'ocupada', sesion_abierta: true });
  const e = escenario({
    mesa,
    stubs: [[mesasService, {
      abrirSesion: async () => ({ mesa: { id_mesa: ID_MESA, numero: 5, estado: 'ocupada', token_qr: 'tok-secreto' }, token: 'tok-secreto', reutilizado: false }),
    }]],
  });
  try {
    const res = await request(app).post(`/api/mesas/${ID_MESA}/abrir`).set('Authorization', mesero());
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'abierta'));
    assert.strictEqual(e.socket.buscar(RUTA).cabeceras['x-internal-key'], e.socket.clave);
  } finally {
    e.restaurar();
  }
});

test('t12: abrir una mesa con la sesión ya abierta (reutilizado) no avisa: no cambió nada', async () => {
  const e = escenario({
    mesa: fila({ estado: 'ocupada', sesion_abierta: true }),
    stubs: [[mesasService, {
      abrirSesion: async () => ({ mesa: { id_mesa: ID_MESA, numero: 5, estado: 'ocupada' }, token: 'tok-secreto', reutilizado: true }),
    }]],
  });
  try {
    assert.strictEqual((await request(app).post(`/api/mesas/${ID_MESA}/abrir`).set('Authorization', mesero())).status, 201);
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.avisos().length, 0);
  } finally {
    e.restaurar();
  }
});

test('t12: PATCH /mesas/:id/estado -> motivo "estado"', async () => {
  const mesa = fila({ estado: 'mantenimiento' });
  const e = escenario({ mesa, stubs: [[mesasService, { actualizarEstado: async () => ({ ...mesa, token_qr: null }) }]] });
  try {
    const res = await request(app).patch(`/api/mesas/${ID_MESA}/estado`).set('Authorization', cajero()).send({ estado: 'mantenimiento' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'estado'));
  } finally {
    e.restaurar();
  }
});

test('t12: POST /mesas -> motivo "creada"', async () => {
  const mesa = fila({ id_mesa: 31, numero: 31 });
  const e = escenario({ mesa, stubs: [[mesasService, { crear: async () => ({ ...mesa, token_qr: null }) }]] });
  try {
    const res = await request(app).post('/api/mesas').set('Authorization', admin()).send({ numero: 31, capacidad: 4 });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'creada'));
    assert.deepStrictEqual(e.db.buscar(SQL_RELECTURA).params, [31], 'relee la mesa creada');
  } finally {
    e.restaurar();
  }
});

test('t12: PATCH /mesas/:id (datos, incluido desactivar) -> motivo "datos" con activa false', async () => {
  const mesa = fila({ activa: false, ubicacion: 'Salón' });
  const e = escenario({ mesa, stubs: [[mesasService, { actualizarDatos: async () => ({ ...mesa, token_qr: null }) }]] });
  try {
    const res = await request(app).patch(`/api/mesas/${ID_MESA}`).set('Authorization', admin()).send({ activa: false });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'datos'));
  } finally {
    e.restaurar();
  }
});

test('t12: DELETE /mesas/:id -> motivo "eliminada" SOLO con id_mesa y activa false (sin releer)', async () => {
  const e = escenario({ stubs: [[mesasService, { eliminar: async () => ({ id_mesa: ID_MESA }) }]] });
  try {
    const res = await request(app).delete(`/api/mesas/${ID_MESA}`).set('Authorization', admin());
    assert.strictEqual(res.status, 204);
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), { id_mesa: ID_MESA, activa: false, motivo: 'eliminada' });
    assert.strictEqual(e.db.buscar(SQL_RELECTURA), undefined, 'la fila ya no existe');
  } finally {
    e.restaurar();
  }
});

test('t12: liberar a mano -> mesa-liberada y además mesa-actualizada "liberada" (sesion_abierta false)', async () => {
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[mesasService, { liberarSesion: async () => ({ mesa: { id_mesa: ID_MESA, numero: 5, estado: 'disponible' } }) }]],
  });
  try {
    const res = await request(app).post(`/api/mesas/${ID_MESA}/liberar`).set('Authorization', mesero());
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.ok(e.socket.buscar('/internal/mesa-liberada'));
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
  } finally {
    e.restaurar();
  }
});

test('t12: la caja cobra la mesa y la libera -> mesa-liberada y DESPUÉS mesa-actualizada "liberada"', async () => {
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[transaccionesService, {
      cobrarMesaEnCaja: async () => ({
        duplicado: false, saldo_restante_centavos: 0, mesa_liberada: true, pagados: [],
        transacciones: [{ id_transaccion: 501, id_pedido: 87, monto_centavos: 3000000, comensal: null, voucher: null }],
      }),
    }]],
  });
  try {
    const res = await request(app).post('/api/transacciones/mesa').set('Authorization', cajero())
      .send({ id_mesa: ID_MESA, monto: 30000, metodo_pago: 'efectivo', id_cobro: '3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    const rutas = e.socket.avisos.map((a) => a.ruta);
    assert.ok(rutas.indexOf('/internal/mesa-liberada') < rutas.indexOf(RUTA), rutas.join(' | '));
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
  } finally {
    e.restaurar();
  }
});

test('t12: el cobro por pedido (POST /transacciones) que libera la mesa -> "liberada"', async () => {
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[transaccionesService, {
      registrarPago: async () => ({
        transaccion: { id_transaccion: 9, id_pedido: 87, monto: 30000, comensal: null },
        pedidoCerrado: { id_pedido: 87, estado_anterior: 'entregado' },
        mesaLiberada: true, id_mesa: ID_MESA, saldoMesaCentavos: 0, estadoTransaccion: 'completada',
      }),
    }]],
  });
  try {
    const res = await request(app).post('/api/transacciones').set('Authorization', cajero())
      .send({ id_pedido: 87, monto: 30000, metodo_pago: 'efectivo' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
  } finally {
    e.restaurar();
  }
});

test('t12: el pago en línea (POST /transacciones/internal) que libera la mesa -> "liberada"', async () => {
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[transaccionesService, {
      registrarPagoInterno: async () => ({ duplicado: false, saldo_restante_centavos: 0, mesa_liberada: true, pagados: [] }),
    }]],
  });
  try {
    const res = await request(app).post('/api/transacciones/internal').set('x-internal-key', e.socket.clave).send({
      referencia_externa: 'wompi-ref-1', id_transaccion_pasarela: 'tx-1', pasarela: 'wompi', id_mesa: ID_MESA,
      comensal: null, modo: 'total', monto_centavos: 3000000, moneda: 'COP',
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
  } finally {
    e.restaurar();
  }
});

test('t12: cancelar el último pedido (PATCH /pedidos/:id/estado) que libera la mesa -> "liberada"', async () => {
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[pedidosService, {
      actualizarEstado: async () => ({ id_pedido: 87, id_mesa: ID_MESA, estado: 'cancelado', estado_anterior: 'recibido', mesaLiberada: true }),
    }]],
  });
  try {
    const res = await request(app).patch('/api/pedidos/87/estado').set('Authorization', mesero()).send({ estado: 'cancelado' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
  } finally {
    e.restaurar();
  }
});

test('t12: rotar el QR NO avisa mesa-actualizada', async () => {
  const e = escenario({
    stubs: [[mesasService, { rotarQr: async () => ({ mesa: { id_mesa: ID_MESA, numero: 5, estado: 'ocupada' }, token: 'tok-secreto', rotado: true }) }]],
  });
  try {
    await request(app).post(`/api/mesas/${ID_MESA}/rotar-qr`).set('Authorization', mesero()).send({});
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.avisos().length, 0);
  } finally {
    e.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Coherencia del contrato y que nunca viaje el token
// ---------------------------------------------------------------------------

test('t12: el cuerpo nunca lleva token_qr aunque la fila lo traiga; sesion_abierta sale de él', () => {
  const c = socketNotifier.cuerpoMesaActualizada({ ...fila(), sesion_abierta: undefined, token_qr: 'tok-secreto', sesion_iniciada_en: new Date() }, 'estado');
  assert.ok(!('token_qr' in c));
  assert.ok(!('sesion_iniciada_en' in c));
  assert.strictEqual(c.sesion_abierta, true);
  assert.deepStrictEqual(Object.keys(c).sort(), ['activa', 'capacidad', 'estado', 'eventId', 'id_mesa', 'motivo', 'numero', 'sesion_abierta', 'ubicacion']);
});

test('t12: "liberada" con la sesión ya reabierta, o "abierta" sin sesión, va SIN motivo (el socket-server daría 400)', () => {
  const liberada = socketNotifier.cuerpoMesaActualizada(fila({ estado: 'ocupada', sesion_abierta: true }), 'liberada');
  assert.strictEqual(liberada.motivo, undefined);
  assert.strictEqual(liberada.sesion_abierta, true, 'el estado real, que es lo que importa');
  const abierta = socketNotifier.cuerpoMesaActualizada(fila({ sesion_abierta: false }), 'abierta');
  assert.strictEqual(abierta.motivo, undefined);
  const normal = socketNotifier.cuerpoMesaActualizada(fila(), 'liberada');
  assert.strictEqual(normal.motivo, 'liberada');
});

test('t12: un eventId nuevo por aviso', () => {
  const a = socketNotifier.cuerpoMesaActualizada(fila(), 'estado');
  const b = socketNotifier.cuerpoMesaActualizada(fila(), 'estado');
  assert.notStrictEqual(a.eventId, b.eventId);
});

// ---------------------------------------------------------------------------
// Un fallo del aviso no rompe la respuesta
// ---------------------------------------------------------------------------

for (const [caso, socket, intentos] of [
  ['socket-server caído', () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 1],
  ['503 NO_CONFIGURADO (no se reintenta)', () => ({ __status: 503, error: 'x', codigo: 'NO_CONFIGURADO' }), 1],
  ['500 ERROR_INTERNO (se reintenta con el MISMO eventId)', () => ({ __status: 500, error: 'x', codigo: 'ERROR_INTERNO' }), socketNotifier.MAX_INTENTOS],
]) {
  test(`t12: ${caso} -> la respuesta sale igual`, async () => {
    const mesa = fila({ estado: 'mantenimiento' });
    const e = escenario({
      mesa,
      socket: (ruta) => (ruta === RUTA ? socket() : { ok: true }),
      stubs: [[mesasService, { actualizarEstado: async () => ({ ...mesa, token_qr: null }) }]],
    });
    const original = console.error;
    console.error = () => {};
    try {
      const res = await request(app).patch(`/api/mesas/${ID_MESA}/estado`).set('Authorization', cajero()).send({ estado: 'mantenimiento' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.estado, 'mantenimiento');
      await socketNotifier.esperarAvisos();
      const enviados = e.avisos();
      assert.strictEqual(enviados.length, intentos);
      assert.strictEqual(new Set(enviados.map((c) => c.eventId)).size, 1, 'el mismo eventId en cada intento');
    } finally {
      console.error = original;
      e.restaurar();
    }
  });
}

test('t12: si la relectura de la mesa falla, no se avisa y la respuesta sale igual (log solo con el código)', async () => {
  const mesa = fila({ estado: 'mantenimiento' });
  const e = escenario({
    falloRelectura: true,
    stubs: [[mesasService, { actualizarEstado: async () => ({ ...mesa, token_qr: null }) }]],
  });
  const lineas = [];
  const original = console.error;
  console.error = (...a) => lineas.push(a.map(String).join(' '));
  try {
    const res = await request(app).patch(`/api/mesas/${ID_MESA}/estado`).set('Authorization', cajero()).send({ estado: 'mantenimiento' });
    assert.strictEqual(res.status, 200);
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.avisos().length, 0);
    assert.match(lineas.join('\n'), /mesa-actualizada: no se pudo leer la mesa \(57P01\)/);
  } finally {
    console.error = original;
    e.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Pedido de Roberto en #276: el camino del KDS y el reintento
// ---------------------------------------------------------------------------

test('t12: el KDS que deja la mesa liberada -> mesa-liberada y además mesa-actualizada "liberada"', async () => {
  // Hoy el KDS solo pasa a en_preparacion o listo y ninguno libera la mesa (ver
  // kds.controller.js): el servicio se reemplaza para ejercitar esa rama, que
  // existe para que, si algún día el KDS cierra un pedido, el panel lo vea.
  const mesa = fila();
  const e = escenario({
    mesa,
    stubs: [[kdsService, {
      cambiarEstado: async () => ({
        id_pedido: 87, id_mesa: ID_MESA, estado: 'listo', estado_anterior: 'en_preparacion', mesaLiberada: true,
      }),
    }]],
  });
  try {
    const res = await request(app).patch('/api/kds/comandas/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(6, 'cocina')}`).send({ estado: 'listo' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    await socketNotifier.esperarAvisos();
    assert.ok(e.socket.buscar('/internal/mesa-liberada'), 'el aviso de siempre');
    assert.deepStrictEqual(unAviso(e), esperado(mesa, 'liberada'));
    assert.deepStrictEqual(e.db.buscar(SQL_RELECTURA).params, [ID_MESA], 'relee la mesa del pedido');
  } finally {
    e.restaurar();
  }
});

test('t12: el KDS que NO libera la mesa no avisa mesa-actualizada', async () => {
  const e = escenario({
    stubs: [[kdsService, {
      cambiarEstado: async () => ({ id_pedido: 87, id_mesa: ID_MESA, estado: 'listo', estado_anterior: 'en_preparacion' }),
    }]],
  });
  try {
    const res = await request(app).patch('/api/kds/comandas/87/estado')
      .set('Authorization', `Bearer ${tokenStaff(6, 'cocina')}`).send({ estado: 'listo' });
    assert.strictEqual(res.status, 200);
    await socketNotifier.esperarAvisos();
    assert.strictEqual(e.avisos().length, 0);
  } finally {
    e.restaurar();
  }
});

/** PATCH /mesas/:id/estado con el socket-server contestando `respuestas` en orden (la última se repite). */
async function reintentosDeEstado(respuestas) {
  const mesa = fila({ estado: 'mantenimiento' });
  let i = 0;
  const e = escenario({
    mesa,
    socket: (ruta) => {
      if (ruta !== RUTA) return { ok: true };
      const r = respuestas[Math.min(i, respuestas.length - 1)];
      i += 1;
      return r();
    },
    stubs: [[mesasService, { actualizarEstado: async () => ({ ...mesa, token_qr: null }) }]],
  });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await request(app).patch(`/api/mesas/${ID_MESA}/estado`).set('Authorization', cajero()).send({ estado: 'mantenimiento' });
    assert.strictEqual(res.status, 200, 'la respuesta nunca depende del aviso');
    await socketNotifier.esperarAvisos();
    return e.avisos();
  } finally {
    console.error = original;
    e.restaurar();
  }
}

const error = (status, codigo) => () => ({ __status: status, error: 'x', codigo });

for (const status of [500, 502, 503]) {
  test(`t12 reintento: ${status} ERROR_INTERNO se reintenta con el MISMO eventId hasta lograrlo`, async () => {
    const enviados = await reintentosDeEstado([error(status, 'ERROR_INTERNO'), () => ({ ok: true, duplicado: false })]);
    assert.strictEqual(enviados.length, 2, 'un intento fallido y el reintento que sale bien');
    assert.strictEqual(enviados[0].eventId, enviados[1].eventId, 'el mismo eventId: el socket-server deduplica');
    assert.deepStrictEqual(enviados[1], enviados[0], 'el mismo cuerpo entero');
  });
}

test(`t12 reintento: ERROR_INTERNO persistente se intenta como mucho ${socketNotifier.MAX_INTENTOS} veces, siempre con el mismo eventId`, async () => {
  const enviados = await reintentosDeEstado([error(503, 'ERROR_INTERNO')]);
  assert.strictEqual(enviados.length, socketNotifier.MAX_INTENTOS);
  assert.strictEqual(new Set(enviados.map((c) => c.eventId)).size, 1);
});

for (const [caso, respuesta] of [
  ['503 NO_CONFIGURADO', error(503, 'NO_CONFIGURADO')],
  ['500 con otro código', error(500, 'OTRO_ERROR')],
  ['500 sin código', () => ({ __status: 500, error: 'x' })],
  ['400 PAYLOAD_INVALIDO', error(400, 'PAYLOAD_INVALIDO')],
  ['401 NO_AUTORIZADO', error(401, 'NO_AUTORIZADO')],
  ['404', error(404, 'NO_ENCONTRADO')],
  ['la red caída', () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })],
]) {
  test(`t12 reintento: ${caso} NO se reintenta (un solo envío)`, async () => {
    const enviados = await reintentosDeEstado([respuesta, () => ({ ok: true, duplicado: false })]);
    assert.strictEqual(enviados.length, 1);
  });
}
