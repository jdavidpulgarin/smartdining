const test = require('node:test');
const assert = require('node:assert');
const { crearColaAvisos, clasificar, configuracionDelEntorno } = require('../src/services/avisos-stock-cola');
const avisos = require('../src/services/inventario-avisos');
const socketNotifier = require('../src/services/socket.notifier');
const { instalarFakeSocket, ES_UUID } = require('./helpers/fake-socket');

// Avisos de stock robustos (propuesta de Roberto, sigue de T5).
//
// La cola de services/avisos-stock-cola.js: reintenta ante errores de red y
// 5xx con espera creciente, el ultimo estado de cada clave gana, esta acotada,
// y la emision de la carta ya no se rinde. Todo con reloj falso (no se espera
// de verdad) y con el notificador REAL contra el socket-server doble, para ver
// los eventId y la clasificacion de errores tal como salen a la red.

const RUTA_PLATO = '/internal/plato-disponibilidad';

/** Reloj falso: guarda los temporizadores y los dispara a mano. */
function relojFalso() {
  const temporizadores = [];
  return {
    temporizadores,
    programar(fn, ms) {
      const t = { fn, ms, vivo: true };
      temporizadores.push(t);
      return t;
    },
    cancelar(t) {
      if (t) t.vivo = false;
    },
    vivos() {
      return temporizadores.filter((t) => t.vivo);
    },
    /** Dispara el temporizador vivo y espera la pasada que lanza. */
    async disparar(cola) {
      const t = temporizadores.find((x) => x.vivo);
      assert.ok(t, 'habia un reintento programado');
      t.vivo = false;
      t.fn();
      await cola.drenar();
      return t.ms;
    },
  };
}

function colaDePrueba(reloj, extra = {}) {
  return crearColaAvisos({
    reintentos: true,
    programar: reloj.programar,
    cancelar: reloj.cancelar,
    aleatorio: () => 0.5, // sin jitter: esperas exactas
    esperaInicialMs: 1000,
    esperaMaximaMs: 30000,
    ...extra,
  });
}

/** Un aviso de plato por el notificador real (eventId nuevo en cada llamada). */
const plato = (id, disponible) => () => socketNotifier.notificarPlatoDisponibilidad(id, disponible, { conReintento: true });

/** Error de red como el del fetch de Node: el codigo del sistema va en `cause`. */
function errorDeRed(code = 'ECONNREFUSED') {
  const err = new TypeError('fetch failed');
  err.cause = Object.assign(new Error(`connect ${code} 10.0.0.1:4001`), { code });
  return err;
}

/** Socket-server doble cuyo comportamiento se cambia a mitad de la prueba. */
function socketControlable() {
  const control = { modo: 'ok' };
  const socket = instalarFakeSocket(() => {
    if (control.modo === 'caido') return errorDeRed(control.code);
    if (typeof control.modo === 'number') return { __status: control.modo, codigo: 'X' };
    return { ok: true };
  });
  return { socket, control };
}

/** Captura console.error durante fn. */
async function conLogs(fn) {
  const original = console.error;
  const lineas = [];
  console.error = (...a) => lineas.push(a.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lineas.join('\n');
}

test.afterEach(() => {
  avisos.reiniciarEstado();
});

// ---------------------------------------------------------------------------
// Que se reintenta y que no
// ---------------------------------------------------------------------------

test('cola: clasifica red y 5xx como reintentables, 4xx como rechazo', () => {
  assert.strictEqual(clasificar({ ok: true }), 'ok');
  for (const motivo of ['INALCANZABLE', 'TIMEOUT', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'EXCEPCION']) {
    assert.strictEqual(clasificar({ ok: false, motivo }), 'reintentar', motivo);
  }
  assert.strictEqual(clasificar(undefined), 'reintentar');
  for (const motivo of ['HTTP_400', 'HTTP_401', 'HTTP_404', 'HTTP_409']) {
    assert.strictEqual(clasificar({ ok: false, motivo }), 'rechazado', motivo);
  }
  assert.strictEqual(clasificar({ ok: false, motivo: 'SIN_CONFIGURAR' }), 'apagado');
});

test('cola: espera 1 s, 2 s, 4 s... con tope de 30 s, y jitter de +-20 % sin pasar el tope', () => {
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  assert.deepStrictEqual(
    [1, 2, 3, 4, 5, 6, 7, 10].map((n) => cola.esperaDelReintento(n)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]
  );
  const bajo = colaDePrueba(reloj, { aleatorio: () => 0 });
  const alto = colaDePrueba(reloj, { aleatorio: () => 0.999999 });
  assert.strictEqual(bajo.esperaDelReintento(1), 800);
  assert.strictEqual(alto.esperaDelReintento(1), 1200);
  assert.strictEqual(alto.esperaDelReintento(9), 30000, 'el jitter no pasa el tope');
});

test('cola: error de RED (ECONNREFUSED) se reintenta con espera creciente hasta lograrlo', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    const logs = await conLogs(async () => {
      await cola.encolar('plato:5', plato(5, false));
      assert.strictEqual(await reloj.disparar(cola), 1000);
      assert.strictEqual(await reloj.disparar(cola), 2000);
      control.modo = 'ok';
      assert.strictEqual(await reloj.disparar(cola), 4000);
    });

    assert.strictEqual(socket.todos(RUTA_PLATO).length, 4);
    assert.deepStrictEqual(cola.estado().pendientes, []);
    assert.strictEqual(reloj.vivos().length, 0, 'logrado: no queda reintento');
    // El log lleva el codigo, no el mensaje del error.
    assert.match(logs, /aviso de stock \(INALCANZABLE\/ECONNREFUSED\); 1 pendientes, reintento en 1000 ms/);
  } finally {
    socket.restaurar();
  }
});

