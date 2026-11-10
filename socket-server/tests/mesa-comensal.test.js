// POST /internal/mesa-comensal y mesa:presencia.sin_celular (EVENTS.md §6.4 y §5.2).
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { MAX_SIN_CELULAR } = require('../src/mesa-comensal');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');

const silencioso = { info() {}, error() {} };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const VENTANA_MS = 50;
const ALMACENES = {
  memoria: () => ({ falso: null, deps: {} }),
  redis: () => {
    const falso = crearRedisFalso();
    return { falso, deps: { redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso }) } };
  },
};

const post = (s, ruta, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});
const aviso = (alias, accion = 'agregar', extra = {}) => ({
  id_mesa: 5, alias, accion, eventId: randomUUID(), ...extra,
});
const llamar = async (s, cuerpo, clave) => {
  const r = await post(s, '/internal/mesa-comensal', cuerpo, clave);
  return { status: r.status, cuerpo: await r.json() };
};
const OK = { status: 200, cuerpo: { ok: true, duplicado: false } };
const error = (status, codigo) => ({ status, codigo });
const comoError = (r) => ({ status: r.status, codigo: r.cuerpo.codigo });

/** Admin conectado y "Ana" con celular en la mesa 5; la ventana de presencia ya cerrada. */
async function escenario(t, almacen, { extraEnv = {}, deps: extraDeps = {} } = {}) {
  const { falso, deps } = ALMACENES[almacen]();
  const s = await levantar(extraEnv, { ...deps, presencia: { ventanaMs: VENTANA_MS }, ...extraDeps });
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('mesero'));
  const ana = await s.conectar(tokenComensal(5, 'Ana'));
  await emitir(ana, 'join:table', {});
  await pausa(VENTANA_MS * 3);
  return { s, falso, admin, ana };
}

