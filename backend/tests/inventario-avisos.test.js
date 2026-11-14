const test = require('node:test');
const assert = require('node:assert');
const avisos = require('../src/services/inventario-avisos');
const socketNotifier = require('../src/services/socket.notifier');
const { instalarFakeSocket, socketCaido, ES_UUID } = require('./helpers/fake-socket');

// D-17 parte 2: avisos de inventario en vivo.
//
// El script 27 publica en el canal 'inventario' de PostgreSQL dos clases de
// aviso, y solo si la transaccion se confirma:
//   {"tipo":"disponibilidad","entidad":"plato"|"ingrediente","id","disponible","motivo"}
//   {"tipo":"stock_bajo","id_insumo","nombre","unidad","stock_actual","stock_minimo"}
//
// Lo que se vigila aqui:
//   - cada aviso se reenvia a la ruta interna que le toca, con reintento;
//   - los NUMERIC que salen de una CONSULTA (texto en pg) viajan como NUMEROS,
//     que es lo que exige el socket-server (400 PAYLOAD_INVALIDO si no);
//   - un payload ilegible o incompleto se ignora y NO tumba el oyente;
//   - al arrancar: LISTEN primero, luego el recalculo, luego la carta entera;
//   - si se cae la conexion, se reconecta con espera creciente y se repite todo;
//   - nada de esto puede tumbar el backend ni dejar un temporizador suelto.

/** Notificador doble: guarda lo enviado en vez de hablar con el socket-server. */
function notifierFalso({ ok = true } = {}) {
  const enviados = [];
  return {
    enviados,
    de(ruta) {
      return enviados.filter((x) => x.ruta === ruta);
    },
    async notificarPlatoDisponibilidad(id_plato, disponible, opciones) {
      enviados.push({ ruta: 'plato', id_plato, disponible, opciones });
      return { ok };
    },
    async notificarIngredienteDisponibilidad(id_ingrediente, disponible, opciones) {
      enviados.push({ ruta: 'ingrediente', id_ingrediente, disponible, opciones });
      return { ok };
    },
    async notificarInventarioAlerta(cuerpo) {
      enviados.push({ ruta: 'alerta', ...cuerpo });
      return { ok };
    },
  };
}

/**
 * Cliente de pg doble: registra las consultas, deja contestar a cada una y
 * expone los oyentes para poder simular un NOTIFY o una caida.
 */
function clienteFalso({ respuestas = {}, fallaConnect = false, fallaListen = false } = {}) {
  const oyentes = new Map();
  const cliente = {
    consultas: [],
    terminado: false,
    on(evento, fn) {
      oyentes.set(evento, fn);
      return cliente;
    },
    emitir(evento, dato) {
      const fn = oyentes.get(evento);
      return fn ? fn(dato) : undefined;
    },
    tieneOyente(evento) {
      return oyentes.has(evento);
    },
    async connect() {
      if (fallaConnect) throw new Error('no se pudo conectar');
    },
    async query(sql) {
      cliente.consultas.push(sql);
      if (fallaListen && sql.startsWith('LISTEN')) throw new Error('sin permiso para LISTEN');
      for (const [fragmento, valor] of Object.entries(respuestas)) {
        if (sql.includes(fragmento)) {
          return typeof valor === 'function' ? valor() : valor;
        }
      }
      return { rows: [] };
    },
    async end() {
      cliente.terminado = true;
    },
  };
  return cliente;
}

/** La carta que devuelve v_carta_disponible. */
const CARTA = {
  rows: [
    { tipo: 'ingrediente', id: 7, disponible_efectivo: false, motivo: 'stock' },
    { tipo: 'plato', id: 12, disponible_efectivo: true, motivo: null },
    { tipo: 'plato', id: 1001, disponible_efectivo: false, motivo: 'manual' },
  ],
};

const RESPUESTAS_ARRANQUE = {
  'fn_recalcular_toda_la_carta': { rows: [{ cambios: 3 }] },
  'v_carta_disponible': CARTA,
};

test.afterEach(() => {
  avisos.reiniciarEstado();
});

// ---------------------------------------------------------------------------
// manejarAviso: a que ruta va cada aviso
// ---------------------------------------------------------------------------