test('cola: ECONNRESET, ETIMEDOUT y EAI_AGAIN tambien se reintentan', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
    const { socket, control } = socketControlable();
    const reloj = relojFalso();
    const cola = colaDePrueba(reloj);
    try {
      control.modo = 'caido';
      control.code = code;
      const logs = await conLogs(() => cola.encolar('plato:5', plato(5, false)));
      assert.strictEqual(reloj.vivos().length, 1, code);
      assert.ok(logs.includes(`INALCANZABLE/${code}`), code);
    } finally {
      cola.detener();
      socket.restaurar();
    }
  }
});

test('cola: un TIMEOUT del notificador (socket-server colgado) se reintenta', async () => {
  let colgado = true;
  const socket = instalarFakeSocket(() => (colgado ? new Promise(() => {}) : { ok: true }));
  process.env.SOCKET_TIMEOUT_MS = '20';
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    const logs = await conLogs(() => cola.encolar('plato:5', plato(5, false)));
    assert.match(logs, /\(TIMEOUT\)/);
    assert.strictEqual(reloj.vivos().length, 1);

    colgado = false;
    await reloj.disparar(cola);
    assert.deepStrictEqual(cola.estado().pendientes, []);
  } finally {
    socket.restaurar();
  }
});

test('cola: un 500 se reintenta', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 500;
    await conLogs(() => cola.encolar('plato:5', plato(5, false)));
    assert.strictEqual(reloj.vivos().length, 1);
    control.modo = 'ok';
    await reloj.disparar(cola);
    assert.strictEqual(socket.todos(RUTA_PLATO).length, 2);
    assert.deepStrictEqual(cola.estado().pendientes, []);
  } finally {
    socket.restaurar();
  }
});

test('cola: un 4xx NO se reintenta: se registra y se descarta', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 400;
    const logs = await conLogs(() => cola.encolar('plato:5', plato(5, false)));

    assert.strictEqual(socket.todos(RUTA_PLATO).length, 1);
    assert.strictEqual(reloj.vivos().length, 0, 'sin reintento');
    assert.deepStrictEqual(cola.estado().pendientes, []);
    assert.strictEqual(cola.estado().rechazados, 1);
    assert.match(logs, /rechazo un aviso de stock \(HTTP_400\): no se reintenta/);
  } finally {
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El ultimo gana
// ---------------------------------------------------------------------------

test('cola: agotado falla, llega repuesto y sale bien -> el reintento NUNCA manda agotado', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(() => cola.encolar('plato:5', plato(5, false))); // agotado: falla
    assert.strictEqual(reloj.vivos().length, 1);

    control.modo = 'ok';
    await cola.encolar('plato:5', plato(5, true)); // repuesto: sale en el acto

    // El reintento del agotado quedo cancelado y no hay nada mas que mandar.
    assert.strictEqual(reloj.vivos().length, 0);
    assert.deepStrictEqual(cola.estado().pendientes, []);
    const valores = socket.todos(RUTA_PLATO).map((a) => a.cuerpo.disponible);
    assert.deepStrictEqual(valores, [false, true]);
    assert.strictEqual(valores[valores.length - 1], true, 'lo ultimo que recibe el socket-server es REPUESTO');
  } finally {
    socket.restaurar();
  }
});

