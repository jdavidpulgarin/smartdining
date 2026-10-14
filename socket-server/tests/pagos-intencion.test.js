const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  levantar, emitir, tokenComensal, tokenPersonal, firmar, CLAVE_INTERNA, ENV_BASE, ORIGEN,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, sinRespuesta, pasarelaFalsa,
} = require('./pagos-helpers');
const { calcularMonto, validarCuenta } = require('../src/cuenta');
const { firmaIntegridad } = require('../src/pasarelas/wompi');
const { cargarConfig } = require('../src/config');
const { crearAlmacenPagosRedis, crearLimitesRedis } = require('../src/almacen/pagos');
const { crearRedisFalso } = require('./redis-falso');

// ---------------------------------------------------------------------------
// Cálculo de montos (lógica pura)
// ---------------------------------------------------------------------------

test('total: cobra el saldo completo de la mesa', () => {
  assert.deepStrictEqual(calcularMonto({ modo: 'total', cuenta: cuenta(5, 9_000_000, 6_000_000), comensal: 'Ana', presentes: 3 }), { montoCentavos: 6_000_000 });
});

test('igual: reparte el TOTAL entre los presentes, redondeado a pesos', () => {
  const c = cuenta(5, 10_000_000); // $100.000 entre 3 → $33.333 c/u
  assert.deepStrictEqual(calcularMonto({ modo: 'igual', cuenta: c, comensal: 'Ana', presentes: 3 }), { montoCentavos: 3_333_300 });
  assert.strictEqual(3_333_300 % 100, 0, 'en pesos enteros');
});

test('igual: el último cubre el residuo y nadie paga más que el saldo', () => {
  const total = 10_000_000;
  let saldo = total;
  const pagos = [];
  for (let i = 0; i < 3; i += 1) {
    const { montoCentavos } = calcularMonto({ modo: 'igual', cuenta: cuenta(5, total, saldo), comensal: 'X', presentes: 3 });
    assert.ok(montoCentavos <= saldo);
    pagos.push(montoCentavos);
    saldo -= montoCentavos;
  }
  assert.deepStrictEqual(pagos, [3_333_300, 3_333_300, 3_333_400]);
  assert.strictEqual(saldo, 0);
  // Total con centavos sueltos: la parte se redondea a pesos y el último
  // absorbe la diferencia exacta, sin pasarse del saldo.
  const c = cuenta(5, 1_000_050, 1_000_050); // $10.000,50 entre 2 → parte $5.000
  const a = calcularMonto({ modo: 'igual', cuenta: c, comensal: 'X', presentes: 2 }).montoCentavos;
  const b = calcularMonto({ modo: 'igual', cuenta: cuenta(5, 1_000_050, 1_000_050 - a), comensal: 'X', presentes: 2 }).montoCentavos;
  assert.strictEqual(a + b, 1_000_050);
});

test('igual: sin presencia cuenta como 1 persona', () => {
  assert.deepStrictEqual(calcularMonto({ modo: 'igual', cuenta: cuenta(5, 500_000), comensal: 'Ana', presentes: 0 }), { montoCentavos: 500_000 });
});

test('propio: el saldo de ese alias; 0 o desconocido → SIN_SALDO; nunca más que el saldo de la mesa', () => {
  const c = cuenta(5, 9_000_000, 2_000_000, { Ana: 2_500_000, Beto: 0 });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'Ana', presentes: 2 }), { montoCentavos: 2_000_000 });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'Beto', presentes: 2 }), { error: 'SIN_SALDO' });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'Zoe', presentes: 2 }), { error: 'SIN_SALDO' });
});

test('saldo 0 → SIN_SALDO en cualquier modo', () => {
  for (const modo of ['total', 'igual', 'propio']) {
    assert.deepStrictEqual(calcularMonto({ modo, cuenta: cuenta(5, 100, 0, { Ana: 0 }), comensal: 'Ana', presentes: 1 }), { error: 'SIN_SALDO' });
  }
});

