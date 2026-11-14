const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, tokenPantalla,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa, sinRespuesta,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');

// Contrato del excedente (EVENTS.md §8.1): un pago en línea aprobado nunca se
// rechaza; el backend dice cuánto aplicó y cuánto sobra. La intención siempre
// termina en 'pagada' o 'en_revision', nunca en 'pendiente'.

const SECRETO = WOMPI_ENV.WOMPI_EVENTS_SECRET;
const REF = 'SD-5-1760000000000-BBBBBBBBBBBBBBBB';
const ID_TX = '1132-903100443-99999';
const MONTO = 3_333_300;
const txApi = () => ({
  id: ID_TX, reference: REF, status: 'APPROVED', amount_in_cents: MONTO, currency: 'COP',
});
const INTERNO = '/api/transacciones/internal';
const FALLIDOS = '/api/pagos/intentos-fallidos/interno';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** `registro`: lo que responde el backend al registrar, una función por llamada (o una sola para todas). */
async function escenario(t, registro) {
  const respuestas = Array.isArray(registro) ? [...registro] : null;
  const backend = backendFalso({
    [`POST ${INTERNO}`]: () => (respuestas ? respuestas.shift()() : registro()),
    [`POST ${FALLIDOS}`]: () => ({ status: 201, cuerpo: { ok: true } }),
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, 9_000_000, 9_000_000, { Ana: 4_000_000, Beto: 5_000_000 }) }),
  });
  const { pasarela } = pasarelaFalsa({ [ID_TX]: txApi() });
  const s = await levantar(WOMPI_ENV, { backend, pasarela });
  t.after(() => s.cerrar());
  const creada = new Date(Date.now() - 60_000).toISOString();
  await s.almacenPagos.guardarIntencion(REF, {
    id_mesa: 5, comensal: 'Ana', modo: 'propio', monto_centavos: MONTO, estado: 'pendiente', creada_en: creada, expira_en: new Date(Date.now() + 1800e3).toISOString(),
  }, 1800);
  await s.almacenPagos.reservarPendiente(5, 'Ana', REF, 1800);

  const admin = await s.conectar(tokenPersonal('admin'));
  const mesa5 = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(mesa5, 'join:table', {});
  const recibidos = { admin: [], mesa5: [] };
  for (const ev of ['payment:confirmed', 'pago:excedente', 'pago:alerta']) {
    admin.on(ev, (d) => recibidos.admin.push([ev, d]));
    mesa5.on(ev, (d) => recibidos.mesa5.push([ev, d]));
  }
  const ev = eventoWompi({
    secreto: SECRETO, id: ID_TX, referencia: REF, monto: MONTO,
  });
  const enviar = () => fetch(`${s.url}/pagos/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
  });
  const estado = async () => (await s.almacenPagos.obtener(REF)).estado;
  const de = (quien, nombre) => recibidos[quien].filter(([e]) => e === nombre).map(([, d]) => d);
  return {
    s, backend, admin, mesa5, enviar, estado, de, creada,
  };
}

const ok = (extra = {}) => () => ({
  status: 201,
  cuerpo: {
    ok: true, duplicado: false, saldo_restante_centavos: 0, mesa_liberada: false, ...extra,
  },
});

test('excedente de lo mío: payment:confirmed con aplicado/excedente y pago:excedente solo al panel', async (t) => {
  const e = await escenario(t, ok({
    aplicado_centavos: 2_000_000, excedente_centavos: 1_333_300, motivo_excedente: 'excede_saldo_comensal', id_transaccion: 812,
  }));
  const excedente = esperar(e.admin, 'pago:excedente');
  const r = await e.enviar();
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: false, registrado: true });
  const x = await excedente;
  assert.deepStrictEqual({ ...x, emitidoEn: undefined }, {
    eventId: `${ID_TX}:excedente`,
    id_mesa: 5,
    comensal: 'Ana',
    monto_centavos: MONTO,
    aplicado_centavos: 2_000_000,
    excedente_centavos: 1_333_300,
    motivo_excedente: 'excede_saldo_comensal',
    id_transaccion: 812,
    referencia_externa: REF,
    emitidoEn: undefined,
  });
  await pausa(100);
  const [pc] = e.de('admin', 'payment:confirmed');
  assert.deepStrictEqual([pc.aplicado, pc.aplicado_centavos, pc.excedente, pc.excedente_centavos], [20_000, 2_000_000, 13_333, 1_333_300]);
  assert.strictEqual(e.de('mesa5', 'payment:confirmed').length, 1, 'la mesa (misma visita) ve su pago');
  assert.deepStrictEqual(e.de('mesa5', 'pago:excedente'), [], 'el excedente es solo del panel');
  assert.strictEqual(await e.estado(), 'pagada');
  assert.strictEqual(await e.s.almacenPagos.obtenerPendiente(5, 'Ana'), null);
  const [registro] = e.backend.llamadas.filter((l) => l.ruta === INTERNO);
  assert.strictEqual(registro.cuerpo.intencion_creada_en, e.creada, 'manda la visita de la intención');
});

test('excedente total (no había nada que cubrir): aplicado 0, excedente = monto', async (t) => {
  const e = await escenario(t, ok({
    saldo_restante_centavos: 0, aplicado_centavos: 0, excedente_centavos: MONTO, motivo_excedente: 'sin_cuenta', id_transaccion: 813,
  }));
  const excedente = esperar(e.admin, 'pago:excedente');
  assert.strictEqual((await e.enviar()).status, 200);
  const x = await excedente;
  assert.deepStrictEqual([x.aplicado_centavos, x.excedente_centavos, x.motivo_excedente], [0, MONTO, 'sin_cuenta']);
  assert.strictEqual(await e.estado(), 'pagada');
});

test('grupo anterior (otra_visita): no se anuncia en la mesa del grupo nuevo, solo en el panel', async (t) => {
  const e = await escenario(t, ok({
    saldo_restante_centavos: 5_000_000, aplicado_centavos: 0, excedente_centavos: MONTO, motivo_excedente: 'otra_visita', id_transaccion: 814,
  }));
  const excedente = esperar(e.admin, 'pago:excedente');
  const enAdmin = esperar(e.admin, 'payment:confirmed');
  const nadaMesa = esperar(e.mesa5, 'payment:confirmed', 400);
  assert.strictEqual((await e.enviar()).status, 200);
  assert.strictEqual((await excedente).motivo_excedente, 'otra_visita');
  assert.ok(await enAdmin, 'el panel sí lo ve');
  assert.strictEqual(await nadaMesa, null, 'Beto (grupo nuevo) no ve el pago de Ana');
  assert.strictEqual(await e.estado(), 'pagada');
});

test('sin excedente: no hay pago:excedente; un backend viejo (sin los campos) se anuncia como siempre', async (t) => {
  for (const respuesta of [
    ok({ aplicado_centavos: MONTO, excedente_centavos: 0 }),
    ok(),
    // Incoherente (aplicado + excedente ≠ monto): se ignora, como un backend viejo.
    ok({ aplicado_centavos: 1, excedente_centavos: 1, motivo_excedente: 'sin_cuenta' }),
  ]) {
    const e = await escenario(t, respuesta);
    const enAdmin = esperar(e.admin, 'payment:confirmed');
    assert.strictEqual((await e.enviar()).status, 200);
    const pc = await enAdmin;
    await pausa(100);
    assert.deepStrictEqual(e.de('admin', 'pago:excedente'), []);
    if (pc.aplicado_centavos === undefined) assert.ok(!('excedente' in pc));
    else assert.strictEqual(pc.excedente_centavos, 0);
    assert.strictEqual(await e.estado(), 'pagada');
  }
});

test('5xx agotado: cada intento es 503 y en_revision, y el aviso al panel con el mismo eventId en cada intento; sin registro, sin anuncio', async (t) => {
  const e = await escenario(t, () => sinRespuesta());
  for (let i = 0; i < 3; i += 1) {
    const r = await e.enviar();
    assert.strictEqual(r.status, 503, `intento ${i + 1}`);
    assert.strictEqual(await e.estado(), 'en_revision', 'nunca se queda en pendiente');
  }
  await pausa(100);
  const alertas = e.de('admin', 'pago:alerta');
  assert.strictEqual(alertas.length, 3);
  assert.ok(alertas.every((a) => a.eventId === `${ID_TX}:backend_no_disponible` && a.motivo === 'backend_no_disponible'), 'mismo eventId: el panel lo deduplica');
  assert.deepStrictEqual([alertas[0].id_mesa, alertas[0].comensal, alertas[0].monto_centavos], [5, 'Ana', MONTO]);
  assert.deepStrictEqual(e.de('mesa5', 'pago:alerta'), [], 'la alerta es solo del panel');
  assert.deepStrictEqual(e.de('admin', 'payment:confirmed'), []);
  assert.strictEqual(e.backend.llamadas.filter((l) => l.ruta === FALLIDOS).length, 0, 'no se llama al backend caído para guardar el intento');
});

test('doble webhook: un 5xx y después el reintento registra; la entrega repetida no hace nada más', async (t) => {
  const e = await escenario(t, [
    () => ({ status: 503, cuerpo: { error: 'ocupado' } }),
    ok({
      aplicado_centavos: 2_000_000, excedente_centavos: 1_333_300, motivo_excedente: 'excede_saldo_comensal', id_transaccion: 815,
    }),
  ]);
  assert.strictEqual((await e.enviar()).status, 503);
  assert.strictEqual(await e.estado(), 'en_revision');
  assert.ok(await e.s.almacenPagos.obtenerPendiente(5, 'Ana'), 'la marca sigue: Ana no puede abrir otra');
  const r = await e.enviar();
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: false, registrado: true }, 'en_revision sigue siendo cobrable');
  assert.strictEqual(await e.estado(), 'pagada');
  assert.strictEqual(await e.s.almacenPagos.obtenerPendiente(5, 'Ana'), null);
  const tercera = await e.enviar();
  assert.deepStrictEqual(await tercera.json(), { ok: true, duplicado: true });
  await pausa(100);
  assert.strictEqual(e.backend.llamadas.filter((l) => l.ruta === INTERNO).length, 2);
  assert.strictEqual(e.de('admin', 'payment:confirmed').length, 1);
  assert.strictEqual(e.de('admin', 'pago:excedente').length, 1);
});

test('doble registro: si el backend responde duplicado, se anuncia con los mismos eventId', async (t) => {
  const cuerpo = {
    aplicado_centavos: 2_000_000, excedente_centavos: 1_333_300, motivo_excedente: 'excede_saldo_comensal', id_transaccion: 816,
  };
  const e = await escenario(t, [
    () => sinRespuesta(), // el registro entró, pero la respuesta se perdió
    () => ({ status: 200, cuerpo: { ok: true, duplicado: true, saldo_restante_centavos: 0, mesa_liberada: false, ...cuerpo } }),
  ]);
  assert.strictEqual((await e.enviar()).status, 503);
  const excedente = esperar(e.admin, 'pago:excedente');
  assert.strictEqual((await e.enviar()).status, 200);
  assert.strictEqual((await excedente).eventId, `${ID_TX}:excedente`);
  assert.strictEqual(e.de('admin', 'payment:confirmed')[0].eventId, ID_TX);
  assert.strictEqual(await e.estado(), 'pagada');
});

test('4xx del backend: intento fallido y pago:alerta, la intención queda en_revision y Wompi no reintenta', async (t) => {
  const e = await escenario(t, () => ({ status: 400, cuerpo: { error: 'cuerpo inválido' } }));
  const alerta = esperar(e.admin, 'pago:alerta');
  const r = await e.enviar();
  assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false, registrado: false }]);
  assert.strictEqual((await alerta).motivo, 'backend_rechazo_400');
  assert.strictEqual(e.backend.llamadas.filter((l) => l.ruta === FALLIDOS).length, 1);
  assert.strictEqual(await e.estado(), 'en_revision');
});

test('con un pago en revisión, la misma persona no puede abrir otra intención (409 PAGO_EN_REVISION)', async (t) => {
  const e = await escenario(t, () => sinRespuesta());
  assert.strictEqual((await e.enviar()).status, 503);
  const pedir = (comensal) => fetch(`${e.s.url}/pagos/intencion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, comensal)}` },
    body: JSON.stringify({ modo: 'propio', eventId: crypto.randomUUID(), comensal }),
  });
  const ana = await e.s.conectar(tokenComensal(5, 'Ana'));
  await emitir(ana, 'join:table', {});
  const r = await pedir('Ana');
  assert.strictEqual(r.status, 409);
  const b = await r.json();
  assert.strictEqual(b.codigo, 'PAGO_EN_REVISION');
  assert.match(b.mensaje, /se está confirmando/);
  assert.strictEqual((await e.s.almacenPagos.obtener(REF)).estado, 'en_revision', 'no se reemplaza');
  // Otra persona de la mesa sí puede pagar lo suyo.
  assert.strictEqual((await pedir('Beto')).status, 201);
});

test('pago:excedente nunca llega a comensales, tablet ni cocina', async (t) => {
  const e = await escenario(t, ok({
    aplicado_centavos: 0, excedente_centavos: MONTO, motivo_excedente: 'sin_cuenta', id_transaccion: 817,
  }));
  const tablet = await e.s.conectar(tokenPantalla(5));
  const cocina = await e.s.conectar(tokenPersonal('cocina'));
  const nada = [esperar(tablet, 'pago:excedente', 400), esperar(cocina, 'pago:excedente', 400), esperar(e.mesa5, 'pago:excedente', 400)];
  const si = esperar(e.admin, 'pago:excedente');
  assert.strictEqual((await e.enviar()).status, 200);
  assert.ok(await si);
  assert.deepStrictEqual(await Promise.all(nada), [null, null, null]);
});

test('un DECLINED de otro intento con la misma referencia no saca de en_revision el cobro aprobado', async (t) => {
  const e = await escenario(t, [
    () => sinRespuesta(),
    ok({ aplicado_centavos: MONTO, excedente_centavos: 0, id_transaccion: 818 }),
  ]);
  assert.strictEqual((await e.enviar()).status, 503);
  assert.strictEqual(await e.estado(), 'en_revision');
  const rechazado = eventoWompi({
    secreto: SECRETO, id: '1132-903100443-00001', referencia: REF, monto: MONTO, estado: 'DECLINED',
  });
  const r = await fetch(`${e.s.url}/pagos/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': rechazado.signature.checksum }, body: JSON.stringify(rechazado),
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(await e.estado(), 'en_revision', 'el rechazo de otro intento no la cierra');
  assert.ok(await e.s.almacenPagos.obtenerPendiente(5, 'Ana'), 'ni le quita la marca');
  assert.deepStrictEqual(await (await e.enviar()).json(), { ok: true, duplicado: false, registrado: true });
  assert.strictEqual(await e.estado(), 'pagada');
});
