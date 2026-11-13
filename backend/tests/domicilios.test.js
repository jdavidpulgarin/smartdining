const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const app = require('../server');

// D-20a: despacho de domicilios (admin y cajero) y repartidor, con un doble de
// base CON ESTADO. Los roles de cada ruta los cubre la matriz
// (matriz-roles.test.js); lo que solo la base real puede probar (FOR UPDATE de
// verdad, triggers, merma, la carrera cancelar/salir) está en
// tests/integracion/domicilios-sql.test.js.

const REPARTIDOR = 40;
const OTRO_REPARTIDOR = 41;
const ADMIN = () => tokenStaff(1, 'admin');
const CAJERO = () => tokenStaff(2, 'cajero');
const RAFA = () => tokenStaff(REPARTIDOR, 'repartidor');
const LUCHO = () => tokenStaff(OTRO_REPARTIDOR, 'repartidor');

/** Estado inicial: dos domicilios, un repartidor activo, uno inactivo y un mesero. */
function crearEstado() {
  return {
    pedidos: {
      87: { id_pedido: 87, codigo_pedido: 'D-87', estado: 'listo', estado_pago: 'pagado', total: 30000, id_mesa: null, id_cliente: 7, canal: 'domicilio' },
      88: { id_pedido: 88, codigo_pedido: 'D-88', estado: 'en_preparacion', estado_pago: 'pagado', total: 20000, id_mesa: null, id_cliente: 7, canal: 'domicilio' },
      89: { id_pedido: 89, codigo_pedido: 'D-89', estado: 'por_pagar', estado_pago: 'pendiente', total: 10000, id_mesa: null, id_cliente: 7, canal: 'domicilio' },
      90: { id_pedido: 90, codigo_pedido: 'M-90', estado: 'listo', estado_pago: 'pendiente', total: 10000, id_mesa: 5, id_cliente: null, canal: 'mesa' },
      91: { id_pedido: 91, codigo_pedido: 'L-91', estado: 'listo', estado_pago: 'pendiente', total: 10000, id_mesa: null, id_cliente: 7, canal: 'para_llevar' },
    },
    domicilios: {
      87: entrega(87),
      88: entrega(88),
      89: entrega(89),
    },
    usuarios: {
      [REPARTIDOR]: { id_usuario: REPARTIDOR, nombre: 'Rafa', rol: 'repartidor', activo: true },
      [OTRO_REPARTIDOR]: { id_usuario: OTRO_REPARTIDOR, nombre: 'Lucho', rol: 'repartidor', activo: true },
      42: { id_usuario: 42, nombre: 'Inactivo', rol: 'repartidor', activo: false },
      3: { id_usuario: 3, nombre: 'Mesero', rol: 'mesero', activo: true },
    },
    historial: [],
  };
}

function entrega(id) {
  return {
    id_pedido: id,
    direccion_texto: 'Calle 1 # 2-3',
    barrio: 'Centro',
    referencia: 'Portón azul',
    lat: null,
    lng: null,
    telefono_contacto: '3001234567',
    id_zona: 1,
    costo_envio: 5000,
    id_repartidor: null,
    estado_entrega: 'por_asignar',
    motivo_fallo: null,
    creado_en: new Date(`2026-11-13T12:00:${String(id - 80).padStart(2, '0')}Z`),
    asignado_en: null,
    en_camino_en: null,
    entregado_en: null,
    fallido_en: null,
  };
}

/** La fila de SQL_DOMICILIO para un id. */
function filaDomicilio(e, id) {
  const d = e.domicilios[id];
  const p = e.pedidos[id];
  const u = d.id_repartidor ? e.usuarios[d.id_repartidor] : null;
  return {
    id_pedido: id,
    codigo_pedido: p.codigo_pedido,
    estado_pedido: p.estado,
    total: p.total,
    cliente_nombre: 'Ana Cliente',
    cliente_telefono: '3009998877',
    ...d,
    zona_nombre: 'Norte',
    repartidor_nombre: u ? u.nombre : null,
  };
}