test('una cuenta malformada del backend se rechaza (nunca se cobra un número cualquiera)', () => {
  assert.strictEqual(validarCuenta(cuenta(5, 100), 5), null);
  assert.match(validarCuenta(cuenta(6, 100), 5), /otra mesa/);
  assert.match(validarCuenta({ ...cuenta(5, 100), moneda: 'USD' }, 5), /moneda/);
  assert.match(validarCuenta({ ...cuenta(5, 100), saldo_centavos: 10.5 }, 5), /montos/);
  assert.match(validarCuenta({ ...cuenta(5, 100), saldo_centavos: 200 }, 5), /supera/);
  assert.match(validarCuenta({ ...cuenta(5, 100), saldo_centavos: -1 }, 5), /montos/);
  assert.match(validarCuenta({ ...cuenta(5, 100), por_comensal: [{ comensal: 'A', saldo_centavos: '9' }] }, 5), /por_comensal/);
});

// ---------------------------------------------------------------------------
// Firma de integridad (fórmula de docs.wompi.co)
// ---------------------------------------------------------------------------

test('firma de integridad = SHA-256(referencia + monto + moneda + expiración + secreto)', () => {
  const datos = {
    referencia: 'sk8-438k4-xmxm392-sn2m', montoCentavos: 2490000, moneda: 'COP', secreto: 'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6',
  };
  // Concatenación de ejemplo de la documentación de Wompi (sin expiración).
  const esperada = crypto.createHash('sha256')
    .update('sk8-438k4-xmxm392-sn2m2490000COPprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6').digest('hex');
  assert.strictEqual(firmaIntegridad(datos), esperada);
  const conExp = firmaIntegridad({ ...datos, expiracion: '2026-10-11T20:00:00.000Z' });
  assert.strictEqual(conExp, crypto.createHash('sha256')
    .update('sk8-438k4-xmxm392-sn2m2490000COP2026-10-11T20:00:00.000Zprod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6').digest('hex'));
  assert.notStrictEqual(firmaIntegridad({ ...datos, montoCentavos: 2490001 }), esperada, 'cambiar el monto cambia la firma');
});

// ---------------------------------------------------------------------------
// POST /pagos/intencion
// ---------------------------------------------------------------------------

const CUENTA_5 = cuenta(5, 9_000_000, 9_000_000, { Ana: 4_000_000, Beto: 5_000_000 });