test('d-17: un aviso de disponibilidad de plato va a /internal/plato-disponibilidad', async () => {
  const notifier = notifierFalso();

  const resultado = await avisos.manejarAviso(
    JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 12, disponible: false, motivo: 'stock' }),
    { notifier }
  );

  assert.deepStrictEqual(resultado, { reenviado: 'disponibilidad' });
  assert.deepStrictEqual(notifier.enviados, [
    { ruta: 'plato', id_plato: 12, disponible: false, opciones: { conReintento: true } },
  ]);
});

test('d-17: un aviso de una opcion va a /internal/ingrediente-disponibilidad', async () => {
  const notifier = notifierFalso();

  await avisos.manejarAviso(
    JSON.stringify({ tipo: 'disponibilidad', entidad: 'ingrediente', id: 7, disponible: true, motivo: null }),
    { notifier }
  );

  assert.deepStrictEqual(notifier.enviados, [
    { ruta: 'ingrediente', id_ingrediente: 7, disponible: true, opciones: { conReintento: true } },
  ]);
});

test('d-17: los avisos del canal van SIEMPRE con reintento', async () => {
  // Nadie espera esta respuesta y el aviso no se guarda en ningun sitio: si se
  // pierde por un 503 pasajero, la carta queda desfasada en las mesas hasta el
  // proximo cambio de stock.
  const notifier = notifierFalso();

  await avisos.manejarAviso(
    JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 12, disponible: false }),
    { notifier }
  );

  assert.deepStrictEqual(notifier.enviados[0].opciones, { conReintento: true });
});

test('d-17: stock_bajo va a /internal/inventario-alerta con el contrato de §5.5', async () => {
  const notifier = notifierFalso();

  const resultado = await avisos.manejarAviso(
    JSON.stringify({
      tipo: 'stock_bajo',
      id_insumo: 12,
      nombre: 'Queso costeño',
      unidad: 'g',
      stock_actual: 450,
      stock_minimo: 500,
    }),
    { notifier }
  );

  assert.deepStrictEqual(resultado, { reenviado: 'stock_bajo' });
  assert.deepStrictEqual(notifier.enviados, [{
    ruta: 'alerta',
    id_insumo: 12,
    nombre: 'Queso costeño',
    unidad: 'g',
    stock_actual: 450,
    stock_minimo: 500,
  }]);
  // agotado y emitidoEn los pone el socket-server: mandarlos seria ruido.
  assert.strictEqual(notifier.enviados[0].agotado, undefined);
  assert.strictEqual(notifier.enviados[0].emitidoEn, undefined);
});

test('d-17: el stock llega como NUMERO aunque venga como texto', async () => {
  // Es el 400 PAYLOAD_INVALIDO del socket-server: los NUMERIC de una consulta
  // con pg llegan como '450.00'.
  const notifier = notifierFalso();

  await avisos.manejarAviso(
    JSON.stringify({
      tipo: 'stock_bajo', id_insumo: '12', nombre: 'Queso', unidad: 'g',
      stock_actual: '450.50', stock_minimo: '500.00',
    }),
    { notifier }
  );

  const alerta = notifier.enviados[0];
  assert.strictEqual(typeof alerta.stock_actual, 'number');
  assert.strictEqual(alerta.stock_actual, 450.5);
  assert.strictEqual(alerta.stock_minimo, 500);
  assert.strictEqual(alerta.id_insumo, 12);
});

test('d-17: un stock en 0 tambien se avisa (0 es un numero, no "vacio")', async () => {
  const notifier = notifierFalso();

  await avisos.manejarAviso(
    JSON.stringify({
      tipo: 'stock_bajo', id_insumo: 12, nombre: 'Queso', unidad: 'g',
      stock_actual: 0, stock_minimo: 500,
    }),
    { notifier }
  );

  assert.strictEqual(notifier.enviados.length, 1);
  assert.strictEqual(notifier.enviados[0].stock_actual, 0);
});

test('d-17: sin unidad se manda la de la columna por defecto', async () => {
  const notifier = notifierFalso();

  await avisos.manejarAviso(
    JSON.stringify({ tipo: 'stock_bajo', id_insumo: 12, nombre: 'Queso', stock_actual: 1, stock_minimo: 5 }),
    { notifier }
  );

  assert.strictEqual(notifier.enviados[0].unidad, 'porcion');
});

