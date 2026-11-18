const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const socketNotifier = require('../src/services/socket.notifier');
const clienteActivo = require('../src/services/cliente-activo');
const servicio = require('../src/services/pedidos-domicilio.service');
const pedidosService = require('../src/services/pedidos.service');
const { firmarTokenCliente } = require('../src/controllers/clientes-auth.controller');
const { crearTareaVencimiento, cancelarVencidos } = require('../src/services/vencimiento-por-pagar');
const app = require('../server');

// D-20b: pedidos para llevar y a domicilio desde la app (docs/api-spec.md).
// Parte 1: cada ruta y cada error, con el servicio reemplazado.
// Parte 2: el servicio y el vencimiento contra el doble de la base.
// Lo que decide la base (las funciones del script 36 y las carreras) está en
// tests/integracion/pedidos-domicilio-sql.test.js.

const ID_CLIENTE = 5;
const ID_PEDIDO = 87;
const jwtCliente = () => `Bearer ${firmarTokenCliente(ID_CLIENTE).token}`;

const PEDIDO = {
  id_pedido: ID_PEDIDO, codigo_pedido: 'PED-261114-A1B2C', canal: 'domicilio', estado: 'por_pagar',
  total: 15000, costo_envio: 5000, vence_en: '2026-11-14T20:25:00.000Z', creado_en: '2026-11-14T20:10:00.000Z',
  entrega: { direccion: 'Calle 1', barrio: 'Centro', zona: 'Norte', estado_entrega: 'por_asignar' }, items: [],
};

const ITEM = { id_plato: 4, cantidad: 2 };

/** Reemplaza funciones y devuelve cómo deshacerlo; el cliente siempre activo. */
function escenario(cambios = {}, { socket } = {}) {
  const db = instalarFakeDb(() => ({ rows: [] }));
  const s = instalarFakeSocket(socket);
  const originales = { estaActivo: clienteActivo.estaActivo };
  clienteActivo.estaActivo = async () => true;
  const llamadas = {};
  for (const [k, fn] of Object.entries(cambios)) {
    originales[k] = servicio[k];
    servicio[k] = async (...a) => {
      (llamadas[k] = llamadas[k] || []).push(a);
      return fn(...a);
    };
  }
  return {
    db,
    socket: s,
    llamadas,
    restaurar() {
      clienteActivo.estaActivo = originales.estaActivo;
      for (const k of Object.keys(cambios)) servicio[k] = originales[k];
      s.restaurar();
      db.restaurar();
    },
  };
}

const crear = (cuerpo, token = jwtCliente()) => {
  const r = request(app).post('/api/v1/pedidos-domicilio').send(cuerpo);
  return token ? r.set('Authorization', token) : r;
};

// ===========================================================================
// Parte 1 · rutas del cliente
// ===========================================================================

test('d20b crear: 201 con el pedido; el cliente sale del JWT y los ítems llegan como en POST /pedidos (sin comensal)', async () => {
  const e = escenario({ crear: async () => ({ pedido: PEDIDO }) });
  try {
    const res = await crear({ canal: 'domicilio', id_direccion: 12, notas_generales: 'Sin cebolla', items: [{ ...ITEM, notas: 'asado' }] });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body, { pedido: PEDIDO });
    assert.deepStrictEqual(e.llamadas.crear[0][0], {
      idCliente: ID_CLIENTE, canal: 'domicilio', idDireccion: 12, telefonoContacto: null, notasGenerales: 'Sin cebolla',
      items: [{ id_plato: 4, cantidad: 2, comensal: null, notas: 'asado', ingredientes: [] }],
    });
  } finally {
    e.restaurar();
  }
});