/** Espera la próxima mesa:presencia de la mesa 5 que llegue al socket. */
const presencia = (socket, ms = 800) => esperar(socket, 'mesa:presencia', ms);
// Sin cambio no hay aviso: se espera más que la ventana para estar seguros.
const nadaDePresencia = (socket) => esperar(socket, 'mesa:presencia', VENTANA_MS * 6);

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] agregar: 200, presencia con la unión y total; llega a la mesa y al panel`, async (t) => {
    const { s, falso, admin, ana } = await escenario(t, almacen);
    const enPanel = presencia(admin);
    const enMesa = presencia(ana);
    assert.deepStrictEqual(await llamar(s, aviso('  Abuela ', 'agregar', { extra: 'x', comensal: 'Otro' })), OK);
    const esperado = {
      id_mesa: 5, comensales: ['Abuela', 'Ana'], total: 2, pagaron: [], sin_celular: ['Abuela'],
    };
    assert.deepStrictEqual(await enPanel, esperado);
    assert.deepStrictEqual(await enMesa, esperado);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), { abuela: 'Abuela' }, 'se guarda la forma normalizada');
    if (falso) assert.ok(falso.llaves().includes('sd:mesa:5:sin_celular'));
    // La rotación del QR y «igual» leen total/comensales de aquí.
    assert.strictEqual((await s.presencia.calcular(5)).total, 2);
  });

  test(`[${almacen}] agregar el mismo alias otra vez: 200 sin cambio y sin emitir`, async (t) => {
    const { s, admin } = await escenario(t, almacen);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    await pausa(VENTANA_MS * 3);
    const nada = nadaDePresencia(admin);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    assert.strictEqual(await nada, null);
  });

  test(`[${almacen}] ALIAS_EN_USO por clave: contra un conectado y contra otro sin celular; no consume el eventId`, async (t) => {
    const { s, admin } = await escenario(t, almacen);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    await pausa(VENTANA_MS * 3);
    const nada = nadaDePresencia(admin);
    const eventId = randomUUID();
    for (const alias of ['ana', 'Ána', 'A-na', 'abuela', 'ABUELA', 'Abue la']) {
      assert.deepStrictEqual(comoError(await llamar(s, aviso(alias, 'agregar', { eventId }))), error(409, 'ALIAS_EN_USO'), alias);
    }
    assert.strictEqual(await nada, null);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), { abuela: 'Abuela' });
    assert.deepStrictEqual(await llamar(s, aviso('Beto', 'agregar', { eventId })), OK, 'el 409 no consumió el eventId');
  });

  test(`[${almacen}] quitar por clave: "abuela" quita a "Abuela"; quitar a quien no está es 200 sin emitir`, async (t) => {
    const { s, admin } = await escenario(t, almacen);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    await pausa(VENTANA_MS * 3);
    const llega = presencia(admin);
    assert.deepStrictEqual(await llamar(s, aviso('abuela', 'quitar')), OK);
    assert.deepStrictEqual(await llega, {
      id_mesa: 5, comensales: ['Ana'], total: 1, pagaron: [], sin_celular: [],
    });
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {});
    await pausa(VENTANA_MS * 3);
    const nada = nadaDePresencia(admin);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela', 'quitar')), OK);
    assert.deepStrictEqual(await llamar(s, aviso('Ana', 'quitar')), OK, 'quitar no toca a un conectado');
    assert.strictEqual(await nada, null);
  });

  test(`[${almacen}] límite de ${MAX_SIN_CELULAR} sin celular: el siguiente es 409 LIMITE_COMENSALES`, async (t) => {
    const { s } = await escenario(t, almacen);
    const nombres = Array.from({ length: MAX_SIN_CELULAR + 1 }, (_, i) => `Persona ${String.fromCharCode(65 + i)}`);
    for (const n of nombres.slice(0, MAX_SIN_CELULAR)) assert.deepStrictEqual(await llamar(s, aviso(n)), OK, n);
    assert.deepStrictEqual(comoError(await llamar(s, aviso(nombres[MAX_SIN_CELULAR]))), error(409, 'LIMITE_COMENSALES'));
    assert.strictEqual(Object.keys(await s.estadoMesas.sinCelular(5)).length, MAX_SIN_CELULAR);
    // Uno que ya está sigue respondiendo "sin cambio", no el límite.
    assert.deepStrictEqual(await llamar(s, aviso(nombres[0])), OK);
    // Otra mesa tiene su propio límite.
    assert.deepStrictEqual(await llamar(s, aviso('Persona Z', 'agregar', { id_mesa: 6 })), OK);
  });

  test(`[${almacen}] mesa liberada sin QR nuevo: 409 MESA_LIBERADA al agregar y al quitar; liberar borra sin_celular`, async (t) => {
    const { s, falso } = await escenario(t, almacen);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    assert.strictEqual((await post(s, '/internal/mesa-liberada', { id_mesa: 5 })).status, 200);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {}, 'liberar la mesa borra sin_celular');
    if (falso) assert.ok(!falso.llaves().includes('sd:mesa:5:sin_celular'));
    const eventId = randomUUID();
    assert.deepStrictEqual(comoError(await llamar(s, aviso('Abuela', 'agregar', { eventId }))), error(409, 'MESA_LIBERADA'));
    assert.deepStrictEqual(comoError(await llamar(s, aviso('Abuela', 'quitar'))), error(409, 'MESA_LIBERADA'));
    // QR nuevo = sesión nueva: vuelve a aceptar, y el 409 no consumió el eventId.
    const qr = await fetch(`${s.url}/qr/generar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPersonal('mesero')}` },
      body: JSON.stringify({ id_mesa: 5 }),
    });
    assert.strictEqual(qr.status, 201);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela', 'agregar', { eventId })), OK);
  });

  test(`[${almacen}] duplicado: el mismo eventId responde duplicado:true y no se reaplica ni reemite`, async (t) => {
    const { s, admin } = await escenario(t, almacen);
    const primero = aviso('Abuela');
    assert.deepStrictEqual(await llamar(s, primero), OK);
    const quitar = aviso('Abuela', 'quitar');
    assert.deepStrictEqual(await llamar(s, quitar), OK);
    await pausa(VENTANA_MS * 3);
    const nada = nadaDePresencia(admin);
    assert.deepStrictEqual(await llamar(s, primero), { status: 200, cuerpo: { ok: true, duplicado: true } });
    assert.deepStrictEqual(await llamar(s, quitar), { status: 200, cuerpo: { ok: true, duplicado: true } });
    assert.strictEqual(await nada, null);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {}, 'el agregar viejo no la volvió a sentar');
  });

  test(`[${almacen}] si falla guardar: 500 ERROR_INTERNO, se libera el eventId y el reintento aplica`, async (t) => {
    const { s, falso, admin } = await escenario(t, almacen);
    if (falso) {
      falso.fallarUnaVez((nombre) => nombre === 'hSetNX');
    } else {
      const original = s.estadoMesas.agregarSinCelular;
      s.estadoMesas.agregarSinCelular = async () => { s.estadoMesas.agregarSinCelular = original; throw new Error('falla simulada'); };
    }
    const cuerpo = aviso('Abuela');
    const nada = nadaDePresencia(admin);
    assert.deepStrictEqual(comoError(await llamar(s, cuerpo)), error(500, 'ERROR_INTERNO'));
    assert.strictEqual(await nada, null);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {});
    const llega = presencia(admin);
    assert.deepStrictEqual(await llamar(s, cuerpo), OK, 'mismo eventId: se aplica');
    assert.deepStrictEqual((await llega).sin_celular, ['Abuela']);
  });

  test(`[${almacen}] errores 400/401: no emiten, no cambian nada y no consumen el eventId`, async (t) => {
    const { s, admin } = await escenario(t, almacen);
    const eventId = randomUUID();
    const nada = nadaDePresencia(admin);
    const con = (cambio) => ({ ...aviso('Abuela', 'agregar', { eventId }), ...cambio });
    const sin = (campo) => { const c = con({}); delete c[campo]; return c; };
    const invalidos = [
      con({ id_mesa: '5' }), con({ id_mesa: 0 }), con({ id_mesa: -1 }), con({ id_mesa: 1.5 }), con({ id_mesa: 2 ** 53 }), sin('id_mesa'),
      con({ alias: 'A' }), con({ alias: 'a'.repeat(41) }), con({ alias: 'Ana 😀' }), con({ alias: 'Ana<b>' }), con({ alias: '..' }),
      con({ alias: 'General' }), con({ alias: ' general ' }), con({ alias: 12 }), con({ alias: null }), sin('alias'),
      con({ accion: 'AGREGAR' }), con({ accion: 'borrar' }), con({ accion: '' }), con({ accion: ['agregar'] }), sin('accion'),
      con({ eventId: 'x' }), con({ eventId: null }), sin('eventId'),
    ];
    for (const c of invalidos) {
      assert.deepStrictEqual(comoError(await llamar(s, c)), error(400, 'PAYLOAD_INVALIDO'), JSON.stringify(c));
    }
    for (const c of ['{"id_mesa":', '[1]', '"x"', 'null']) {
      assert.deepStrictEqual(comoError(await llamar(s, c)), error(400, 'JSON_INVALIDO'), c);
    }
    for (const clave of [null, 'otra']) {
      assert.deepStrictEqual(comoError(await llamar(s, con({}), clave)), error(401, 'NO_AUTORIZADO'));
    }
    assert.strictEqual(await nada, null);
    assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {});
    assert.deepStrictEqual(await llamar(s, con({})), OK, 'ningún 4xx consumió el eventId');
  });
}

test('sin INTERNAL_API_KEY configurada: 503 NO_CONFIGURADO', async (t) => {
  const { s } = await escenario(t, 'memoria');
  // El arranque exige la clave (secretos.js): se quita del config ya cargado.
  s.config.internalApiKey = undefined;
  assert.deepStrictEqual(comoError(await llamar(s, aviso('Abuela'))), error(503, 'NO_CONFIGURADO'));
  assert.deepStrictEqual(await s.estadoMesas.sinCelular(5), {});
});

test('con Redis caído: 500 ERROR_INTERNO; al volver, el mismo eventId aplica', async (t) => {
  const { s, falso } = await escenario(t, 'redis');
  const cuerpo = aviso('Abuela');
  falso.caer();
  assert.deepStrictEqual(comoError(await llamar(s, cuerpo)), error(500, 'ERROR_INTERNO'));
  falso.levantar();
  assert.deepStrictEqual(await llamar(s, cuerpo), OK);
});

test('mesa solo con sin celular: total 1 (el QR deja de rotar) y comensales con su alias', async (t) => {
  const { s } = await escenario(t, 'memoria');
  assert.deepStrictEqual(await llamar(s, aviso('Abuela', 'agregar', { id_mesa: 7 })), OK);
  assert.deepStrictEqual(await s.presencia.calcular(7), {
    id_mesa: 7, comensales: ['Abuela'], total: 1, pagaron: [], sin_celular: ['Abuela'],
  });
});

// ---------------------------------------------------------------------------
// «Igual» y cobro de caja (§8.1 y §8.6), en memoria y con el doble de Redis
// ---------------------------------------------------------------------------

async function escenarioPagos(t, almacen, total) {
  const mesa = { saldo: total };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, total, mesa.saldo) }),
  });
  const { s } = await escenario(t, almacen, {
    extraEnv: WOMPI_ENV, deps: { backend, pasarela: pasarelaFalsa({}).pasarela },
  });
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(beto, 'join:table', {});
  const igual = async (alias) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, alias)}` },
      body: JSON.stringify({ modo: 'igual', eventId: randomUUID() }),
    });
    return (await r.json()).monto_en_centavos;
  };
  return { s, mesa, igual };
}