// ---------------------------------------------------------------------------
// manejarAviso: lo que se ignora sin romper nada
// ---------------------------------------------------------------------------

test('d-17: un payload ilegible se ignora y no lanza', async () => {
  const notifier = notifierFalso();

  assert.deepStrictEqual(await avisos.manejarAviso('{roto', { notifier }), { ignorado: 'json' });
  assert.deepStrictEqual(await avisos.manejarAviso('null', { notifier }), { ignorado: 'json' });
  assert.deepStrictEqual(await avisos.manejarAviso('"texto"', { notifier }), { ignorado: 'json' });
  assert.deepStrictEqual(notifier.enviados, []);
});

test('d-17: un tipo desconocido se ignora (un script mas nuevo no rompe el oyente)', async () => {
  const notifier = notifierFalso();

  assert.deepStrictEqual(
    await avisos.manejarAviso(JSON.stringify({ tipo: 'receta_cambiada', id: 1 }), { notifier }),
    { ignorado: 'tipo' }
  );
  assert.deepStrictEqual(notifier.enviados, []);
});

test('d-17: un aviso de disponibilidad incompleto no se reenvia', async () => {
  const notifier = notifierFalso();
  const malos = [
    { tipo: 'disponibilidad', entidad: 'plato', disponible: true },
    { tipo: 'disponibilidad', entidad: 'plato', id: 0, disponible: true },
    { tipo: 'disponibilidad', entidad: 'plato', id: 12 },
    { tipo: 'disponibilidad', entidad: 'plato', id: 12, disponible: 'si' },
    { tipo: 'disponibilidad', entidad: 'mesa', id: 12, disponible: true },
  ];

  for (const malo of malos) {
    const resultado = await avisos.manejarAviso(JSON.stringify(malo), { notifier });
    assert.strictEqual(resultado.ignorado, 'datos', JSON.stringify(malo));
  }
  assert.deepStrictEqual(notifier.enviados, []);
});

test('d-17: un aviso de stock bajo incompleto no se reenvia', async () => {
  const notifier = notifierFalso();
  const malos = [
    { tipo: 'stock_bajo', nombre: 'Queso', stock_actual: 1, stock_minimo: 5 },
    { tipo: 'stock_bajo', id_insumo: 12, stock_actual: 1, stock_minimo: 5 },
    { tipo: 'stock_bajo', id_insumo: 12, nombre: 'Queso', stock_minimo: 5 },
    { tipo: 'stock_bajo', id_insumo: 12, nombre: 'Queso', stock_actual: 'mucho', stock_minimo: 5 },
  ];

  for (const malo of malos) {
    const resultado = await avisos.manejarAviso(JSON.stringify(malo), { notifier });
    assert.strictEqual(resultado.ignorado, 'datos', JSON.stringify(malo));
  }
  assert.deepStrictEqual(notifier.enviados, []);
});

// ---------------------------------------------------------------------------
// El arranque: LISTEN, recalculo, carta
// ---------------------------------------------------------------------------

test('d-17: al arrancar hace LISTEN ANTES de recalcular', async () => {
  // Si se recalculara primero, los avisos de ese propio recalculo se emitirian
  // con el canal todavia sin escuchar y la carta quedaria desfasada.
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  const notifier = notifierFalso();

  await avisos.iniciar({ crearCliente: () => cliente, notifier });

  const listen = cliente.consultas.findIndex((sql) => sql.startsWith('LISTEN'));
  const recalculo = cliente.consultas.findIndex((sql) => sql.includes('fn_recalcular_toda_la_carta'));
  const carta = cliente.consultas.findIndex((sql) => sql.includes('v_carta_disponible'));

  assert.ok(listen >= 0, 'se hizo LISTEN');
  assert.strictEqual(cliente.consultas[listen], 'LISTEN inventario');
  assert.ok(listen < recalculo, 'LISTEN va antes del recalculo');
  assert.ok(recalculo < carta, 'el recalculo va antes de leer la carta');
});