function instalar(estado = crearEstado(), { extra } = {}) {
  const e = estado;
  const responder = (sql, params) => {
    if (extra) {
      const r = extra(sql, params);
      if (r) return r;
    }
    if (sql.includes('FROM pedidos WHERE id_pedido = $1::int FOR UPDATE')) {
      const p = e.pedidos[Number(params[0])];
      return { rows: p ? [{ id_pedido: p.id_pedido, estado: p.estado, canal: p.canal }] : [] };
    }
    if (sql.includes('FROM pedidos_domicilio WHERE id_pedido = $1::int FOR UPDATE')) {
      const d = e.domicilios[Number(params[0])];
      return { rows: d ? [{ id_pedido: d.id_pedido, estado_entrega: d.estado_entrega, id_repartidor: d.id_repartidor }] : [] };
    }
    if (sql.includes('SELECT estado FROM pedidos WHERE id_pedido = $1')) {
      const p = e.pedidos[Number(params[0])];
      return { rows: p ? [{ estado: p.estado }] : [] };
    }
    if (sql.includes("FROM usuarios u WHERE u.id_usuario = $1::int AND u.rol = 'repartidor' AND u.activo")) {
      const u = e.usuarios[params[0]];
      return { rows: u && u.rol === 'repartidor' && u.activo ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes("WHERE rol = 'repartidor' AND activo")) {
      return {
        rows: Object.values(e.usuarios)
          .filter((u) => u.rol === 'repartidor' && u.activo)
          .map(({ id_usuario, nombre }) => ({ id_usuario, nombre })),
      };
    }
    if (sql.includes('UPDATE pedidos_domicilio')) {
      const d = e.domicilios[Number(params[0])];
      if (sql.includes('id_repartidor = $2::int')) {
        Object.assign(d, { id_repartidor: params[1], estado_entrega: 'asignado', asignado_en: new Date() });
      } else if (sql.includes("estado_entrega = 'en_camino'")) {
        Object.assign(d, { estado_entrega: 'en_camino', en_camino_en: new Date() });
      } else if (sql.includes("estado_entrega = 'entregado'")) {
        Object.assign(d, { estado_entrega: 'entregado', entregado_en: new Date() });
      } else if (sql.includes("estado_entrega = 'fallido'")) {
        Object.assign(d, { estado_entrega: 'fallido', fallido_en: new Date(), motivo_fallo: params[1] });
      }
      return { rows: [] };
    }
    if (sql.includes("UPDATE pedidos SET estado = 'entregado'")) {
      const p = e.pedidos[Number(params[0])];
      p.estado = 'entregado';
      return { rows: [{ ...p }] };
    }
    if (sql.includes("UPDATE pedidos SET estado = 'pagado'")) {
      const p = e.pedidos[Number(params[0])];
      p.estado = 'pagado';
      return { rows: [{ ...p }] };
    }
    if (sql.includes('INSERT INTO historial_estados')) {
      e.historial.push(params);
      return { rows: [] };
    }
    if (sql.includes('FROM pedidos_domicilio pd')) {
      let ids = Object.keys(e.domicilios).map(Number);
      if (sql.includes('WHERE pd.id_pedido = $1::int')) ids = ids.filter((id) => id === params[0]);
      if (sql.includes('pd.estado_entrega = ANY($1::text[])')) {
        ids = ids.filter((id) => params[0].includes(e.domicilios[id].estado_entrega)
          && !['por_pagar', 'cancelado'].includes(e.pedidos[id].estado));
      }
      if (sql.includes('pd.id_repartidor = $1::int')) ids = ids.filter((id) => e.domicilios[id].id_repartidor === params[0]);
      return { rows: ids.map((id) => filaDomicilio(e, id)) };
    }
    return undefined;
  };
  const db = instalarFakeDb(responder);
  return { estado: e, db, restaurar: () => db.restaurar() };
}

async function con(fn, opciones) {
  const fake = instalar(undefined, opciones);
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    return await fn({ ...fake, socket });
  } finally {
    await socketNotifier.esperarAvisos();
    socket.restaurar();
    fake.restaurar();
  }
}

const como = (token) => ({
  get: (ruta) => request(app).get(`/api${ruta}`).set('Authorization', `Bearer ${token()}`),
  patch: (ruta, cuerpo) => request(app).patch(`/api${ruta}`).set('Authorization', `Bearer ${token()}`).send(cuerpo),
  post: (ruta, cuerpo) => {
    const r = request(app).post(`/api${ruta}`).set('Authorization', `Bearer ${token()}`);
    return cuerpo === undefined ? r : r.send(cuerpo);
  },
});
const admin = como(ADMIN);
const cajero = como(CAJERO);
const rafa = como(RAFA);
const lucho = como(LUCHO);