for (const almacen of Object.keys(ALMACENES)) {
  test(`[${almacen}] «igual» con 2 conectados + 1 sin celular reparte entre 3`, async (t) => {
    const { s, igual } = await escenarioPagos(t, almacen, 9_000_000);
    assert.strictEqual(await igual('Ana'), 4_500_000, 'antes: entre Ana y Beto');
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    assert.strictEqual(await igual('Beto'), 3_000_000, 'con Abuela: entre 3');
  });

  test(`[${almacen}] caja con comensal "Abuela " marca a "Abuela" en pagaron y deja de contar en «igual»`, async (t) => {
    const { s, mesa, igual } = await escenarioPagos(t, almacen, 9_000_000);
    assert.deepStrictEqual(await llamar(s, aviso('Abuela')), OK);
    mesa.saldo = 6_000_000;
    const r = await post(s, '/internal/payment-confirmed', {
      eventId: randomUUID(), id_mesa: 5, comensal: 'Abuela ', monto_centavos: 3_000_000, saldo_restante_centavos: 6_000_000,
    });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), ['Abuela']);
    assert.strictEqual(await igual('Ana'), 3_000_000, 'el saldo de 60.000 entre Ana y Beto');
  });
}

test('caja con un comensal que no es alias válido: se anota tal cual y el cobro no se rompe', async (t) => {
  const { s } = await escenario(t, 'memoria');
  for (const comensal of ['Mesa #5', 'General']) {
    const r = await post(s, '/internal/payment-confirmed', {
      eventId: randomUUID(), id_mesa: 5, comensal, monto_centavos: 100, saldo_restante_centavos: 500,
    });
    assert.strictEqual(r.status, 200, comensal);
  }
  assert.deepStrictEqual(await s.estadoMesas.pagaron(5), ['General', 'Mesa #5']);
});