for (const [caso, cuerpo] of [
  ['para_llevar con id_direccion', { canal: 'para_llevar', id_direccion: 12, items: [ITEM] }],
  ['domicilio sin id_direccion', { canal: 'domicilio', items: [ITEM] }],
  ['canal de mesa', { canal: 'mesa', items: [ITEM] }],
  ['un comensal en un ítem', { canal: 'para_llevar', items: [{ ...ITEM, comensal: 'Ana' }] }],
  ['un precio en un ítem', { canal: 'para_llevar', items: [{ ...ITEM, precio: 1 }] }],
  ['cantidad 21', { canal: 'para_llevar', items: [{ ...ITEM, cantidad: 21 }] }],
  ['sin ítems', { canal: 'para_llevar', items: [] }],
  ['un campo de más', { canal: 'para_llevar', items: [ITEM], id_mesa: 3 }],
]) {
  test(`d20b crear: ${caso} -> 400 cuerpo_invalido sin llamar al servicio`, async () => {
    const e = escenario({ crear: async () => ({ pedido: PEDIDO }) });
    try {
      const res = await crear(cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.ok(res.body.error);
      assert.strictEqual(e.llamadas.crear, undefined);
    } finally {
      e.restaurar();
    }
  });
}

for (const [caso, r, status, motivo] of [
  ['la dirección no es del cliente', { noEncontrada: true }, 404, 'no_encontrado'],
  ['fuera de cobertura', { fueraDeCobertura: true }, 422, 'fuera_de_cobertura'],
]) {
  test(`d20b crear: ${caso} -> ${status} ${motivo}`, async () => {
    const e = escenario({ crear: async () => r });
    try {
      const res = await crear({ canal: 'domicilio', id_direccion: 12, items: [ITEM] });
      assert.deepStrictEqual([res.status, res.body.motivo], [status, motivo]);
    } finally {
      e.restaurar();
    }
  });
}

test('d20b crear: sin stock (SD001) -> 409 sin_stock con faltantes, como en POST /pedidos', async () => {
  const sinStock = Object.assign(new Error('Sin stock suficiente'), {
    code: 'SD001', detail: JSON.stringify({ faltantes: [{ tipo: 'plato', id: 4, nombre: 'Arepa' }] }),
  });
  const e = escenario({ crear: async () => { throw sinStock; } });
  try {
    const res = await crear({ canal: 'para_llevar', items: [ITEM] });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.motivo, 'sin_stock');
    assert.deepStrictEqual(res.body.faltantes, [{ tipo: 'plato', id: 4, nombre: 'Arepa' }]);
  } finally {
    e.restaurar();
  }
});

test('d20b crear: un deadlock (40P01) -> 503 reintentar (no se reintenta solo: no hay clave de idempotencia)', async () => {
  const e = escenario({ crear: async () => { throw Object.assign(new Error('deadlock'), { code: '40P01' }); } });
  try {
    const res = await crear({ canal: 'para_llevar', items: [ITEM] });
    assert.deepStrictEqual([res.status, res.body.motivo], [503, 'reintentar']);
  } finally {
    e.restaurar();
  }
});

test('d20b: sin JWT 401 no_autenticado; con JWT de personal 403 prohibido; en /api (sin v1) 404', async () => {
  const e = escenario({ crear: async () => ({ pedido: PEDIDO }) });
  try {
    const sin = await crear({ canal: 'para_llevar', items: [ITEM] }, null);
    assert.deepStrictEqual([sin.status, sin.body.motivo], [401, 'no_autenticado']);
    const staff = await crear({ canal: 'para_llevar', items: [ITEM] }, `Bearer ${tokenStaff(1, 'admin')}`);
    assert.deepStrictEqual([staff.status, staff.body.motivo], [403, 'prohibido']);
    const enApi = await request(app).post('/api/pedidos-domicilio').set('Authorization', jwtCliente()).send({ canal: 'para_llevar', items: [ITEM] });
    assert.strictEqual(enApi.status, 404, 'solo en v1');
    assert.strictEqual(e.llamadas.crear, undefined);
  } finally {
    e.restaurar();
  }
});

test('d20b mios: 200 con los del cliente del JWT; un parámetro -> 400', async () => {
  const e = escenario({ listarMios: async () => [PEDIDO] });
  try {
    const res = await request(app).get('/api/v1/pedidos-domicilio/mios').set('Authorization', jwtCliente());
    assert.deepStrictEqual([res.status, res.body], [200, { pedidos: [PEDIDO] }]);
    assert.deepStrictEqual(e.llamadas.listarMios[0], [ID_CLIENTE]);
    const mal = await request(app).get('/api/v1/pedidos-domicilio/mios?id_cliente=9').set('Authorization', jwtCliente());
    assert.deepStrictEqual([mal.status, mal.body.motivo], [400, 'cuerpo_invalido']);
  } finally {
    e.restaurar();
  }
});

for (const [caso, r, status, motivo] of [
  ['en por_pagar', { pedido: { ...PEDIDO, estado: 'cancelado' } }, 200, undefined],
  ['no es suyo o no existe', { noExiste: true }, 404, 'no_encontrado'],
  ['ya estaba cancelado', { yaCancelado: true }, 409, 'pedido_ya_cancelado'],
  ['ya se pagó', { pagado: true, estado: 'recibido' }, 409, 'pedido_pagado'],
]) {
  test(`d20b cancelar: ${caso} -> ${status}${motivo ? ` ${motivo}` : ''}`, async () => {
    const e = escenario({ cancelar: async () => r });
    try {
      const res = await request(app).post(`/api/v1/pedidos-domicilio/${ID_PEDIDO}/cancelar`).set('Authorization', jwtCliente());
      assert.strictEqual(res.status, status, JSON.stringify(res.body));
      assert.strictEqual(res.body.motivo, motivo);
      assert.deepStrictEqual(e.llamadas.cancelar[0], [ID_PEDIDO, ID_CLIENTE]);
    } finally {
      e.restaurar();
    }
  });
}