/** Índice de la primera query con ese fragmento, desde `desde`. */
const indice = (db, fragmento, desde = 0) => db.ejecutadas.findIndex((q, i) => i >= desde && q.sql.includes(fragmento));

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

test('despacho: GET /domicilios por defecto trae los no terminados, sin por_pagar ni cancelados', () =>
  con(async ({ db }) => {
    const res = await cajero.get('/domicilios');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.domicilios.map((d) => d.pedido.id_pedido), [87, 88], 'el 89 está por_pagar');
    assert.deepStrictEqual(db.buscar('FROM pedidos_domicilio pd').params[0], ['por_asignar', 'asignado', 'en_camino']);
    assert.match(db.buscar('FROM pedidos_domicilio pd').sql, /p\.estado NOT IN \('por_pagar', 'cancelado'\)/);
  }));

test('despacho: cada domicilio trae pedido, SOLO nombre y teléfono del cliente, la dirección copiada, zona, envío, repartidor y tiempos', () =>
  con(async () => {
    const [d] = (await admin.get('/domicilios')).body.domicilios;
    assert.deepStrictEqual(Object.keys(d).sort(), [
      'cliente', 'costo_envio', 'direccion', 'estado_entrega', 'motivo_fallo', 'pedido', 'repartidor', 'tiempos', 'zona',
    ]);
    assert.deepStrictEqual(d.pedido, { id_pedido: 87, codigo_pedido: 'D-87', estado: 'listo', total: 30000 });
    assert.deepStrictEqual(d.cliente, { nombre: 'Ana Cliente', telefono: '3009998877' }, 'solo nombre y teléfono');
    assert.deepStrictEqual(Object.keys(d.direccion).sort(), ['barrio', 'direccion', 'lat', 'lng', 'referencia', 'telefono_contacto']);
    assert.deepStrictEqual(d.zona, { id_zona: 1, nombre: 'Norte' });
    assert.strictEqual(d.repartidor, null);
    assert.deepStrictEqual(Object.keys(d.tiempos).sort(), ['asignado_en', 'creado_en', 'en_camino_en', 'entregado_en', 'fallido_en']);
  }));

test('despacho: ?estado_entrega=a,b filtra (con espacios y repetidos); un estado que no existe o una clave de más -> 400', () =>
  con(async ({ db, estado }) => {
    estado.domicilios[87].estado_entrega = 'entregado';
    const res = await admin.get('/domicilios?estado_entrega=entregado, fallido,entregado');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(db.buscar('FROM pedidos_domicilio pd').params[0], ['entregado', 'fallido']);
    assert.deepStrictEqual(res.body.domicilios.map((d) => d.pedido.id_pedido), [87]);
    for (const q of ['?estado_entrega=volando', '?estado_entrega=', '?otra=1', '?estado_entrega=asignado&estado_entrega=fallido']) {
      const r = await admin.get(`/domicilios${q}`);
      assert.strictEqual(r.status, 400, q);
      assert.strictEqual(r.body.motivo, 'cuerpo_invalido');
    }
  }));

test('despacho: asignar -> asignado con el repartidor; reasignar mientras no salga también vale', () =>
  con(async ({ estado }) => {
    const r1 = await cajero.patch('/domicilios/87/repartidor', { id_repartidor: REPARTIDOR });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
    assert.strictEqual(r1.body.domicilio.estado_entrega, 'asignado');
    assert.deepStrictEqual(r1.body.domicilio.repartidor, { id_usuario: REPARTIDOR, nombre: 'Rafa' });

    const r2 = await admin.patch('/domicilios/87/repartidor', { id_repartidor: OTRO_REPARTIDOR });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(estado.domicilios[87].id_repartidor, OTRO_REPARTIDOR);
    assert.strictEqual(estado.domicilios[87].estado_entrega, 'asignado');
  }));