// ---------------------------------------------------------------------------
// Almacenes: TTL de 24 h y aislamiento por mesa
// ---------------------------------------------------------------------------

test('almacenes: sin_celular por mesa, HSETNX por clave y TTL de 24 h (memoria y Redis)', async () => {
  const reloj = { t: 1_000_000 };
  const falso = crearRedisFalso({ ahora: () => reloj.t });
  const almacenes = [crearEstadoMesasMemoria({ ahora: () => reloj.t }), crearEstadoMesasRedis({ cliente: falso.cliente })];
  for (const e of almacenes) {
    assert.strictEqual(await e.agregarSinCelular(5, 'abuela', 'Abuela'), true);
    assert.strictEqual(await e.agregarSinCelular(5, 'abuela', 'abuela'), false, 'misma clave: no se pisa');
    assert.strictEqual(await e.agregarSinCelular(6, 'abuela', 'Abuela'), true, 'otra mesa');
    assert.deepStrictEqual(await e.sinCelular(5), { abuela: 'Abuela' });
  }
  reloj.t += 24 * 60 * 60 * 1000 - 1;
  for (const e of almacenes) assert.deepStrictEqual(await e.sinCelular(5), { abuela: 'Abuela' });
  reloj.t += 2;
  for (const e of almacenes) {
    assert.deepStrictEqual(await e.sinCelular(5), {}, 'vence a las 24 h');
    assert.strictEqual(await e.quitarSinCelular(5, 'abuela'), false);
  }
});

const REDIS_URL = process.env.REDIS_URL;
test('Redis real: sin_celular con HSETNX (solo un alias por clave), TTL y limpieza', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  const { cliente } = conexion;
  const mesa = 900000 + Math.floor(Math.random() * 99999);
  t.after(async () => {
    await cliente.del(`sd:mesa:${mesa}:sin_celular`);
    await conexion.cerrar();
  });
  const e = crearEstadoMesasRedis({ cliente });
  const altas = await Promise.all(['Abuela', 'abuela', 'ABUELA'].map((a) => e.agregarSinCelular(mesa, 'abuela', a)));
  assert.strictEqual(altas.filter(Boolean).length, 1, 'solo una gana');
  assert.strictEqual(Object.keys(await e.sinCelular(mesa)).length, 1);
  const ttl = await cliente.ttl(`sd:mesa:${mesa}:sin_celular`);
  assert.ok(ttl > 24 * 60 * 60 - 60 && ttl <= 24 * 60 * 60, `TTL ${ttl}`);
  assert.strictEqual(await e.quitarSinCelular(mesa, 'abuela'), true);
  await e.agregarSinCelular(mesa, 'beto', 'Beto');
  await e.limpiarMesa(mesa);
  assert.deepStrictEqual(await e.sinCelular(mesa), {});
});