test('d20b cancelar: un :id inválido -> 404; un cuerpo con campos -> 400', async () => {
  const e = escenario({ cancelar: async () => ({ pedido: PEDIDO }) });
  try {
    const mal = await request(app).post('/api/v1/pedidos-domicilio/abc/cancelar').set('Authorization', jwtCliente());
    assert.deepStrictEqual([mal.status, mal.body.motivo], [404, 'no_encontrado']);
    const cuerpo = await request(app).post(`/api/v1/pedidos-domicilio/${ID_PEDIDO}/cancelar`).set('Authorization', jwtCliente()).send({ motivo: 'x' });
    assert.deepStrictEqual([cuerpo.status, cuerpo.body.motivo], [400, 'cuerpo_invalido']);
    assert.strictEqual(e.llamadas.cancelar, undefined);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Parte 1 · rutas internas
// ===========================================================================

const COBRO = { id_pedido: ID_PEDIDO, id_cliente: ID_CLIENTE, moneda: 'COP', monto_centavos: 1500000, referencia: 'SD-P-87-A1B2C', vence_en: PEDIDO.vence_en };
const urlCobro = (q = `?id_cliente=${ID_CLIENTE}`) => `/api/pedidos-domicilio/${ID_PEDIDO}/cobro/interno${q}`;

test('d20b cobro: con la clave -> 200; sin ella 401; en /api/v1 404', async () => {
  const e = escenario({ cobroInterno: async () => ({ cobro: COBRO }) });
  try {
    const ok = await request(app).get(urlCobro()).set('x-internal-key', CLAVE_FALSA);
    assert.deepStrictEqual([ok.status, ok.body], [200, COBRO]);
    assert.deepStrictEqual(e.llamadas.cobroInterno[0], [ID_PEDIDO, ID_CLIENTE]);
    assert.strictEqual((await request(app).get(urlCobro())).status, 401);
    assert.strictEqual((await request(app).get(`/api/v1${urlCobro().slice(4)}`).set('x-internal-key', CLAVE_FALSA)).status, 404);
  } finally {
    e.restaurar();
  }
});

for (const [caso, r, status, motivo, extra] of [
  ['no existe o no es de ese cliente', { noExiste: true }, 404, 'no_encontrado'],
  ['ya no está en por_pagar', { noPorPagar: true, estado: 'recibido' }, 409, 'pedido_no_por_pagar', { estado: 'recibido' }],
  ['venció', { vencido: true }, 409, 'pedido_vencido'],
]) {
  test(`d20b cobro: ${caso} -> ${status} ${motivo}`, async () => {
    const e = escenario({ cobroInterno: async () => r });
    try {
      const res = await request(app).get(urlCobro()).set('x-internal-key', CLAVE_FALSA);
      assert.deepStrictEqual([res.status, res.body.motivo], [status, motivo]);
      if (extra) assert.strictEqual(res.body.estado, extra.estado);
    } finally {
      e.restaurar();
    }
  });
}

test('d20b cobro: sin id_cliente, con uno inválido o con un parámetro de más -> 400 parametro_invalido', async () => {
  const e = escenario({ cobroInterno: async () => ({ cobro: COBRO }) });
  try {
    for (const q of ['', '?id_cliente=0', '?id_cliente=abc', `?id_cliente=${ID_CLIENTE}&x=1`]) {
      const res = await request(app).get(urlCobro(q)).set('x-internal-key', CLAVE_FALSA);
      assert.deepStrictEqual([res.status, res.body.motivo], [400, 'parametro_invalido'], q);
    }
    assert.strictEqual(e.llamadas.cobroInterno, undefined);
  } finally {
    e.restaurar();
  }
});

const PAGO = {
  referencia_externa: 'SD-P-87-A1B2C', id_transaccion_pasarela: '1132-9', pasarela: 'wompi',
  monto_centavos: 1500000, moneda: 'COP', metodo_pago: 'online',
};
const pagar = (cuerpo = PAGO) => request(app).post(`/api/pedidos-domicilio/${ID_PEDIDO}/pago/interno`).set('x-internal-key', CLAVE_FALSA).send(cuerpo);

test('d20b pago confirmado: 201 y el aviso de pedido pagado (formato order:created, origen domicilio) por la cadena', async () => {
  const pedidoBase = { id_pedido: ID_PEDIDO, codigo_pedido: 'PED-261114-A1B2C', id_mesa: null, estado: 'recibido', total: 15000, notas_generales: null, canal: 'domicilio', id_cliente: ID_CLIENTE };
  const e = escenario({
    confirmarPagoInterno: async () => ({ duplicado: false, resultado: 'confirmado', id_transaccion: 812, id_por_devolver: null, motivo_devolucion: null }),
    pedidoParaAviso: async () => ({ pedido: pedidoBase, detalles: [] }),
  });
  try {
    const res = await pagar();
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body, {
      ok: true, duplicado: false, resultado: 'confirmado', id_transaccion: 812, id_por_devolver: null, motivo_devolucion: null,
    });
    assert.deepStrictEqual(e.llamadas.confirmarPagoInterno[0], [ID_PEDIDO, PAGO]);
    await socketNotifier.esperarAvisos();
    const aviso = e.socket.buscar('/internal/order-created');
    assert.ok(aviso, 'aviso de pedido pagado');
    assert.strictEqual(aviso.cuerpo.origen, 'domicilio');
    assert.deepStrictEqual(
      [aviso.cuerpo.pedido.id_pedido, aviso.cuerpo.pedido.id_mesa, aviso.cuerpo.pedido.canal, aviso.cuerpo.pedido.id_cliente, aviso.cuerpo.pedido.estado],
      [ID_PEDIDO, null, 'domicilio', ID_CLIENTE, 'recibido']
    );
    assert.ok(Array.isArray(aviso.cuerpo.pedido.items));
  } finally {
    e.restaurar();
  }
});

for (const [caso, r, status] of [
  ['duplicado', { duplicado: true, resultado: 'confirmado', id_transaccion: 812, id_por_devolver: null, motivo_devolucion: null }, 200],
  ['por devolver', { duplicado: false, resultado: 'por_devolver', id_transaccion: null, id_por_devolver: 15, motivo_devolucion: 'pedido_cancelado' }, 201],
]) {
  test(`d20b pago ${caso}: ${status} con el resultado y SIN aviso de pedido pagado`, async () => {
    const e = escenario({ confirmarPagoInterno: async () => r, pedidoParaAviso: async () => null });
    try {
      const res = await pagar();
      assert.strictEqual(res.status, status, JSON.stringify(res.body));
      assert.deepStrictEqual(res.body, { ok: true, ...r });
      await socketNotifier.esperarAvisos();
      assert.strictEqual(e.socket.buscar('/internal/order-created'), undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('d20b pago: si el aviso falla (socket-server caído o 400 por id_mesa) la respuesta sale igual', async () => {
  const e = escenario({
    confirmarPagoInterno: async () => ({ duplicado: false, resultado: 'confirmado', id_transaccion: 812, id_por_devolver: null, motivo_devolucion: null }),
    pedidoParaAviso: async () => ({ pedido: { id_pedido: ID_PEDIDO, id_mesa: null, estado: 'recibido', total: 1, canal: 'domicilio', id_cliente: ID_CLIENTE }, detalles: [] }),
  }, { socket: () => ({ __status: 400, error: 'pedido.id_mesa debe ser un entero positivo', codigo: 'PAYLOAD_INVALIDO' }) });
  const original = console.error;
  console.error = () => {};
  try {
    assert.strictEqual((await pagar()).status, 201);
    await socketNotifier.esperarAvisos();
  } finally {
    console.error = original;
    e.restaurar();
  }
});

for (const [caso, cuerpo, motivo] of [
  ['una referencia de otro pedido', { ...PAGO, referencia_externa: 'SD-P-88-A1B2C' }, 'referencia_invalida'],
  ['una referencia de mesa', { ...PAGO, referencia_externa: 'SD-5-1760212345678-Qm9v' }, 'referencia_invalida'],
  ['otra moneda', { ...PAGO, moneda: 'USD' }, 'cuerpo_invalido'],
  ['monto con decimales', { ...PAGO, monto_centavos: 10.5 }, 'cuerpo_invalido'],
  ['sin id_transaccion_pasarela', { ...PAGO, id_transaccion_pasarela: undefined }, 'cuerpo_invalido'],
  ['un campo de más', { ...PAGO, id_pedido: 87 }, 'cuerpo_invalido'],
]) {
  test(`d20b pago: ${caso} -> 400 ${motivo} sin llamar a la base`, async () => {
    const e = escenario({ confirmarPagoInterno: async () => ({}) });
    try {
      const res = await pagar(cuerpo);
      assert.deepStrictEqual([res.status, res.body.motivo], [400, motivo]);
      assert.strictEqual(e.llamadas.confirmarPagoInterno, undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('d20b pago: el pedido no existe -> 404 no_encontrado', async () => {
  const e = escenario({ confirmarPagoInterno: async () => ({ noExiste: true }) });
  try {
    const res = await pagar();
    assert.deepStrictEqual([res.status, res.body.motivo], [404, 'no_encontrado']);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Parte 2 · el servicio contra el doble de la base
// ===========================================================================

test('d20b servicio: la referencia es siempre la misma para el pedido (SD-P-<id>-<5 de codigo_pedido>)', () => {
  assert.strictEqual(servicio.referenciaDelPedido(87, 'PED-261114-A1B2C'), 'SD-P-87-A1B2C');
  assert.ok(servicio.esReferenciaDelPedido('SD-P-87-A1B2C', 87));
  assert.ok(!servicio.esReferenciaDelPedido('SD-P-871-A1B2C', 87));
  assert.ok(!servicio.esReferenciaDelPedido('SD-P-87-', 87));
  assert.ok(!servicio.esReferenciaDelPedido('SD-P-87-A1 B2', 87));
});

test('d20b servicio: crear a domicilio inserta pedido (por_pagar, sin mesa), DESPUÉS su entrega y DESPUÉS las líneas', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM direcciones d')) {
      return { rows: [{ id_direccion: 12, direccion: 'Calle 1', barrio: 'Centro', referencia: null, lat: null, lng: null, telefono: '300', id_zona: 3, costo_envio: '5000' }] };
    }
    if (sql.includes('INSERT INTO pedidos (')) return { rows: [{ id_pedido: ID_PEDIDO }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: ID_PEDIDO }] };
    if (sql.includes('FROM pedidos p') && sql.includes('LEFT JOIN pedidos_domicilio')) {
      return { rows: [{ id_pedido: ID_PEDIDO, codigo_pedido: 'PED-261114-A1B2C', canal: 'domicilio', estado: 'por_pagar', total: '15000', costo_envio: '5000' }] };
    }
    return { rows: [] };
  });
  try {
    const r = await servicio.crear({ idCliente: ID_CLIENTE, canal: 'domicilio', idDireccion: 12, items: [{ id_plato: 4, cantidad: 1, comensal: null, notas: null, ingredientes: [] }] });
    assert.strictEqual(r.pedido.total, 15000);
    const dir = db.buscar('FROM direcciones d');
    assert.deepStrictEqual(dir.params, [12, ID_CLIENTE], 'la dirección tiene que ser del cliente');
    assert.match(dir.sql, /cotizar_zona\(d\.barrio::text\)/);
    const sqls = db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    const pedido = db.buscar('INSERT INTO pedidos (');
    assert.match(pedido.sql, /'por_pagar'/);
    assert.match(pedido.sql, /VALUES \(NULL,/, 'sin mesa');
    assert.deepStrictEqual(pedido.params.slice(2), ['domicilio', ID_CLIENTE]);
    assert.ok(i('INSERT INTO pedidos (') < i('INSERT INTO pedidos_domicilio'), 'pedidos antes que pedidos_domicilio');
    assert.ok(i('INSERT INTO pedidos_domicilio') < i('INSERT INTO detalles_pedido'), 'pedidos_domicilio antes que las líneas');
    assert.deepStrictEqual(db.buscar('INSERT INTO pedidos_domicilio').params, [ID_PEDIDO, 12, 'Calle 1', 'Centro', null, null, null, '300', 3, '5000']);
    assert.match(db.buscar('INSERT INTO historial_estados').sql, /'por_pagar', 'Pedido creado desde la app'/);
  } finally {
    db.restaurar();
  }
});

test('d20b servicio: fuera de cobertura (sin zona) no crea nada', async () => {
  const db = instalarFakeDb((sql) => (sql.includes('FROM direcciones d')
    ? { rows: [{ id_direccion: 12, direccion: 'x', barrio: 'y', id_zona: null }] } : { rows: [] }));
  try {
    assert.deepStrictEqual(await servicio.crear({ idCliente: ID_CLIENTE, canal: 'domicilio', idDireccion: 12, items: [] }), { fueraDeCobertura: true });
    assert.strictEqual(db.buscar('BEGIN'), undefined);
  } finally {
    db.restaurar();
  }
});

test('d20b servicio: el pago llama registrar_pago_anticipado con los centavos a pesos en SQL; P0002 -> noExiste', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('registrar_pago_anticipado')) return { rows: [{ resultado: 'confirmado', transaccion: 812, por_devolver: null }] };
    return { rows: [] };
  });
  try {
    const r = await servicio.confirmarPagoInterno(ID_PEDIDO, PAGO);
    assert.deepStrictEqual(r, { duplicado: false, resultado: 'confirmado', id_transaccion: 812, id_por_devolver: null, motivo_devolucion: null });
    const q = db.buscar('registrar_pago_anticipado');
    assert.match(q.sql, /\(\$2::bigint\)::numeric \/ 100/);
    assert.deepStrictEqual(q.params, [ID_PEDIDO, 1500000, 'online', 'SD-P-87-A1B2C']);
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
  const db2 = instalarFakeDb((sql) => {
    if (sql.includes('registrar_pago_anticipado')) throw Object.assign(new Error('El pedido 87 no existe'), { code: 'P0002' });
    return { rows: [] };
  });
  try {
    assert.deepStrictEqual(await servicio.confirmarPagoInterno(ID_PEDIDO, PAGO), { noExiste: true });
  } finally {
    db2.restaurar();
  }
});

test('d20b servicio: un duplicado se reconstruye (transacción -> confirmado; por devolver -> con su motivo); un 23505 se reintenta una vez', async () => {
  let intentos = 0;
  const db = instalarFakeDb((sql) => {
    if (sql.includes('registrar_pago_anticipado')) {
      intentos += 1;
      if (intentos === 1) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      return { rows: [{ resultado: 'duplicado', transaccion: null, por_devolver: 15 }] };
    }
    if (sql.includes('FROM pagos_por_devolver')) return { rows: [{ motivo: 'pedido_cancelado' }] };
    return { rows: [] };
  });
  try {
    const r = await servicio.confirmarPagoInterno(ID_PEDIDO, PAGO);
    assert.strictEqual(intentos, 2);
    assert.deepStrictEqual(r, { duplicado: true, resultado: 'por_devolver', id_transaccion: null, id_por_devolver: 15, motivo_devolucion: 'pedido_cancelado' });
  } finally {
    db.restaurar();
  }
});

test('d20b servicio: cancelar usa cancelar_pedido_por_pagar; FALSE -> según cómo quedó (cancelado o pagado)', async () => {
  let estado = 'por_pagar';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM pedidos') && sql.includes('id_cliente = $2::int')) return { rows: [{ id_pedido: ID_PEDIDO, estado, canal: 'para_llevar' }] };
    if (sql.includes('cancelar_pedido_por_pagar')) return { rows: [{ ok: false }] };
    return { rows: [] };
  });
  try {
    estado = 'recibido';
    assert.deepStrictEqual(await servicio.cancelar(ID_PEDIDO, ID_CLIENTE), { pagado: true, estado: 'recibido' });
    estado = 'cancelado';
    assert.deepStrictEqual(await servicio.cancelar(ID_PEDIDO, ID_CLIENTE), { yaCancelado: true });
    assert.deepStrictEqual(db.buscar('cancelar_pedido_por_pagar').params, [ID_PEDIDO]);
  } finally {
    db.restaurar();
  }
});

// ===========================================================================
// Parte 2 · el vencimiento
// ===========================================================================

function relojFalso() {
  const t = { fn: null, ms: null, cancelado: false };
  return { t, programar: (fn, ms) => { t.fn = fn; t.ms = ms; return t; }, cancelar: (x) => { x.cancelado = true; } };
}
const silencio = { log() {}, error() {} };

test('d20b vencimiento: cada minuto; iniciar dos veces no duplica el temporizador', () => {
  const reloj = relojFalso();
  let programados = 0;
  const tarea = crearTareaVencimiento({ programar: (fn, ms) => { programados += 1; return reloj.programar(fn, ms); }, cancelar: reloj.cancelar, ejecutar: async () => 0, registro: silencio });
  tarea.iniciar();
  tarea.iniciar();
  assert.strictEqual(programados, 1);
  assert.strictEqual(reloj.t.ms, 60000);
  assert.strictEqual(tarea.estado().activo, true);
});

test('d20b vencimiento: sin solaparse; una pasada mientras otra corre se salta', async () => {
  let soltar;
  let ejecuciones = 0;
  const tarea = crearTareaVencimiento({
    ejecutar: () => { ejecuciones += 1; return new Promise((r) => { soltar = () => r(2); }); },
    registro: silencio,
  });
  const a = tarea.pasada();
  const b = tarea.pasada();
  assert.strictEqual(a, b, 'la segunda devuelve la que está en curso');
  assert.strictEqual(ejecuciones, 1);
  assert.strictEqual(tarea.estado().saltadas, 1);
  soltar();
  await a;
  assert.deepStrictEqual([tarea.estado().pasadas, tarea.estado().cancelados, tarea.estado().enCurso], [1, 2, false]);
});

test('d20b vencimiento: detener() cancela el temporizador y espera la pasada en curso', async () => {
  const reloj = relojFalso();
  let soltar;
  let terminada = false;
  const tarea = crearTareaVencimiento({
    programar: reloj.programar, cancelar: reloj.cancelar, registro: silencio,
    ejecutar: () => new Promise((r) => { soltar = () => { terminada = true; r(0); }; }),
  });
  tarea.iniciar();
  reloj.t.fn();
  const detenida = tarea.detener();
  assert.strictEqual(reloj.t.cancelado, true);
  assert.strictEqual(terminada, false);
  soltar();
  await detenida;
  assert.strictEqual(terminada, true, 'detener esperó la pasada');
  assert.strictEqual(tarea.estado().activo, false);
});

test('d20b vencimiento: un fallo de la base no tumba la tarea; al log solo el código', async () => {
  const lineas = [];
  const tarea = crearTareaVencimiento({
    ejecutar: async () => { throw Object.assign(new Error('pedido 87 de ana@x.com'), { code: '57014' }); },
    registro: { log() {}, error: (m) => lineas.push(m) },
  });
  await tarea.pasada();
  assert.strictEqual(tarea.estado().fallos, 1);
  assert.deepStrictEqual(lineas, ['[por_pagar] no se pudo cancelar los vencidos (57014)']);
});

test('d20b vencimiento: el temporizador real lleva unref() (no retiene el proceso) y la pasada llama a la base', async () => {
  const original = global.setInterval;
  let conUnref = false;
  global.setInterval = () => ({ unref() { conUnref = true; } });
  try {
    const tarea = crearTareaVencimiento({ ejecutar: async () => 0, registro: silencio, cancelar: () => {} });
    tarea.iniciar();
    assert.strictEqual(conUnref, true);
  } finally {
    global.setInterval = original;
  }
  const db = instalarFakeDb((sql) => (sql.includes('cancelar_por_pagar_vencidos') ? { rows: [{ n: 3 }] } : { rows: [] }));
  try {
    assert.strictEqual(await cancelarVencidos(), 3);
  } finally {
    db.restaurar();
  }
});

test('d20b: el pedido de mesa no cambia (mismo INSERT de siempre, en recibido)', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ id_pedido: 1 }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 2 }] };
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: 1 }] };
    return { rows: [] };
  });
  try {
    await pedidosService.crearConDetalles({ id_mesa: 5, items: [{ id_plato: 4, cantidad: 1 }] });
    const q = db.buscar('INSERT INTO pedidos');
    assert.match(q.sql, /INSERT INTO pedidos \(id_mesa, codigo_pedido, notas_generales\)/);
    assert.strictEqual(db.buscar('pedidos_domicilio'), undefined);
    assert.match(db.buscar('INSERT INTO historial_estados').sql, /'recibido', 'Pedido creado'/);
    assert.strictEqual(db.buscar('FROM clientes WHERE id_cliente'), undefined, 'la mesa no bloquea clientes');
  } finally {
    db.restaurar();
  }
});