test('despacho: asignar bloquea el PEDIDO y después pedidos_domicilio, en una transacción', () =>
  con(async ({ db }) => {
    const desde = db.ejecutadas.length;
    await admin.patch('/domicilios/87/repartidor', { id_repartidor: REPARTIDOR });
    const iBegin = indice(db, 'BEGIN', desde);
    const iPedido = indice(db, 'FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', desde);
    const iDomicilio = indice(db, 'FROM pedidos_domicilio WHERE id_pedido = $1::int FOR UPDATE', desde);
    const iUpdate = indice(db, 'UPDATE pedidos_domicilio', desde);
    const iCommit = indice(db, 'COMMIT', desde);
    assert.ok(iBegin < iPedido && iPedido < iDomicilio && iDomicilio < iUpdate && iUpdate < iCommit);
  }));

test('despacho: con la entrega ya en camino (o terminada) no se reasigna -> 409 entrega_ya_salio', () =>
  con(async ({ estado }) => {
    for (const est of ['en_camino', 'entregado', 'fallido']) {
      Object.assign(estado.domicilios[87], { estado_entrega: est, id_repartidor: REPARTIDOR });
      const res = await admin.patch('/domicilios/87/repartidor', { id_repartidor: OTRO_REPARTIDOR });
      assert.strictEqual(res.status, 409, est);
      assert.strictEqual(res.body.motivo, 'entrega_ya_salio');
      assert.strictEqual(estado.domicilios[87].id_repartidor, REPARTIDOR, 'no cambió');
    }
  }));

test('despacho: un usuario que no es repartidor activo -> 409 repartidor_no_valido (mesero, inactivo, inexistente)', () =>
  con(async ({ estado }) => {
    for (const id of [3, 42, 999]) {
      const res = await admin.patch('/domicilios/87/repartidor', { id_repartidor: id });
      assert.strictEqual(res.status, 409, String(id));
      assert.deepStrictEqual(res.body, { error: 'Ese usuario no es un repartidor activo', motivo: 'repartidor_no_valido' });
    }
    assert.strictEqual(estado.domicilios[87].estado_entrega, 'por_asignar');
  }));

test('despacho: si el trigger lo rechaza (lo desactivaron en medio) también es 409 repartidor_no_valido, no 500', () =>
  con(
    async () => {
      const res = await admin.patch('/domicilios/87/repartidor', { id_repartidor: REPARTIDOR });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.motivo, 'repartidor_no_valido');
    },
    {
      extra: (sql) => {
        if (sql.includes('UPDATE pedidos_domicilio')) {
          throw Object.assign(new Error('El usuario 40 no es un repartidor activo'), { code: '23514' });
        }
        return undefined;
      },
    }
  ));

test('despacho: un pedido en por_pagar NO se asigna -> 409 pedido_sin_pagar, sin tocar la entrega', () =>
  con(async ({ estado, db }) => {
    const desde = db.ejecutadas.length;
    const res = await admin.patch('/domicilios/89/repartidor', { id_repartidor: REPARTIDOR });
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, {
      error: 'El pedido todavía no está pagado: no se le asigna repartidor hasta que se confirme el pago',
      motivo: 'pedido_sin_pagar',
    });
    assert.strictEqual(estado.domicilios[89].estado_entrega, 'por_asignar');
    assert.strictEqual(estado.domicilios[89].id_repartidor, null);
    assert.strictEqual(indice(db, 'UPDATE pedidos_domicilio', desde), -1);
    assert.ok(indice(db, 'ROLLBACK', desde) >= 0);
  }));

for (const est of ['cancelado', 'entregado', 'pagado']) {
  test(`despacho: un pedido en ${est} no se asigna ni se reasigna -> 409 pedido_no_asignable`, () =>
    con(async ({ estado }) => {
      estado.pedidos[87].estado = est;
      for (const entregaEstado of ['por_asignar', 'asignado']) {
        Object.assign(estado.domicilios[87], {
          estado_entrega: entregaEstado,
          id_repartidor: entregaEstado === 'asignado' ? REPARTIDOR : null,
        });
        const res = await cajero.patch('/domicilios/87/repartidor', { id_repartidor: OTRO_REPARTIDOR });
        assert.strictEqual(res.status, 409, `${est}/${entregaEstado}`);
        assert.deepStrictEqual(res.body, {
          error: 'El pedido ya está cancelado, entregado o pagado: no se le asigna repartidor',
          motivo: 'pedido_no_asignable',
        });
        assert.notStrictEqual(estado.domicilios[87].id_repartidor, OTRO_REPARTIDOR);
      }
    }));
}

