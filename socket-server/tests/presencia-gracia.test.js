const test = require('node:test');
const assert = require('node:assert');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, ENV_BASE, ORIGEN,
} = require('./helpers');
const { cargarConfig } = require('../src/config');
const { PRESENCIA_GRACIA_POR_DEFECTO_MS } = require('../src/sala');

// Gracia de presencia (EVENTS.md §5.2): un comensal cuyo socket se cae por la
// red sigue sentado PRESENCIA_GRACIA_MS. Reloj falso: los temporizadores de
// gracia no corren solos, la prueba decide cuándo vencen (sin esperas reales).

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const recolectar = (socket) => {
  const lista = [];
  socket.on('mesa:presencia', (p) => lista.push(p));
  return lista;
};

function crearRelojFalso() {
  const pendientes = [];
  return {
    pendientes,
    programarGracia(fn, ms) {
      const h = { fn, ms, cancelado: false, vencido: false };
      pendientes.push(h);
      return h;
    },
    cancelarGracia(h) { h.cancelado = true; },
    /** Vence todas las gracias vivas, como si pasara el tiempo. */
    vencer() {
      for (const h of pendientes) {
        if (h.cancelado || h.vencido) continue;
        h.vencido = true;
        h.fn();
      }
    },
    vivas: () => pendientes.filter((h) => !h.cancelado && !h.vencido).length,
  };
}

async function escenario(t, { graciaMs = 60000 } = {}) {
  const reloj = crearRelojFalso();
  const s = await levantar({ PRESENCIA_GRACIA_MS: String(graciaMs) }, {
    presencia: {
      ventanaMs: 20, programarGracia: reloj.programarGracia, cancelarGracia: reloj.cancelarGracia,
    },
  });
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('admin'));
  return { s, admin, reloj };
}

// Corte de red: se cierra el transporte sin despedirse ('transport close' en
// el servidor), como un celular que pasa a segundo plano.
const cortarRed = (socket) => socket.io.engine.close();

async function sentar(s, mesa, alias, extra) {
  const c = await s.conectar(tokenComensal(mesa, alias, extra));
  const r = await emitir(c, 'join:table', {});
  assert.strictEqual(r.ok, true);
  return c;
}

/** Espera a que el servidor procese la desconexión (disconnect es asíncrono). */
async function hastaQue(cond, ms = 1000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await pausa(10);
  }
  assert.fail('la condición no se cumplió a tiempo');
}

test('se cae y vuelve ANTES de la gracia: el panel no recibe ni la salida ni la entrada', async (t) => {
  const { s, admin, reloj } = await escenario(t);
  await sentar(s, 5, 'Beto');
  const ana = await sentar(s, 5, 'Ana');
  await pausa(60); // pasa la ventana de los join
  const avisos = recolectar(admin);

  cortarRed(ana);
  await hastaQue(() => s.presencia.enGracia(5).length === 1);
  assert.deepStrictEqual(s.presencia.enGracia(5), ['Ana']);
  // Sigue contando para todos (rotación del QR, panel, PWA).
  const enGracia = await s.presencia.calcular(5);
  assert.deepStrictEqual(enGracia.comensales, ['Ana', 'Beto']);
  assert.strictEqual(enGracia.total, 2);

  // Vuelve con un socket nuevo y el mismo JWT.
  await sentar(s, 5, 'Ana');
  assert.deepStrictEqual(s.presencia.enGracia(5), []);
  reloj.vencer(); // su temporizador ya estaba cancelado: no hace nada
  await pausa(80);
  assert.deepStrictEqual(avisos, [], 'para el panel, Ana nunca se fue');
});

test('vuelve DESPUÉS de la gracia: sale al vencer y entra de nuevo al volver', async (t) => {
  const { s, admin, reloj } = await escenario(t);
  const ana = await sentar(s, 6, 'Ana');
  await pausa(60);
  const avisos = recolectar(admin);

  cortarRed(ana);
  await hastaQue(() => reloj.vivas() === 1);
  await pausa(40);
  assert.strictEqual(avisos.length, 0, 'al caerse no se avisa nada');
  assert.strictEqual(reloj.pendientes[0].ms, 60000);

  const salida = esperar(admin, 'mesa:presencia');
  reloj.vencer();
  assert.deepStrictEqual(await salida, {
    id_mesa: 6, comensales: [], total: 0, pagaron: [], sin_celular: [],
  });

  await pausa(40); // fuera de la ventana de 20 ms
  const entrada = esperar(admin, 'mesa:presencia');
  await sentar(s, 6, 'Ana');
  assert.deepStrictEqual((await entrada).comensales, ['Ana']);
});