test('d-17: al arrancar emite la disponibilidad de toda la carta', async () => {
  // Los avisos de mientras el backend estaba caido se perdieron, y el recalculo
  // no los repite: esta emision es la unica forma de que las mesas conectadas
  // vean la carta real sin esperar al proximo movimiento.
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  const notifier = notifierFalso();

  await avisos.iniciar({ crearCliente: () => cliente, notifier });

  assert.deepStrictEqual(notifier.enviados, [
    { ruta: 'ingrediente', id_ingrediente: 7, disponible: false, opciones: { conReintento: true } },
    { ruta: 'plato', id_plato: 12, disponible: true, opciones: { conReintento: true } },
    { ruta: 'plato', id_plato: 1001, disponible: false, opciones: { conReintento: true } },
  ]);
});

test('d-17: lo que se emite es disponible_efectivo, no el interruptor', async () => {
  // El plato 1001 esta apagado a mano (motivo 'manual') y con stock: lo que ve
  // el comensal es disponible AND stock_suficiente.
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  const notifier = notifierFalso();

  await avisos.iniciar({ crearCliente: () => cliente, notifier });

  const plato = notifier.enviados.find((x) => x.id_plato === 1001);
  assert.strictEqual(plato.disponible, false);
});

test('d-17: ponerLaCartaAlDia devuelve el resumen de lo que hizo', async () => {
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  const notifier = notifierFalso();

  const resumen = await avisos.ponerLaCartaAlDia(cliente, { notifier });

  assert.strictEqual(resumen.recalculados, 3);
  assert.strictEqual(resumen.emitidos, 3);
  assert.strictEqual(resumen.fallidos, 0);
  assert.strictEqual(resumen.pendientes, 0);
});

test('d-17: si el recalculo falla, la carta se emite igual', async () => {
  const cliente = clienteFalso({
    respuestas: {
      'fn_recalcular_toda_la_carta': () => {
        throw new Error('la funcion no existe todavia');
      },
      'v_carta_disponible': CARTA,
    },
  });
  const notifier = notifierFalso();

  const resumen = await avisos.ponerLaCartaAlDia(cliente, { notifier });

  assert.strictEqual(resumen.recalculados, null);
  assert.strictEqual(resumen.emitidos, 3, 'el estado guardado sigue sirviendo');
});

test('d-17: si no se puede leer la carta, no se cae nada', async () => {
  const cliente = clienteFalso({
    respuestas: {
      'fn_recalcular_toda_la_carta': { rows: [{ cambios: 0 }] },
      'v_carta_disponible': () => {
        throw new Error('la vista no existe');
      },
    },
  });
  const notifier = notifierFalso();

  const resumen = await avisos.ponerLaCartaAlDia(cliente, { notifier });

  assert.strictEqual(resumen.emitidos, 0);
  assert.deepStrictEqual(notifier.enviados, []);
});

test('d-17: con el socket-server caido y la cola con reintentos, la pasada para en el primer fallo y queda todo pendiente', async () => {
  // Cada envio gasta su timeout y los demas van a fallar igual: con el
  // servidor caido se hace UN intento por pasada y el resto espera en la cola
  // (ya no se descarta: se reintenta solo, ver tests/avisos-stock-cola.test.js).
  const { crearColaAvisos } = require('../src/services/avisos-stock-cola');
  const programados = [];
  const cola = crearColaAvisos({
    reintentos: true,
    programar: (fn, ms) => programados.push({ fn, ms }),
    cancelar: () => {},
    aleatorio: () => 0.5,
  });
  const muchos = { rows: [] };
  for (let id = 1; id <= 30; id += 1) {
    muchos.rows.push({ tipo: 'plato', id, disponible_efectivo: true, motivo: null });
  }
  const cliente = clienteFalso({
    respuestas: { 'fn_recalcular_toda_la_carta': { rows: [{ cambios: 0 }] }, 'v_carta_disponible': muchos },
  });
  const notifier = notifierFalso({ ok: false });

  const resumen = await avisos.ponerLaCartaAlDia(cliente, { notifier, cola });

  assert.strictEqual(notifier.enviados.length, 1, 'no se gasta un timeout por cada uno de los 30');
  assert.strictEqual(resumen.fallidos, 1);
  assert.strictEqual(resumen.pendientes, 30, 'nada se pierde: todo queda en la cola');
  assert.strictEqual(programados.length, 1, 'un solo reintento programado');
  cola.detener();
});