for (const est of ['recibido', 'en_preparacion', 'listo']) {
  test(`despacho: un pedido en ${est} sí se asigna (200)`, () =>
    con(async ({ estado }) => {
      estado.pedidos[87].estado = est;
      const res = await admin.patch('/domicilios/87/repartidor', { id_repartidor: REPARTIDOR });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(estado.domicilios[87].estado_entrega, 'asignado');
    }));
}

test('despacho: un pedido que no es domicilio o no existe -> 404', () =>
  con(async () => {
    for (const id of [90, 12345]) {
      const r = await admin.patch(`/domicilios/${id}/repartidor`, { id_repartidor: REPARTIDOR });
      assert.strictEqual(r.status, 404, String(id));
      assert.deepStrictEqual(r.body, { error: 'Ese pedido no es un domicilio', motivo: 'no_encontrado' });
    }
  }));

test('despacho: id inválido -> 400 parametro_invalido; cuerpo inválido -> 400 cuerpo_invalido', () =>
  con(async () => {
    for (const id of ['abc', '0', '-1']) {
      const r = await admin.patch(`/domicilios/${id}/repartidor`, { id_repartidor: REPARTIDOR });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.motivo, 'parametro_invalido');
    }
    for (const cuerpo of [{}, { id_repartidor: '40' }, { id_repartidor: 0 }, { id_repartidor: 40, otro: 1 }]) {
      const r = await admin.patch('/domicilios/87/repartidor', cuerpo);
      assert.strictEqual(r.status, 400, JSON.stringify(cuerpo));
      assert.strictEqual(r.body.motivo, 'cuerpo_invalido');
    }
  }));

test('despacho: GET /usuarios/repartidores devuelve solo id y nombre de los activos', () =>
  con(async () => {
    const res = await cajero.get('/usuarios/repartidores');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      repartidores: [{ id_usuario: REPARTIDOR, nombre: 'Rafa' }, { id_usuario: OTRO_REPARTIDOR, nombre: 'Lucho' }],
    });
  }));

// ---------------------------------------------------------------------------
// Repartidor
// ---------------------------------------------------------------------------

/** Deja el 87 asignado a Rafa. */
async function asignado(estado) {
  Object.assign(estado.domicilios[87], { id_repartidor: REPARTIDOR, estado_entrega: 'asignado' });
}

test('repartidor: GET /domicilios/mios filtra por SU id y con el día de Bogotá', () =>
  con(async ({ db, estado }) => {
    await asignado(estado);
    const res = await rafa.get('/domicilios/mios');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.domicilios.map((d) => d.pedido.id_pedido), [87]);
    const q = db.buscar('pd.id_repartidor = $1::int');
    assert.deepStrictEqual(q.params, [REPARTIDOR, 'America/Bogota']);
    // Las no terminadas, sin pedidos sin pagar ni cancelados (como el despacho).
    assert.match(q.sql, /\('asignado', 'en_camino'\) AND p\.estado NOT IN \('por_pagar', 'cancelado'\)/);
    assert.deepStrictEqual((await lucho.get('/domicilios/mios')).body.domicilios, [], 'Lucho no ve las de Rafa');
  }));

test('repartidor: salir con el pedido en listo -> en_camino', () =>
  con(async ({ estado }) => {
    await asignado(estado);
    const res = await rafa.post('/domicilios/87/salir');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.domicilio.estado_entrega, 'en_camino');
  }));

test('repartidor: salir con el pedido sin listo -> 409 pedido_no_listo, sin cambiar nada', () =>
  con(async ({ estado }) => {
    Object.assign(estado.domicilios[88], { id_repartidor: REPARTIDOR, estado_entrega: 'asignado' });
    const res = await rafa.post('/domicilios/88/salir');
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, { error: 'El pedido todavía no está listo en cocina', motivo: 'pedido_no_listo' });
    assert.strictEqual(estado.domicilios[88].estado_entrega, 'asignado');
  }));

test('repartidor: una entrega ajena -> 403 no_es_tu_entrega en salir, entregar y fallar', () =>
  con(async ({ estado }) => {
    await asignado(estado);
    for (const [accion, cuerpo] of [['salir'], ['entregar'], ['fallar', { motivo: 'x' }]]) {
      const res = await lucho.post(`/domicilios/87/${accion}`, cuerpo);
      assert.strictEqual(res.status, 403, accion);
      assert.deepStrictEqual(res.body, { error: 'Esa entrega no es tuya', motivo: 'no_es_tu_entrega' });
    }
    assert.strictEqual(estado.domicilios[87].estado_entrega, 'asignado');
  }));