test('dos pestañas del mismo comensal: cerrar una no cambia nada; cerrar las dos abre UNA gracia', async (t) => {
  const { s, admin, reloj } = await escenario(t);
  const pestana1 = await sentar(s, 7, 'Ana');
  const pestana2 = await sentar(s, 7, 'Ana');
  await pausa(60);
  const avisos = recolectar(admin);

  cortarRed(pestana1);
  await pausa(80);
  assert.strictEqual(reloj.vivas(), 0, 'la otra pestaña sigue en la sala: no hay gracia');
  assert.deepStrictEqual((await s.presencia.calcular(7)).comensales, ['Ana']);

  cortarRed(pestana2);
  await hastaQue(() => reloj.vivas() === 1);
  assert.deepStrictEqual(avisos, []);

  const salida = esperar(admin, 'mesa:presencia');
  reloj.vencer();
  assert.deepStrictEqual((await salida).comensales, []);
});

test('liberar la mesa cancela sus gracias y no pasan a la sesión siguiente', async (t) => {
  const { s, admin, reloj } = await escenario(t);
  const ana = await sentar(s, 8, 'Ana');
  const beto = await sentar(s, 8, 'Beto');
  const otraMesa = await sentar(s, 9, 'Zoe');
  cortarRed(ana);
  cortarRed(beto);
  cortarRed(otraMesa);
  await hastaQue(() => reloj.vivas() === 3);

  await s.ctx.liberarMesa(8, 'pagada');
  assert.deepStrictEqual(s.presencia.enGracia(8), []);
  assert.deepStrictEqual(s.presencia.enGracia(9), ['Zoe'], 'las gracias de otra mesa siguen');
  assert.strictEqual(reloj.vivas(), 1);

  // Grupo siguiente: JWT emitido después de la liberación.
  s.ctx.reabrirMesa(8);
  await pausa(40);
  const presencia = esperar(admin, 'mesa:presencia');
  await sentar(s, 8, 'Carla', { iat: Math.floor(Date.now() / 1000) + 2 });
  assert.deepStrictEqual((await presencia).comensales, ['Carla']);

  reloj.vencer(); // solo vence la de Zoe (mesa 9)
  await pausa(60);
  assert.deepStrictEqual((await s.presencia.calcular(8)).comensales, ['Carla']);
});

test('una salida a propósito (disconnect del cliente) avisa al instante, sin gracia', async (t) => {
  const { s, admin, reloj } = await escenario(t);
  const ana = await sentar(s, 10, 'Ana');
  await pausa(60);
  const salida = esperar(admin, 'mesa:presencia');
  ana.disconnect();
  assert.deepStrictEqual((await salida).comensales, []);
  assert.strictEqual(reloj.vivas(), 0);
});

test('durante la gracia la mesa no rota el QR y sigue en la lista del panel', async (t) => {
  const llamadas = [];
  const reloj = crearRelojFalso();
  const s = await levantar({}, {
    presencia: { ventanaMs: 20, programarGracia: reloj.programarGracia, cancelarGracia: reloj.cancelarGracia },
    backend: {
      post: async (ruta) => { llamadas.push(ruta); return { ok: true, status: 200 }; },
      get: async () => ({ ok: false, status: 503 }), // capacidad: la del config
    },
    rotacion: { programar: () => null, cancelar: () => {} },
  });
  t.after(() => s.cerrar());
  const ana = await sentar(s, 11, 'Ana');
  cortarRed(ana);
  await hastaQue(() => reloj.vivas() === 1);

  // Mesa sin ningún socket: solo Ana en gracia. El rotador la ve ocupada.
  s.rotador.abrir(11, 'token-vigente');
  await s.rotador.ciclo(11);
  assert.deepStrictEqual(llamadas, [], 'no se pide rotar al backend');
  assert.strictEqual(s.rotador.activa(11), false, 'el QR queda fijo');

  const admin = await s.conectar(tokenPersonal('mesero'));
  const r = await emitir(admin, 'mesa:presencia:solicitar', {});
  assert.deepStrictEqual(r.mesas.find((m) => m.id_mesa === 11).comensales, ['Ana']);
});

test('PRESENCIA_GRACIA_MS=0: sin gracia, la caída avisa al instante como antes', async (t) => {
  const { s, admin, reloj } = await escenario(t, { graciaMs: 0 });
  const ana = await sentar(s, 12, 'Ana');
  await pausa(60);
  const salida = esperar(admin, 'mesa:presencia');
  cortarRed(ana);
  assert.deepStrictEqual((await salida).comensales, []);
  assert.strictEqual(reloj.pendientes.length, 0);
});

test('PRESENCIA_GRACIA_MS: 60000 por defecto, entero de 0 a 600000; otro valor no arranca', () => {
  assert.strictEqual(PRESENCIA_GRACIA_POR_DEFECTO_MS, 60000);
  const config = (v) => cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE, ...(v === undefined ? {} : { PRESENCIA_GRACIA_MS: v }) });
  assert.strictEqual(config(undefined).presenciaGraciaMs, 60000);
  assert.strictEqual(config('').presenciaGraciaMs, 60000);
  assert.strictEqual(config('0').presenciaGraciaMs, 0);
  assert.strictEqual(config('600000').presenciaGraciaMs, 600000);
  for (const malo of ['-1', '600001', '1.5', 'abc', '1e3x']) {
    assert.throws(() => config(malo), /PRESENCIA_GRACIA_MS/, `debe rechazar ${malo}`);
  }
});
