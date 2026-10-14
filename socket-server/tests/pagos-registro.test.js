const test = require('node:test');
const assert = require('node:assert');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal,
} = require('./helpers');
const {
  WOMPI_ENV, backendFalso, pasarelaFalsa, sinRespuesta,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');

const SECRETO = WOMPI_ENV.WOMPI_EVENTS_SECRET;
const REF = 'SD-5-1760000000000-AAAAAAAAAAAAAAAA';
const ID_TX = '1132-903100443-27458';
const MONTO = 3_333_300;

/** data de GET /transactions/{id} tal como la devuelve Wompi. */
const txApi = (extra = {}) => ({
  id: ID_TX, reference: REF, status: 'APPROVED', amount_in_cents: MONTO, currency: 'COP', customer_email: 'x@example.com', ...extra,
});

async function escenario(t, { api = { [ID_TX]: txApi() }, apiCaida = false, rutas } = {}) {
  const orden = [];
  const backend = backendFalso(rutas || {
    'POST /api/transacciones/internal': () => {
      orden.push('registro');
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: 6_666_700, mesa_liberada: false } };
    },
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const { pasarela, fetch } = pasarelaFalsa(api, { caido: apiCaida });
  const s = await levantar(WOMPI_ENV, { backend, pasarela });
  t.after(() => s.cerrar());
  // Intención pendiente de Ana en la mesa 5, como la deja POST /pagos/intencion.
  await s.almacenPagos.guardarIntencion(REF, {
    id_mesa: 5, comensal: 'Ana', modo: 'igual', monto_centavos: MONTO, estado: 'pendiente', creada_en: new Date().toISOString(), expira_en: new Date(Date.now() + 1800e3).toISOString(),
  }, 1800);
  await s.almacenPagos.reservarPendiente(5, 'Ana', REF, 1800);

  const admin = await s.conectar(tokenPersonal('admin'));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', { comensal: 'Ana' });
  await emitir(mesa6, 'join:table', { comensal: 'Beto' });
  // Registra cuándo sale payment:confirmed respecto del registro en el backend.
  admin.on('payment:confirmed', () => orden.push('emitido'));

  const enviar = (ev) => globalThis.fetch(`${s.url}/pagos/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
  });
  const evento = (extra = {}) => eventoWompi({
    secreto: SECRETO, id: ID_TX, referencia: REF, monto: MONTO, ...extra,
  });
  return {
    s, backend, fetch, admin, mesa5, mesa6, enviar, evento, orden,
  };
}
const llamadasA = (backend, ruta) => backend.llamadas.filter((l) => l.ruta === ruta);
// Llamadas de pagos (sin contar la consulta de capacidad de la mesa al conectar).
const llamadasDePago = (backend) => backend.llamadas.filter((l) => l.metodo === 'POST');

test('pago aprobado y coherente: se registra en el backend y SOLO después se anuncia', async (t) => {
  const {
    s, backend, fetch, admin, mesa5, mesa6, enviar, evento, orden,
  } = await escenario(t);
  const [enAdmin, enMesa, enOtra] = [esperar(admin, 'payment:confirmed'), esperar(mesa5, 'payment:confirmed'), esperar(mesa6, 'payment:confirmed')];
  const r = await enviar(evento());
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: false, registrado: true });

  const ev = await enAdmin;
  assert.deepStrictEqual({ ...ev, emitidoEn: undefined }, {
    eventId: ID_TX, id_mesa: 5, comensal: 'Ana', monto: 33_333, saldo_restante: 66_667, monto_centavos: MONTO, saldo_restante_centavos: 6_666_700, referencia_externa: REF, emitidoEn: undefined,
  });
  assert.ok(await enMesa);
  assert.strictEqual(await enOtra, null, 'otra mesa no se entera');
  assert.deepStrictEqual(orden, ['registro', 'emitido']);

  const [registro] = llamadasA(backend, '/api/transacciones/internal');
  assert.deepStrictEqual(registro.cuerpo, {
    referencia_externa: REF, id_transaccion_pasarela: ID_TX, pasarela: 'wompi', id_mesa: 5, comensal: 'Ana', modo: 'igual', monto_centavos: MONTO, moneda: 'COP', metodo_pago: 'online',
  });
  // Reverificación con la llave PRIVADA.
  assert.strictEqual(fetch.llamadas[0].opts.headers.Authorization, `Bearer ${WOMPI_ENV.WOMPI_PRIVATE_KEY}`);
  assert.strictEqual((await s.almacenPagos.obtener(REF)).estado, 'pagada');
  assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), null, 'Ana puede pagar de nuevo si hace falta');
});

test('checksum inválido: 400, sin consultar la API, sin registrar ni emitir', async (t) => {
  const {
    backend, fetch, admin, enviar, evento,
  } = await escenario(t);
  const nada = esperar(admin, 'payment:confirmed', 300);
  const malo = evento();
  malo.signature.checksum = 'f'.repeat(64);
  const r = await enviar(malo);
  assert.strictEqual(r.status, 400);
  assert.strictEqual(fetch.llamadas.length, 0);
  assert.strictEqual(llamadasDePago(backend).length, 0);
  assert.strictEqual(await nada, null);
});

test('monto distinto al esperado: no se registra; intento fallido y pago:alerta al panel', async (t) => {
  const {
    s, backend, admin, mesa5, enviar, evento,
  } = await escenario(t, { api: { [ID_TX]: txApi({ amount_in_cents: 100 }) } });
  const alerta = esperar(admin, 'pago:alerta');
  const nadaMesa = esperar(mesa5, 'payment:confirmed', 300);
  const r = await enviar(evento({ monto: 100 }));
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: false, registrado: false });
  const a = await alerta;
  assert.deepStrictEqual([a.motivo, a.id_mesa, a.referencia_externa, a.id_transaccion_pasarela], ['monto_distinto', 5, REF, ID_TX]);
  assert.ok(!('customer_email' in a));
  assert.strictEqual(llamadasA(backend, '/api/transacciones/internal').length, 0);
  const [fallido] = llamadasA(backend, '/api/pagos/intentos-fallidos/interno');
  assert.deepStrictEqual([fallido.cuerpo.motivo, fallido.cuerpo.monto_centavos, fallido.cuerpo.monto_esperado_centavos], ['monto_distinto', 100, MONTO]);
  assert.strictEqual(await nadaMesa, null);
  assert.strictEqual((await s.almacenPagos.obtener(REF)).estado, 'pendiente');
});

test('el evento dice APPROVED pero la API no: gana la API (alerta, sin registro)', async (t) => {
  for (const [api, motivo] of [
    [{ [ID_TX]: txApi({ status: 'DECLINED' }) }, 'estado_no_aprobado'],
    [{}, 'transaccion_inexistente'],
    [{ [ID_TX]: txApi({ reference: 'SD-9-otra' }) }, 'referencia_distinta'],
    [{ [ID_TX]: txApi({ currency: 'USD' }) }, 'moneda_distinta'],
  ]) {
    const { backend, admin, enviar, evento } = await escenario(t, { api });
    const alerta = esperar(admin, 'pago:alerta');
    await enviar(evento());
    assert.strictEqual((await alerta).motivo, motivo);
    assert.strictEqual(llamadasA(backend, '/api/transacciones/internal').length, 0, motivo);
  }
});

test('referencia desconocida (o vencida): alerta y no se registra', async (t) => {
  const otraRef = 'SD-5-1-desconocida';
  const { backend, admin, enviar } = await escenario(t, { api: { [ID_TX]: txApi({ reference: otraRef }) } });
  const alerta = esperar(admin, 'pago:alerta');
  await enviar(eventoWompi({ secreto: SECRETO, id: ID_TX, referencia: otraRef, monto: MONTO }));
  const a = await alerta;
  assert.deepStrictEqual([a.motivo, a.id_mesa], ['referencia_desconocida', null]);
  assert.strictEqual(llamadasA(backend, '/api/transacciones/internal').length, 0);
});

test('evento duplicado: 200 sin efectos (ni otro registro ni otro aviso)', async (t) => {
  const {
    backend, admin, enviar, evento,
  } = await escenario(t);
  const ev = evento();
  const primero = esperar(admin, 'payment:confirmed');
  await enviar(ev);
  await primero;
  const segundo = esperar(admin, 'payment:confirmed', 300);
  const r = await enviar(ev);
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: true });
  assert.strictEqual(await segundo, null);
  assert.strictEqual(llamadasA(backend, '/api/transacciones/internal').length, 1);
});

test('backend caído al registrar: 503, nada se emite, y el reintento de Wompi sí registra', async (t) => {
  let caido = true;
  const {
    backend, admin, enviar, evento,
  } = await escenario(t, {
    rutas: {
      'POST /api/transacciones/internal': () => (caido ? sinRespuesta() : { status: 200, cuerpo: { ok: true, saldo_restante_centavos: 0 } }),
    },
  });
  const ev = evento();
  const nada = esperar(admin, 'payment:confirmed', 300);
  const r = await enviar(ev);
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [503, 'ERROR_INTERNO']);
  assert.strictEqual(await nada, null, 'nunca se anuncia un pago no registrado');

  caido = false;
  const llega = esperar(admin, 'payment:confirmed');
  const r2 = await enviar(ev); // reintento de Wompi: mismo evento
  assert.strictEqual((await r2.json()).registrado, true);
  assert.strictEqual((await llega).saldo_restante, 0);
  assert.strictEqual(llamadasA(backend, '/api/transacciones/internal').length, 2);
});

test('backend 500 o respuesta sin saldo: 503 y sin aviso', async (t) => {
  for (const respuesta of [{ status: 500, cuerpo: null }, { status: 200, cuerpo: { ok: true } }]) {
    const { admin, enviar, evento } = await escenario(t, { rutas: { 'POST /api/transacciones/internal': () => respuesta } });
    const nada = esperar(admin, 'payment:confirmed', 200);
    assert.strictEqual((await enviar(evento())).status, 503);
    assert.strictEqual(await nada, null);
  }
});

test('el backend rechaza el pago (409): alerta y no se anuncia', async (t) => {
  const { admin, enviar, evento } = await escenario(t, {
    rutas: {
      'POST /api/transacciones/internal': () => ({ status: 409, cuerpo: { error: 'excede el saldo' } }),
      'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
    },
  });
  const alerta = esperar(admin, 'pago:alerta');
  const nada = esperar(admin, 'payment:confirmed', 300);
  await enviar(evento());
  assert.strictEqual((await alerta).motivo, 'backend_rechazo_409');
  assert.strictEqual(await nada, null);
});

test('API de la pasarela caída: 503 para que Wompi reintente', async (t) => {
  const { backend, enviar, evento } = await escenario(t, { apiCaida: true });
  const r = await enviar(evento());
  assert.strictEqual(r.status, 503);
  assert.strictEqual(llamadasDePago(backend).length, 0);
});

test('no se puede guardar el intento fallido: 503 (la evidencia no se pierde)', async (t) => {
  const { enviar, evento } = await escenario(t, {
    api: { [ID_TX]: txApi({ amount_in_cents: 1 }) },
    rutas: { 'POST /api/pagos/intentos-fallidos/interno': () => sinRespuesta() },
  });
  assert.strictEqual((await enviar(evento({ monto: 1 }))).status, 503);
});

test('DECLINED y ERROR: sin consultar ni registrar; el comensal queda libre para reintentar', async (t) => {
  for (const [estado, guardado] of [['DECLINED', 'rechazada'], ['ERROR', 'error']]) {
    const {
      s, backend, fetch, admin, enviar, evento,
    } = await escenario(t);
    const nada = esperar(admin, 'payment:confirmed', 200);
    const r = await enviar(evento({ estado }));
    assert.deepStrictEqual(await r.json(), {
      ok: true, duplicado: false, registrado: false, estado,
    });
    assert.strictEqual(await nada, null);
    assert.strictEqual(fetch.llamadas.length, 0);
    assert.strictEqual(llamadasDePago(backend).length, 0);
    assert.strictEqual((await s.almacenPagos.obtener(REF)).estado, guardado);
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), null);
  }
});

test('un pago aprobado DESPUÉS de uno rechazado de la misma referencia no se acepta', async (t) => {
  const { admin, enviar, evento } = await escenario(t);
  await enviar(evento({ estado: 'DECLINED' }));
  const alerta = esperar(admin, 'pago:alerta');
  await enviar(evento());
  assert.strictEqual((await alerta).motivo, 'intencion_no_pendiente');
});