// ===========================================================================
// Ajustes de Juan
// ===========================================================================

test('juan: ya tiene un pedido en por_pagar -> 409 pedido_pendiente con ESE pedido', async () => {
  const e = escenario({ crear: async () => ({ pendiente: PEDIDO }) });
  try {
    const res = await crear({ canal: 'para_llevar', items: [ITEM] });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.motivo, 'pedido_pendiente');
    assert.ok(res.body.error);
    assert.deepStrictEqual(res.body.pedido, PEDIDO);
  } finally {
    e.restaurar();
  }
});

test('juan: a domicilio sin teléfono -> 422 telefono_requerido', async () => {
  const e = escenario({ crear: async () => ({ telefonoRequerido: true }) });
  try {
    const res = await crear({ canal: 'domicilio', id_direccion: 12, items: [ITEM] });
    assert.deepStrictEqual([res.status, res.body.motivo], [422, 'telefono_requerido']);
  } finally {
    e.restaurar();
  }
});

test('juan: telefono_contacto va al servicio en domicilio; en para llevar se valida pero no se usa', async () => {
  const e = escenario({ crear: async () => ({ pedido: PEDIDO }) });
  try {
    assert.strictEqual((await crear({ canal: 'domicilio', id_direccion: 12, telefono_contacto: '+573001234567', items: [ITEM] })).status, 201);
    assert.strictEqual(e.llamadas.crear[0][0].telefonoContacto, '+573001234567');
    assert.strictEqual((await crear({ canal: 'para_llevar', telefono_contacto: '3001234567', items: [ITEM] })).status, 201);
    assert.strictEqual(e.llamadas.crear[1][0].telefonoContacto, null);
  } finally {
    e.restaurar();
  }
});