test('repartidor: transiciones que no valen -> 409 transicion_invalida y sin efectos (repetir incluido)', () =>
  con(async ({ estado, db }) => {
    await asignado(estado);
    // Desde asignado: no se entrega ni se falla.
    for (const [accion, cuerpo] of [['entregar'], ['fallar', { motivo: 'x' }]]) {
      const res = await rafa.post(`/domicilios/87/${accion}`, cuerpo);
      assert.strictEqual(res.status, 409, accion);
      assert.strictEqual(res.body.motivo, 'transicion_invalida');
    }
    assert.strictEqual((await rafa.post('/domicilios/87/salir')).status, 200);
    // Repetir salir.
    const desde = db.ejecutadas.length;
    const otra = await rafa.post('/domicilios/87/salir');
    assert.strictEqual(otra.status, 409);
    assert.strictEqual(otra.body.motivo, 'transicion_invalida');
    assert.strictEqual(indice(db, 'UPDATE pedidos_domicilio', desde), -1, 'sin efectos');
    assert.ok(indice(db, 'ROLLBACK', desde) >= 0);
  }));

test('repartidor: entregar -> entrega entregada, pedido listo -> entregado firmado por él y, si ya está pagado, pagado; en una transacción', () =>
  con(async ({ estado, db }) => {
    await asignado(estado);
    await rafa.post('/domicilios/87/salir');
    const desde = db.ejecutadas.length;
    const res = await rafa.post('/domicilios/87/entregar');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.domicilio.estado_entrega, 'entregado');
    assert.strictEqual(estado.pedidos[87].estado, 'pagado', 'pagado por anticipado y saldo 0: se cierra');
    assert.deepStrictEqual(estado.historial[0], [87, REPARTIDOR, 'listo', 'Entregado a domicilio']);
    assert.deepStrictEqual(estado.historial[1], [87, REPARTIDOR, 'entregado'], 'el cierre también lo firma él');

    const i = (f) => indice(db, f, desde);
    assert.ok(i('BEGIN') < i('UPDATE pedidos_domicilio') && i('UPDATE pedidos_domicilio') < i("UPDATE pedidos SET estado = 'entregado'"));
    assert.ok(i("UPDATE pedidos SET estado = 'entregado'") < i('obtener_saldo_pendiente'));
    assert.ok(i("UPDATE pedidos SET estado = 'pagado'") < i('COMMIT'));
    assert.strictEqual(i('FROM mesas'), -1, 'sin mesa: nada que bloquear ni liberar');
    // Repetir es 409 sin efectos.
    const otra = await rafa.post('/domicilios/87/entregar');
    assert.strictEqual(otra.status, 409);
    assert.strictEqual(otra.body.motivo, 'transicion_invalida');
  }));

test('repartidor: entregar un pedido que NO está pagado lo deja en entregado (sin cerrarlo)', () =>
  con(async ({ estado }) => {
    estado.pedidos[87].estado_pago = 'pendiente';
    await asignado(estado);
    await rafa.post('/domicilios/87/salir');
    assert.strictEqual((await rafa.post('/domicilios/87/entregar')).status, 200);
    assert.strictEqual(estado.pedidos[87].estado, 'entregado');
  }));