test('cola: si el repuesto llega MIENTRAS el agotado esta en vuelo, al fallar este sale solo el repuesto', async () => {
  let soltar;
  let llamadas = 0;
  const socket = instalarFakeSocket(() => {
    llamadas += 1;
    if (llamadas === 1) return new Promise((resolver) => { soltar = () => resolver(errorDeRed()); });
    return { ok: true };
  });
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    await conLogs(async () => {
      const pasada = cola.encolar('plato:5', plato(5, false));
      await new Promise((r) => setImmediate(r));
      cola.encolar('plato:5', plato(5, true)); // llega con el agotado en vuelo
      soltar();
      await pasada;
    });
    // La pasada se paro en el fallo: el repuesto espera al reintento.
    await reloj.disparar(cola);

    const valores = socket.todos(RUTA_PLATO).map((a) => a.cuerpo.disponible);
    assert.deepStrictEqual(valores, [false, true], 'el agotado no se repite');
    assert.deepStrictEqual(cola.estado().pendientes, []);
  } finally {
    socket.restaurar();
  }
});

test('cola: dos avisos de la misma clave con el socket caido -> al volver sale SOLO el ultimo, con un eventId nuevo', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(async () => {
      await cola.encolar('plato:5', plato(5, false));
      await cola.encolar('plato:5', plato(5, true));
    });
    assert.deepStrictEqual(cola.estado().pendientes, ['plato:5'], 'una sola entrada por clave');
    const fallidos = socket.todos(RUTA_PLATO).length;

    control.modo = 'ok';
    await reloj.disparar(cola);

    const todos = socket.todos(RUTA_PLATO);
    const alVolver = todos.slice(fallidos);
    assert.strictEqual(alVolver.length, 1, 'un solo envio al volver');
    assert.strictEqual(alVolver[0].cuerpo.disponible, true, 'el ultimo estado');
    assert.match(alVolver[0].cuerpo.eventId, ES_UUID);
    const ids = todos.map((a) => a.cuerpo.eventId);
    assert.strictEqual(new Set(ids).size, ids.length, 'cada intento con un eventId NUEVO');
  } finally {
    socket.restaurar();
  }
});

test('cola: al volver el socket-server se vacia la cola entera en una pasada', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(async () => {
      for (const id of [1, 2, 3]) await cola.encolar(`plato:${id}`, plato(id, false));
    });
    const antes = socket.todos(RUTA_PLATO).length;

    control.modo = 'ok';
    let logs = '';
    const original = console.log;
    console.log = (...a) => { logs += a.join(' '); };
    try {
      await reloj.disparar(cola);
    } finally {
      console.log = original;
    }

    assert.deepStrictEqual(socket.todos(RUTA_PLATO).slice(antes).map((a) => a.cuerpo.id_plato), [1, 2, 3]);
    assert.deepStrictEqual(cola.estado().pendientes, []);
    assert.match(logs, /el socket-server volvio: se emiten 2 avisos de stock pendientes/);
  } finally {
    socket.restaurar();
  }
});

test('cola: con el socket-server caido, cada pasada hace UN intento (no uno por clave)', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(async () => {
      for (const id of [1, 2, 3, 4]) cola.encolar(`plato:${id}`, plato(id, false));
      await cola.drenar();
      const tras1 = socket.todos(RUTA_PLATO).length;
      await reloj.disparar(cola);
      assert.strictEqual(socket.todos(RUTA_PLATO).length, tras1 + 1);
    });
    assert.strictEqual(cola.estado().pendientes.length, 4);
  } finally {
    cola.detener();
    socket.restaurar();
  }
});