for (const telefono of ['12', '300-123-4567', 3001234567, '']) {
  test(`juan: telefono_contacto inválido (${JSON.stringify(telefono)}) -> 400 telefono_invalido`, async () => {
    const e = escenario({ crear: async () => ({ pedido: PEDIDO }) });
    try {
      const res = await crear({ canal: 'domicilio', id_direccion: 12, telefono_contacto: telefono, items: [ITEM] });
      assert.deepStrictEqual([res.status, res.body.motivo], [400, 'telefono_invalido']);
      assert.strictEqual(e.llamadas.crear, undefined);
    } finally {
      e.restaurar();
    }
  });
}

test('juan: GET /:id -> 200 con el del cliente; si no es suyo 404; un :id inválido 404; /mios sigue siendo la lista', async () => {
  const e = escenario({ obtener: async (id) => (id === ID_PEDIDO ? PEDIDO : null), listarMios: async () => [PEDIDO] });
  try {
    const ok = await request(app).get(`/api/v1/pedidos-domicilio/${ID_PEDIDO}`).set('Authorization', jwtCliente());
    assert.deepStrictEqual([ok.status, ok.body], [200, { pedido: PEDIDO }]);
    assert.deepStrictEqual(e.llamadas.obtener[0], [ID_PEDIDO, ID_CLIENTE], 'el cliente sale del JWT');
    const ajeno = await request(app).get('/api/v1/pedidos-domicilio/88').set('Authorization', jwtCliente());
    assert.deepStrictEqual([ajeno.status, ajeno.body.motivo], [404, 'no_encontrado']);
    const mal = await request(app).get('/api/v1/pedidos-domicilio/abc').set('Authorization', jwtCliente());
    assert.deepStrictEqual([mal.status, mal.body.motivo], [404, 'no_encontrado']);
    const mios = await request(app).get('/api/v1/pedidos-domicilio/mios').set('Authorization', jwtCliente());
    assert.deepStrictEqual(mios.body, { pedidos: [PEDIDO] }, '"mios" no se toma como un :id');
  } finally {
    e.restaurar();
  }
});