// ---------------------------------------------------------------------------
// El canal en marcha y la reconexion
// ---------------------------------------------------------------------------

test('d-17: un NOTIFY del canal se reenvia; uno de otro canal no', async () => {
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  const notifier = notifierFalso();
  await avisos.iniciar({ crearCliente: () => cliente, notifier });
  const yaEnviados = notifier.enviados.length;

  cliente.emitir('notification', {
    channel: 'inventario',
    payload: JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 55, disponible: false }),
  });
  cliente.emitir('notification', {
    channel: 'otro_canal',
    payload: JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 56, disponible: false }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const nuevos = notifier.enviados.slice(yaEnviados);
  assert.deepStrictEqual(nuevos.map((x) => x.id_plato), [55]);
});

test('d-17: la conexion del canal tiene manejador de error (si no, tumba el proceso)', async () => {
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  await avisos.iniciar({ crearCliente: () => cliente, notifier: notifierFalso() });

  assert.ok(cliente.tieneOyente('error'), 'un error sin oyente mata el proceso entero');
  // Y no lanza al recibirlo.
  cliente.emitir('error', new Error('la base se reinicio'));
});

test('d-17: si falla la conexion no se lanza y el backend sigue', async () => {
  const notifier = notifierFalso();

  await avisos.iniciar({ crearCliente: () => clienteFalso({ fallaConnect: true }), notifier });

  assert.deepStrictEqual(notifier.enviados, []);
  // Y el temporizador de reconexion queda cancelable: sin esto, el proceso de
  // las pruebas se quedaria vivo esperandolo.
  await avisos.detener();
});

test('d-17: si falla el LISTEN se cierra esa conexion y se reintenta', async () => {
  const cliente = clienteFalso({ fallaListen: true });

  await avisos.iniciar({ crearCliente: () => cliente, notifier: notifierFalso() });

  assert.strictEqual(cliente.terminado, true, 'no se deja una conexion a medias');
  await avisos.detener();
});

test('d-17: al caerse la conexion se reconecta y repite el arranque', async () => {
  const creados = [];
  const crearCliente = () => {
    const nuevo = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
    creados.push(nuevo);
    return nuevo;
  };
  const notifier = notifierFalso();

  await avisos.iniciar({ crearCliente, notifier });
  assert.strictEqual(creados.length, 1);

  // La base se reinicio: pg cierra la conexion.
  creados[0].emitir('end');
  // La reconexion es con espera creciente (1 s el primer intento), asi que aqui
  // solo se comprueba que quedo PROGRAMADA y que detener() la cancela: esperar
  // un segundo de reloj haria la suite lenta y fragil.
  await avisos.detener();

  assert.strictEqual(creados.length, 1, 'no reconecta de inmediato, espera');
});

test('d-17: detener() sin haber arrancado no falla', async () => {
  await avisos.detener();
  await avisos.detener();
});

test('d-17: iniciar() dos veces no abre dos canales', async () => {
  const creados = [];
  const crearCliente = () => {
    const nuevo = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
    creados.push(nuevo);
    return nuevo;
  };

  await avisos.iniciar({ crearCliente, notifier: notifierFalso() });
  await avisos.iniciar({ crearCliente, notifier: notifierFalso() });

  assert.strictEqual(creados.length, 1, 'hay UN canal por proceso');
});

test('d-17: detener() cierra la conexion del canal', async () => {
  const cliente = clienteFalso({ respuestas: RESPUESTAS_ARRANQUE });
  await avisos.iniciar({ crearCliente: () => cliente, notifier: notifierFalso() });

  await avisos.detener();

  assert.strictEqual(cliente.terminado, true);
});

test('d-17: aNumero convierte lo que debe y descarta lo demas', () => {
  assert.strictEqual(avisos.aNumero('450.50'), 450.5);
  assert.strictEqual(avisos.aNumero(450), 450);
  assert.strictEqual(avisos.aNumero(0), 0);
  assert.strictEqual(avisos.aNumero(null), null);
  assert.strictEqual(avisos.aNumero(undefined), null);
  assert.strictEqual(avisos.aNumero(''), null);
  assert.strictEqual(avisos.aNumero('  '), null);
  assert.strictEqual(avisos.aNumero('hola'), null);
  assert.strictEqual(avisos.aNumero(NaN), null);
  assert.strictEqual(avisos.aNumero(Infinity), null);
});