test('cola: nunca dos envios ni dos reintentos a la vez', async () => {
  let enCurso = 0;
  let maximo = 0;
  const socket = instalarFakeSocket(async () => {
    enCurso += 1;
    maximo = Math.max(maximo, enCurso);
    await new Promise((r) => setImmediate(r));
    enCurso -= 1;
    return { ok: true };
  });
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    const pasadas = [1, 2, 3, 4, 5].map((id) => cola.encolar(`plato:${id}`, plato(id, true)));
    await Promise.all(pasadas);
    assert.strictEqual(maximo, 1);
    assert.strictEqual(socket.todos(RUTA_PLATO).length, 5);
  } finally {
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

test('cola: llena, descarta lo mas viejo y lo registra', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj, { maxClaves: 3 });
  try {
    control.modo = 'caido';
    const logs = await conLogs(async () => {
      for (const id of [1, 2, 3, 4]) await cola.encolar(`plato:${id}`, plato(id, false));
    });
    assert.deepStrictEqual(cola.estado().pendientes, ['plato:2', 'plato:3', 'plato:4']);
    assert.strictEqual(cola.estado().descartadosPorLimite, 1);
    assert.match(logs, /cola de avisos de stock llena \(3\): se descarta el mas viejo \(1 descartados en total\)/);

    control.modo = 'ok';
    const antes = socket.todos(RUTA_PLATO).length;
    await reloj.disparar(cola);
    assert.deepStrictEqual(socket.todos(RUTA_PLATO).slice(antes).map((a) => a.cuerpo.id_plato), [2, 3, 4]);
  } finally {
    socket.restaurar();
  }
});

test('cola: una clave que se actualiza pasa al final (lo mas viejo es lo que lleva mas sin cambiar)', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj, { maxClaves: 2 });
  try {
    control.modo = 'caido';
    await conLogs(async () => {
      await cola.encolar('plato:1', plato(1, false));
      await cola.encolar('plato:2', plato(2, false));
      await cola.encolar('plato:1', plato(1, true));
      await cola.encolar('plato:3', plato(3, false));
    });
    assert.deepStrictEqual(cola.estado().pendientes, ['plato:1', 'plato:3']);
  } finally {
    cola.detener();
    socket.restaurar();
  }
});

test('cola: la configuracion sale de .env y descarta valores raros', () => {
  assert.deepStrictEqual(configuracionDelEntorno({}), { esperaInicialMs: 1000, esperaMaximaMs: 30000, maxClaves: 500 });
  assert.deepStrictEqual(
    configuracionDelEntorno({ AVISOS_STOCK_REINTENTO_INICIAL_MS: '500', AVISOS_STOCK_REINTENTO_MAX_MS: '10000', AVISOS_STOCK_COLA_MAX: '50' }),
    { esperaInicialMs: 500, esperaMaximaMs: 10000, maxClaves: 50 }
  );
  assert.deepStrictEqual(
    configuracionDelEntorno({ AVISOS_STOCK_REINTENTO_MAX_MS: '-1', AVISOS_STOCK_COLA_MAX: 'muchas' }),
    { esperaInicialMs: 1000, esperaMaximaMs: 30000, maxClaves: 500 }
  );
  assert.strictEqual(
    configuracionDelEntorno({ AVISOS_STOCK_REINTENTO_INICIAL_MS: '5000', AVISOS_STOCK_REINTENTO_MAX_MS: '100' }).esperaMaximaMs,
    5000,
    'el tope nunca queda por debajo de la espera inicial'
  );
});

// ---------------------------------------------------------------------------
// Sin activar no hay reintentos (las pruebas no dejan temporizadores)
// ---------------------------------------------------------------------------

test('cola: sin activar, un fallo se intenta UNA vez y no programa nada', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = crearColaAvisos({ programar: reloj.programar, cancelar: reloj.cancelar });
  try {
    control.modo = 'caido';
    await conLogs(() => cola.encolar('plato:5', plato(5, false)));
    assert.strictEqual(reloj.temporizadores.length, 0);
    assert.deepStrictEqual(cola.estado().pendientes, []);
  } finally {
    socket.restaurar();
  }
});