test('juan servicio: bloquea la fila del CLIENTE primero; con uno vigente en por_pagar no inserta nada (ROLLBACK)', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes("estado = 'por_pagar'") && sql.includes('fn_minutos_pago_anticipado')) {
      return { rows: [{ id_pedido: 80, vencido: false }] };
    }
    if (sql.includes('FROM pedidos p') && sql.includes('LEFT JOIN pedidos_domicilio')) {
      return { rows: [{ id_pedido: 80, codigo_pedido: 'PED-1', canal: 'para_llevar', estado: 'por_pagar', total: '10000' }] };
    }
    return { rows: [] };
  });
  try {
    const r = await servicio.crear({ idCliente: ID_CLIENTE, canal: 'para_llevar', items: [{ id_plato: 4, cantidad: 1, comensal: null, notas: null, ingredientes: [] }] });
    assert.strictEqual(r.pendiente.id_pedido, 80);
    const sqls = db.ejecutadas.map((q) => q.sql);
    const i = (txt) => sqls.findIndex((s) => s.includes(txt));
    const bloqueo = db.buscar('FROM clientes WHERE id_cliente = $1::int FOR UPDATE');
    assert.ok(bloqueo, 'bloquea al cliente');
    assert.deepStrictEqual(bloqueo.params, [ID_CLIENTE]);
    assert.ok(i('BEGIN') < i('FROM clientes WHERE id_cliente') && i('FROM clientes WHERE id_cliente') < i("estado = 'por_pagar'"));
    assert.strictEqual(db.buscar('INSERT INTO pedidos'), undefined, 'no crea otro');
    assert.ok(db.buscar('ROLLBACK'));
    assert.strictEqual(db.buscar('COMMIT'), undefined);
  } finally {
    db.restaurar();
  }
});