// ---------------------------------------------------------------------------
// El notificador: ruta, cuerpo y reintentos reales (EVENTS.md §5.5)
// ---------------------------------------------------------------------------

test('d-17: la alerta de inventario sale por /internal/inventario-alerta con eventId', async () => {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  try {
    const resultado = await socketNotifier.notificarInventarioAlerta({
      id_insumo: 12,
      nombre: 'Queso costeño',
      unidad: 'g',
      stock_actual: 450,
      stock_minimo: 500,
    });

    assert.strictEqual(resultado.ok, true);
    const aviso = socket.buscar('/internal/inventario-alerta');
    assert.ok(aviso, 'se envio a la ruta del contrato');
    assert.match(aviso.cuerpo.eventId, ES_UUID);
    assert.strictEqual(aviso.cabeceras['x-internal-key'], socket.clave);
    assert.deepStrictEqual(Object.keys(aviso.cuerpo).sort(), [
      'eventId', 'id_insumo', 'nombre', 'stock_actual', 'stock_minimo', 'unidad',
    ]);
  } finally {
    socket.restaurar();
  }
});

test('d-17: la alerta se reintenta con el MISMO eventId ante 503 ERROR_INTERNO', async () => {
  // Es la idempotencia de Roberto: deduplica por
  // backend:inventario-alerta:{eventId}, asi que repetir es seguro.
  let intentos = 0;
  const socket = instalarFakeSocket(() => {
    intentos += 1;
    return intentos === 1
      ? { __status: 503, codigo: 'ERROR_INTERNO' }
      : { ok: true, duplicado: false };
  });
  try {
    const resultado = await socketNotifier.notificarInventarioAlerta({
      id_insumo: 12, nombre: 'Queso', unidad: 'g', stock_actual: 0, stock_minimo: 500,
    });

    assert.strictEqual(resultado.ok, true);
    const enviados = socket.todos('/internal/inventario-alerta');
    assert.strictEqual(enviados.length, 2);
    assert.strictEqual(enviados[0].cuerpo.eventId, enviados[1].cuerpo.eventId);
  } finally {
    socket.restaurar();
  }
});

test('d-17: la alerta NO se reintenta ante 503 NO_CONFIGURADO', async () => {
  // No se arregla reintentando: solo triplicaria el ruido en el log.
  const socket = instalarFakeSocket(() => ({ __status: 503, codigo: 'NO_CONFIGURADO' }));
  try {
    const resultado = await socketNotifier.notificarInventarioAlerta({
      id_insumo: 12, nombre: 'Queso', unidad: 'g', stock_actual: 1, stock_minimo: 5,
    });

    assert.strictEqual(resultado.ok, false);
    assert.strictEqual(socket.todos('/internal/inventario-alerta').length, 1);
  } finally {
    socket.restaurar();
  }
});

test('d-17: con el socket-server caido la alerta no lanza', async () => {
  // El backend arranca y sirve igual si el socket-server no responde.
  const socket = socketCaido();
  try {
    const resultado = await socketNotifier.notificarInventarioAlerta({
      id_insumo: 12, nombre: 'Queso', unidad: 'g', stock_actual: 1, stock_minimo: 5,
    });

    assert.strictEqual(resultado.ok, false);
  } finally {
    socket.restaurar();
  }
});

test('d-17: la disponibilidad con conReintento reintenta; sin el, no', async () => {
  let intentos = 0;
  const socket = instalarFakeSocket(() => {
    intentos += 1;
    return { __status: 503, codigo: 'ERROR_INTERNO' };
  });
  try {
    await socketNotifier.notificarPlatoDisponibilidad(12, false);
    const sinReintento = intentos;
    assert.strictEqual(sinReintento, 1, 'las rutas del personal siguen con un solo intento');

    intentos = 0;
    await socketNotifier.notificarPlatoDisponibilidad(12, false, { conReintento: true });
    assert.strictEqual(intentos, socketNotifier.MAX_INTENTOS);
  } finally {
    socket.restaurar();
  }
});