test('cola: manejarAviso sin iniciar() no deja reintentos de fondo', async () => {
  const { socket, control } = socketControlable();
  try {
    control.modo = 'caido';
    await conLogs(() =>
      avisos.manejarAviso(JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 5, disponible: false }))
    );
    const estado = avisos.estadoDeLaCola();
    assert.strictEqual(estado.reintentos, false);
    assert.strictEqual(estado.esperando, false);
    assert.deepStrictEqual(estado.pendientes, []);
  } finally {
    socket.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La emision de la carta al arrancar
// ---------------------------------------------------------------------------

/** Cliente de pg doble con una carta de tres entradas. */
function clienteConCarta() {
  return {
    on() {},
    async connect() {},
    async query(sql) {
      if (sql.includes('fn_recalcular_toda_la_carta')) return { rows: [{ cambios: 0 }] };
      if (sql.includes('v_carta_disponible')) {
        return {
          rows: [
            { tipo: 'ingrediente', id: 7, disponible_efectivo: false },
            { tipo: 'plato', id: 12, disponible_efectivo: true },
            { tipo: 'plato', id: 13, disponible_efectivo: false },
          ],
        };
      }
      return { rows: [] };
    },
    async end() {},
  };
}

test('cola: la emision inicial de la carta reintenta MAS de 5 veces y termina al lograrlo', async () => {
  let llamadas = 0;
  const socket = instalarFakeSocket(() => {
    llamadas += 1;
    return llamadas <= 8 ? errorDeRed() : { ok: true };
  });
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    await conLogs(async () => {
      await avisos.iniciar({ crearCliente: clienteConCarta, cola });
      let disparos = 0;
      while (reloj.vivos().length > 0) {
        await reloj.disparar(cola);
        disparos += 1;
        assert.ok(disparos < 50, 'no se queda en bucle');
      }
      assert.strictEqual(disparos, 8, 'ocho reintentos: ya no se rinde a los 5');
    });

    const exitos = socket.avisos.slice(8);
    assert.deepStrictEqual(
      exitos.map((a) => [a.ruta, a.cuerpo.id_plato ?? a.cuerpo.id_ingrediente, a.cuerpo.disponible]),
      [
        ['/internal/ingrediente-disponibilidad', 7, false],
        [RUTA_PLATO, 12, true],
        [RUTA_PLATO, 13, false],
      ]
    );
    assert.deepStrictEqual(cola.estado().pendientes, []);
    assert.strictEqual(reloj.vivos().length, 0, 'termino: no queda temporizador');
    // Las esperas crecen y se quedan en el tope.
    assert.deepStrictEqual(reloj.temporizadores.map((t) => t.ms), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  } finally {
    await avisos.detener();
    socket.restaurar();
  }
});

test('cola: un aviso del canal mientras la carta reintenta se junta con ella (el ultimo gana)', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(async () => {
      await avisos.iniciar({ crearCliente: clienteConCarta, cola });
      // Mientras tanto, el plato 13 se repone.
      await avisos.manejarAviso(JSON.stringify({ tipo: 'disponibilidad', entidad: 'plato', id: 13, disponible: true }), { cola });
    });
    assert.deepStrictEqual(cola.estado().pendientes, ['ingrediente:7', 'plato:12', 'plato:13']);

    control.modo = 'ok';
    const antes = socket.avisos.length;
    await reloj.disparar(cola);
    const plato13 = socket.avisos.slice(antes).filter((a) => a.cuerpo.id_plato === 13);
    assert.deepStrictEqual(plato13.map((a) => a.cuerpo.disponible), [true], 'una vez, y repuesto');
  } finally {
    await avisos.detener();
    socket.restaurar();
  }
});

test('cola: detener() para los reintentos de la carta (sin temporizador ni pendientes)', async () => {
  const { socket, control } = socketControlable();
  const reloj = relojFalso();
  const cola = colaDePrueba(reloj);
  try {
    control.modo = 'caido';
    await conLogs(() => avisos.iniciar({ crearCliente: clienteConCarta, cola }));
    assert.strictEqual(reloj.vivos().length, 1);

    await avisos.detener();

    assert.strictEqual(reloj.vivos().length, 0, 'el reintento quedo cancelado');
    const estado = cola.estado();
    assert.strictEqual(estado.reintentos, false);
    assert.deepStrictEqual(estado.pendientes, []);
    const enviados = socket.avisos.length;
    // Aunque llegara un aviso tarde, ya no se programa nada.
    await conLogs(() => cola.encolar('plato:1', plato(1, true)));
    assert.strictEqual(reloj.vivos().length, 0);
    assert.strictEqual(socket.avisos.length, enviados + 1, 'un intento suelto, sin reintento');
  } finally {
    socket.restaurar();
  }
});

test('cola: el temporizador real lleva unref() (no retiene el proceso)', async () => {
  const { socket, control } = socketControlable();
  const cola = crearColaAvisos({ reintentos: true });
  const original = global.setTimeout;
  let conUnref = false;
  global.setTimeout = (fn, ms) => {
    const t = original(fn, ms);
    const unrefOriginal = t.unref.bind(t);
    t.unref = () => {
      conUnref = true;
      return unrefOriginal();
    };
    return t;
  };
  try {
    control.modo = 'caido';
    await conLogs(() => cola.encolar('plato:5', plato(5, false)));
  } finally {
    global.setTimeout = original;
    cola.detener();
    socket.restaurar();
  }
  assert.strictEqual(conUnref, true);
});