test('juan servicio: los vencidos se cancelan con cancelar_pedido_por_pagar ANTES de crear el nuevo', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes("estado = 'por_pagar'") && sql.includes('fn_minutos_pago_anticipado')) {
      return { rows: [{ id_pedido: 70, vencido: true }, { id_pedido: 71, vencido: true }] };
    }
    if (sql.includes('INSERT INTO pedidos (')) return { rows: [{ id_pedido: ID_PEDIDO }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    return { rows: [] };
  });
  try {
    await servicio.crear({ idCliente: ID_CLIENTE, canal: 'para_llevar', items: [{ id_plato: 4, cantidad: 1, comensal: null, notas: null, ingredientes: [] }] });
    const cancelaciones = db.todas('cancelar_pedido_por_pagar');
    assert.deepStrictEqual(cancelaciones.map((c) => c.params), [
      [70, 'Pago anticipado no aprobado a tiempo'],
      [71, 'Pago anticipado no aprobado a tiempo'],
    ]);
    const sqls = db.ejecutadas.map((q) => q.sql);
    assert.ok(sqls.findIndex((s) => s.includes('cancelar_pedido_por_pagar')) < sqls.findIndex((s) => s.includes('INSERT INTO pedidos (')));
  } finally {
    db.restaurar();
  }
});