test('repartidor: fallar con motivo -> fallido (FINAL: después nada vale) y el pedido sigue en listo', () =>
  con(async ({ estado }) => {
    await asignado(estado);
    await rafa.post('/domicilios/87/salir');
    const res = await rafa.post('/domicilios/87/fallar', { motivo: '  No había nadie  ' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.domicilio.estado_entrega, 'fallido');
    assert.strictEqual(estado.domicilios[87].motivo_fallo, 'No había nadie', 'recortado');
    assert.strictEqual(estado.pedidos[87].estado, 'listo');
    for (const [accion, cuerpo] of [['salir'], ['entregar'], ['fallar', { motivo: 'otra vez' }]]) {
      const r = await rafa.post(`/domicilios/87/${accion}`, cuerpo);
      assert.strictEqual(r.status, 409, accion);
      assert.strictEqual(r.body.motivo, 'transicion_invalida');
    }
    const reasignar = await admin.patch('/domicilios/87/repartidor', { id_repartidor: OTRO_REPARTIDOR });
    assert.strictEqual(reasignar.body.motivo, 'entrega_ya_salio', 'tampoco se reintenta reasignando');
  }));

for (const [caso, cuerpo] of [
  ['sin motivo', {}],
  ['motivo vacío', { motivo: '   ' }],
  ['motivo de 201', { motivo: 'm'.repeat(201) }],
  ['motivo que no es texto', { motivo: 5 }],
  ['un campo de más', { motivo: 'x', foto: 'y' }],
]) {
  test(`repartidor: fallar ${caso} -> 400 cuerpo_invalido`, () =>
    con(async ({ estado }) => {
      Object.assign(estado.domicilios[87], { id_repartidor: REPARTIDOR, estado_entrega: 'en_camino' });
      const res = await rafa.post('/domicilios/87/fallar', cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(estado.domicilios[87].estado_entrega, 'en_camino');
    }));
}

test('repartidor: salir y entregar no llevan cuerpo -> 400 cuerpo_invalido si viene uno', () =>
  con(async ({ estado }) => {
    await asignado(estado);
    const res = await rafa.post('/domicilios/87/salir', { rapido: true });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
  }));

// ---------------------------------------------------------------------------
// Nadie cancela con la entrega en camino
// ---------------------------------------------------------------------------

test('en camino: PATCH /pedidos/:id/estado a cancelado -> 409 entrega_en_camino, bloqueando pedido -> domicilio', () =>
  con(async ({ estado, db }) => {
    Object.assign(estado.domicilios[87], { id_repartidor: REPARTIDOR, estado_entrega: 'en_camino' });
    const desde = db.ejecutadas.length;
    const res = await admin.patch('/pedidos/87/estado', { estado: 'cancelado' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'entrega_en_camino');
    const iPedido = indice(db, 'SELECT id_pedido FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', desde);
    const iDomicilio = indice(db, 'FROM pedidos_domicilio WHERE id_pedido = $1::int FOR UPDATE', desde);
    assert.ok(iPedido >= 0 && iPedido < iDomicilio, 'pedido antes que pedidos_domicilio');
    assert.strictEqual(indice(db, 'UPDATE pedidos SET estado', desde), -1, 'no se tocó el pedido');
    assert.ok(indice(db, 'ROLLBACK', desde) >= 0);
  }));

test('en camino: POST /pedidos/:id/cancelar del personal -> 409 entrega_en_camino', () =>
  con(async ({ estado }) => {
    Object.assign(estado.domicilios[87], { id_repartidor: REPARTIDOR, estado_entrega: 'en_camino' });
    const res = await admin.post('/pedidos/87/cancelar', {});
    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body.motivo, 'entrega_en_camino');
  }));

test('en camino: cancelar una línea (cancelarItem del personal) -> 409 entrega_en_camino', () =>
  con(
    async ({ estado }) => {
      Object.assign(estado.domicilios[87], { id_repartidor: REPARTIDOR, estado_entrega: 'en_camino' });
      const res = await admin.post('/pedidos/87/items/500/cancelar', { motivo: 'El cliente ya no lo quiere' });
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, 'entrega_en_camino');
    },
    {
      extra: (sql) => {
        if (sql.includes('FROM pedidos WHERE id_pedido = $1::int FOR UPDATE') && sql.includes('codigo_pedido')) {
          return { rows: [{ id_pedido: 87, id_mesa: null, codigo_pedido: 'D-87', estado: 'listo', total: 30000, creado_en: new Date() }] };
        }
        if (sql.includes('FROM detalles_pedido dp JOIN platos')) {
          return { rows: [{ id_detalle: 500, id_plato: 1, comensal: null, estado_item: 'listo', subtotal: 25000, nombre: 'Arepa' }] };
        }
        return undefined;
      },
    }
  ));

test('antes de salir (asignado), el admin SÍ cancela el pedido', () =>
  con(
    async ({ estado }) => {
      await asignado(estado);
      const res = await admin.patch('/pedidos/87/estado', { estado: 'cancelado' });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    },
    {
      extra: (sql, params) => {
        if (sql.includes('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2')) {
          return { rows: [{ id_pedido: 87, estado: params[0], id_mesa: null, estado_pago: 'pagado' }] };
        }
        return undefined;
      },
    }
  ));

// ---------------------------------------------------------------------------
// En un domicilio solo el repartidor marca la entrega
// ---------------------------------------------------------------------------

for (const est of ['por_asignar', 'asignado', 'en_camino', 'entregado', 'fallido']) {
  test(`domicilio con la entrega en ${est}: PATCH /pedidos/:id/estado a entregado -> 409 entrega_por_repartidor, sin tocar nada`, () =>
    con(async ({ estado, db }) => {
      Object.assign(estado.domicilios[87], {
        estado_entrega: est,
        id_repartidor: est === 'por_asignar' ? null : REPARTIDOR,
      });
      const desde = db.ejecutadas.length;
      const res = await cajero.patch('/pedidos/87/estado', { estado: 'entregado' });
      assert.strictEqual(res.status, 409, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body, {
        error: 'En un domicilio la entrega la marca el repartidor',
        motivo: 'entrega_por_repartidor',
      });
      assert.strictEqual(estado.pedidos[87].estado, 'listo');
      assert.strictEqual(estado.domicilios[87].estado_entrega, est);
      const iPedido = indice(db, 'SELECT id_pedido, canal FROM pedidos WHERE id_pedido = $1::int FOR UPDATE', desde);
      const iDomicilio = indice(db, 'FROM pedidos_domicilio WHERE id_pedido = $1::int FOR UPDATE', desde);
      assert.ok(iPedido >= 0 && iPedido < iDomicilio, 'pedido antes que pedidos_domicilio');
      assert.strictEqual(indice(db, 'UPDATE pedidos SET estado', desde), -1);
      assert.ok(indice(db, 'ROLLBACK', desde) >= 0);
    }));
}

for (const [canal, id] of [['mesa', 90], ['para_llevar', 91]]) {
  test(`${canal}: PATCH /pedidos/:id/estado a entregado sigue funcionando (200)`, () =>
    con(
      async ({ db }) => {
        const desde = db.ejecutadas.length;
        const res = await admin.patch(`/pedidos/${id}/estado`, { estado: 'entregado' });
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        assert.strictEqual(res.body.estado, 'entregado');
        assert.ok(indice(db, 'UPDATE pedidos SET estado = $1 WHERE id_pedido = $2', desde) >= 0);
      },
      {
        extra: (sql, params) => {
          if (sql.includes('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2')) {
            return { rows: [{ id_pedido: id, estado: params[0], id_mesa: id === 90 ? 5 : null, estado_pago: 'pendiente', canal }] };
          }
          return undefined;
        },
      }
    ));
}

// ---------------------------------------------------------------------------
// Socket: los pedidos sin mesa no se avisan
// ---------------------------------------------------------------------------

test('socket: order:status e item:cancelado de un pedido SIN mesa no se envían (y no lanzan)', () =>
  con(async ({ socket }) => {
    const a = await socketNotifier.notificarCambioEstado({ id_pedido: 87, id_mesa: null, codigo_pedido: 'D-87', estado_anterior: 'listo', estado: 'cancelado' });
    const b = await socketNotifier.notificarItemCancelado({
      id_pedido: 87, id_mesa: null, codigo_pedido: 'D-87', id_detalle: 1, id_plato: 1, nombre: 'x', comensal: null, total: 0, estado_pedido: 'listo', origen: 'personal',
    });
    assert.deepStrictEqual([a, b], [socketNotifier.SIN_MESA, socketNotifier.SIN_MESA]);
    assert.strictEqual(socket.avisos.length, 0, 'ninguno salió a la red');
    // Con mesa sí sale.
    await socketNotifier.notificarCambioEstado({ id_pedido: 90, id_mesa: 5, codigo_pedido: 'M-90', estado_anterior: 'listo', estado: 'entregado' });
    assert.strictEqual(socket.avisos.length, 1);
  }));

test('socket: las rutas del repartidor no emiten ningún aviso en la D-20a', () =>
  con(async ({ estado, socket }) => {
    await asignado(estado);
    await rafa.post('/domicilios/87/salir');
    await rafa.post('/domicilios/87/entregar');
    await socketNotifier.esperarAvisos();
    assert.strictEqual(socket.avisos.length, 0);
  }));