async function escenario(t, { rutas, env = {} } = {}) {
  const backend = backendFalso(rutas || { 'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: CUENTA_5 }) });
  const s = await levantar({ ...WOMPI_ENV, ...env }, { backend, pasarela: pasarelaFalsa({}).pasarela });
  t.after(() => s.cerrar());
  const sentar = async (alias, mesa = 5, token = tokenComensal(mesa, alias)) => {
    const c = await s.conectar(token);
    await emitir(c, 'join:table', {});
    return token;
  };
  const pedir = (token, cuerpo) => fetch(`${s.url}/pagos/intencion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
  return { s, backend, sentar, pedir };
}
const cuerpo = (modo, extra = {}) => ({ modo, eventId: crypto.randomUUID(), comensal: 'Ana', ...extra });

test('responde solo lo necesario para el widget, con la firma correcta y monto del servidor', async (t) => {
  const { s, backend, sentar, pedir } = await escenario(t);
  const token = await sentar('Ana');
  await sentar('Beto');
  // El cliente intenta colar monto e id_mesa: se ignoran.
  const r = await pedir(token, cuerpo('total', { monto: 1, monto_en_centavos: 1, id_mesa: 9 }));
  assert.strictEqual(r.status, 201);
  const b = await r.json();
  assert.deepStrictEqual(Object.keys(b).sort(), ['expira_en', 'firma_integridad', 'llave_publica', 'moneda', 'monto_en_centavos', 'referencia']);
  assert.strictEqual(b.monto_en_centavos, 9_000_000);
  assert.strictEqual(b.moneda, 'COP');
  assert.strictEqual(b.llave_publica, WOMPI_ENV.WOMPI_PUBLIC_KEY);
  assert.match(b.referencia, /^SD-5-\d{13}-[A-Za-z0-9_-]{16}$/);
  assert.strictEqual(b.firma_integridad, firmaIntegridad({
    referencia: b.referencia, montoCentavos: b.monto_en_centavos, moneda: 'COP', expiracion: b.expira_en, secreto: WOMPI_ENV.WOMPI_INTEGRITY_SECRET,
  }));
  const texto = JSON.stringify(b);
  for (const secreto of [WOMPI_ENV.WOMPI_PRIVATE_KEY, WOMPI_ENV.WOMPI_INTEGRITY_SECRET, WOMPI_ENV.WOMPI_EVENTS_SECRET]) {
    assert.ok(!texto.includes(secreto), 'ningún secreto en la respuesta');
  }
  assert.deepStrictEqual(backend.llamadas.filter((l) => l.ruta.includes('/cuenta/')).map((l) => l.ruta), ['/api/mesas/5/cuenta/interno'], 'la mesa sale del JWT');
  const guardada = await s.almacenPagos.obtener(b.referencia);
  assert.deepStrictEqual(
    { ...guardada, creada_en: undefined },
    { id_mesa: 5, comensal: 'Ana', modo: 'total', monto_centavos: 9_000_000, estado: 'pendiente', creada_en: undefined, expira_en: b.expira_en },
  );
  const minutos = (Date.parse(b.expira_en) - Date.now()) / 60000;
  assert.ok(minutos > 29 && minutos <= 30, 'expira en PAGOS_TTL_MINUTOS');
});

test('igual y propio calculan el monto por modo', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const ana = await sentar('Ana');
  await sentar('Beto');
  await sentar('Caro');
  assert.strictEqual((await (await pedir(ana, cuerpo('igual'))).json()).monto_en_centavos, 3_000_000);
  const beto = await sentar('Beto');
  assert.strictEqual((await (await pedir(beto, cuerpo('propio', { comensal: 'Beto' }))).json()).monto_en_centavos, 5_000_000);
});

test('propio sin saldo → 409 SIN_SALDO', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const caro = await sentar('Caro');
  const r = await pedir(caro, cuerpo('propio', { comensal: 'Caro' }));
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [409, 'SIN_SALDO']);
});

test('una sola intención pendiente por comensal: otra petición devuelve la misma', async (t) => {
  const { sentar, pedir, backend } = await escenario(t);
  const ana = await sentar('Ana');
  const a = await (await pedir(ana, cuerpo('total'))).json();
  const r2 = await pedir(ana, cuerpo('igual'));
  assert.strictEqual(r2.status, 200);
  const b = await r2.json();
  assert.strictEqual(b.referencia, a.referencia);
  assert.strictEqual(b.monto_en_centavos, a.monto_en_centavos);
  assert.strictEqual(backend.llamadas.filter((l) => l.ruta.includes('/cuenta/')).length, 1, 'no vuelve a pedir la cuenta');
});

test('mismo eventId: misma respuesta', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const ana = await sentar('Ana');
  const c = cuerpo('total');
  const a = await (await pedir(ana, c)).json();
  const r = await pedir(ana, c);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), a);
});

test('autorización: sin token 401, personal 403, sesión de mesa ya liberada 401', async (t) => {
  const { s, sentar, pedir } = await escenario(t);
  assert.strictEqual((await pedir(null, cuerpo('total'))).status, 401);
  assert.strictEqual((await pedir(tokenPersonal('cajero'), cuerpo('total'))).status, 403);
  const viejo = tokenComensal(5, 'Ana', { iat: Math.floor(Date.now() / 1000) - 60 });
  await sentar('Ana', 5, viejo);
  await fetch(`${s.url}/internal/mesa-liberada`, { method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }) });
  assert.strictEqual((await pedir(viejo, cuerpo('total'))).status, 401);
});

test('payload inválido: modo o eventId', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const ana = await sentar('Ana');
  for (const malo of [cuerpo('todo'), cuerpo('total', { eventId: 'x' }), { eventId: crypto.randomUUID(), comensal: 'Ana' }]) {
    const r = await pedir(ana, malo);
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [400, 'PAYLOAD_INVALIDO'], JSON.stringify(malo));
  }
});

test('quien paga es el alias del JWT; `comensal` en el cuerpo es opcional', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const beto = await sentar('Beto');
  const sinAlias = { modo: 'propio', eventId: crypto.randomUUID() };
  const r = await pedir(beto, sinAlias);
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await r.json()).monto_en_centavos, 5_000_000, 'lo propio de Beto');
});

test('límite: 5 intenciones por minuto por comensal', async (t) => {
  const { sentar, pedir } = await escenario(t);
  const ana = await sentar('Ana');
  for (let i = 0; i < 5; i += 1) assert.ok((await pedir(ana, cuerpo('total'))).status < 300);
  const r = await pedir(ana, cuerpo('total'));
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [429, 'RATE_LIMIT']);
});

test('backend caído, con error o con cuenta malformada: error genérico y sin intención', async (t) => {
  for (const [respuesta, status] of [
    [sinRespuesta(), 503],
    [{ status: 500, cuerpo: { error: 'boom', stack: 'at x' } }, 502],
    [{ status: 200, cuerpo: { ...CUENTA_5, id_mesa: 6 } }, 502],
  ]) {
    const { s, sentar, pedir } = await escenario(t, { rutas: { 'GET /api/mesas/5/cuenta/interno': () => respuesta } });
    const ana = await sentar('Ana');
    const r = await pedir(ana, cuerpo('total'));
    const b = await r.json();
    assert.strictEqual(r.status, status);
    assert.strictEqual(b.codigo, 'ERROR_INTERNO');
    assert.ok(!JSON.stringify(b).includes('stack'), 'sin trazas hacia el cliente');
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), null);
  }
});

test('sin Wompi configurado: 503 NO_CONFIGURADO', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  const r = await fetch(`${s.url}/pagos/intencion`, { method: 'POST', headers: { Authorization: `Bearer ${tokenComensal(5)}` }, body: '{}' });
  assert.strictEqual(r.status, 503);
});

test('Redis: intención y pendiente con TTL; límite con INCR', async () => {
  const falso = crearRedisFalso();
  const pagos = crearAlmacenPagosRedis({ cliente: falso.cliente });
  await pagos.guardarIntencion('SD-5-1-a', { estado: 'pendiente' }, 1800);
  assert.strictEqual(await pagos.reservarPendiente(5, 'Ana', 'SD-5-1-a', 1800), 'SD-5-1-a');
  assert.strictEqual(await pagos.reservarPendiente(5, 'Ana', 'SD-5-2-b', 1800), 'SD-5-1-a', 'gana la primera');
  assert.deepStrictEqual((await pagos.obtener('SD-5-1-a')).estado, 'pendiente');
  const limites = crearLimitesRedis({ cliente: falso.cliente });
  const r = [];
  for (let i = 0; i < 6; i += 1) r.push(await limites.consumir('pago:5:Ana', 5, 60));
  assert.deepStrictEqual(r, [true, true, true, true, true, false]);
});

// ---------------------------------------------------------------------------
// Configuración de Wompi al arrancar
// ---------------------------------------------------------------------------

test('config: sin WOMPI_* los pagos quedan apagados; con todas, encendidos', () => {
  const base = { CORS_ORIGINS: ORIGEN, ...ENV_BASE };
  assert.strictEqual(cargarConfig(base).wompi, null);
  const c = cargarConfig({ ...base, ...WOMPI_ENV });
  assert.deepStrictEqual([c.wompi.sandbox, c.wompi.ttlMinutos], [true, 30]);
});

test('config: incompleta, de ejemplo, mezclada o con API no oficial → no arranca', () => {
  const base = { CORS_ORIGINS: ORIGEN, ...ENV_BASE, ...WOMPI_ENV };
  const casos = [
    [{ WOMPI_EVENTS_SECRET: '' }, /WOMPI_EVENTS_SECRET es obligatoria/],
    [{ WOMPI_PRIVATE_KEY: 'prv_test_cambia-esto' }, /WOMPI_PRIVATE_KEY no tiene el formato/],
    [{ WOMPI_PUBLIC_KEY: 'pk_live_123' }, /WOMPI_PUBLIC_KEY no tiene el formato/],
    [{ WOMPI_INTEGRITY_SECRET: 'prod_integrity_abcdefghijklmnopqrstuvwxyz0123' }, /mezclan sandbox/],
    [{ WOMPI_API_URL: 'https://evil.example/v1' }, /WOMPI_API_URL debe ser una de/],
    [{ WOMPI_API_URL: 'https://production.wompi.co/v1' }, /debe ser https:\/\/sandbox/],
    [{ WOMPI_EVENTS_SECRET: 'test_events_corto' }, /demasiado corta/],
    [{ BACKEND_URL: '' }, /BACKEND_URL es obligatoria/],
    [{ PAGOS_TTL_MINUTOS: '1' }, /PAGOS_TTL_MINUTOS/],
  ];
  for (const [cambio, error] of casos) {
    assert.throws(() => cargarConfig({ ...base, ...cambio }), error, JSON.stringify(cambio));
  }
});