test('juan servicio: el teléfono de la app manda; sin él, el del perfil; sin ninguno, telefonoRequerido', async () => {
  let telefonoPerfil = '3009998877';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM direcciones d')) {
      return {
        rows: [{ id_direccion: 12, direccion: 'x', barrio: 'y', referencia: null, lat: null, lng: null, telefono: telefonoPerfil, id_zona: 3, costo_envio: '0' }],
      };
    }
    if (sql.includes('INSERT INTO pedidos (')) return { rows: [{ id_pedido: ID_PEDIDO }] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 700 }] };
    return { rows: [] };
  });
  const base = { idCliente: ID_CLIENTE, canal: 'domicilio', idDireccion: 12, items: [{ id_plato: 4, cantidad: 1, comensal: null, notas: null, ingredientes: [] }] };
  try {
    await servicio.crear({ ...base, telefonoContacto: '3111111111' });
    assert.strictEqual(db.todas('INSERT INTO pedidos_domicilio')[0].params[7], '3111111111');
    await servicio.crear(base);
    assert.strictEqual(db.todas('INSERT INTO pedidos_domicilio')[1].params[7], '3009998877');
    telefonoPerfil = null;
    assert.deepStrictEqual(await servicio.crear(base), { telefonoRequerido: true });
    assert.strictEqual(db.todas('INSERT INTO pedidos_domicilio').length, 2, 'no crea nada');
  } finally {
    db.restaurar();
  }
});
