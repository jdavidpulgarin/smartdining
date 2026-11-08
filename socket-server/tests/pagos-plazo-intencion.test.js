// R-13.4b: el registro de la intención dura más que el plazo para pagarla, para
// que el webhook que llega tarde (reintentos de Wompi) la siga encontrando.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { levantar, esperar, tokenComensal, tokenPersonal } = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');
const { ttlIntencionRegistroSeg } = require('../src/pasarelas/wompi');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const SECRETO = WOMPI_ENV.WOMPI_EVENTS_SECRET;
const MONTO = 9_000_000;
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const ID_TX = '1132-903100443-27458';
const RUTA_REGISTRO = '/api/transacciones/internal';
const REGISTRADO = { ok: true, duplicado: false, registrado: true };
const silencioso = { info() {}, error() {} };

async function escenario(t, almacen, env = {}) {
  // Solo Date: los temporizadores reales siguen andando para sockets y HTTP.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const registrar = {
    respuesta: () => ({ status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: 0, mesa_liberada: false } }),
  };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, MONTO, MONTO, { Ana: MONTO }) }),
    [`POST ${RUTA_REGISTRO}`]: () => registrar.respuesta(),
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const transacciones = {};
  const { pasarela } = pasarelaFalsa(transacciones);
  const deps = { backend, pasarela };
  if (almacen === 'redis') {
    deps.redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso });
  }
  const s = await levantar({ ...WOMPI_ENV, ...env }, deps);
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('admin'));

  const intencion = async (modo, eventId = crypto.randomUUID()) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      // El JWT se firma en cada petición: el de pruebas dura 1 h y el reloj avanza.
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, 'Ana')}` },
      body: JSON.stringify({ modo, eventId }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  const webhook = async (referencia, { estado = 'APPROVED', monto = MONTO, id = ID_TX } = {}) => {
    transacciones[id] = {
      id, reference: referencia, status: estado, amount_in_cents: monto, currency: 'COP',
    };
    const ev = eventoWompi({
      secreto: SECRETO, id, referencia, monto, estado,
    });
    const r = await fetch(`${s.url}/pagos/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  const registros = () => backend.llamadas.filter((l) => l.ruta === RUTA_REGISTRO).length;
  const avanzar = (ms) => t.mock.timers.tick(ms);
  return {
    s, admin, intencion, webhook, registros, avanzar, registrar,
  };
}

test('el TTL de registro se deriva del plazo de pago y de la tolerancia del webhook', () => {
  assert.strictEqual(ttlIntencionRegistroSeg({ ttlMinutos: 30 }), 26 * 3600);
  assert.strictEqual(ttlIntencionRegistroSeg({ ttlMinutos: 120, toleranciaPasadoSeg: 48 * 3600 }), 50.5 * 3600);
});

for (const almacen of ['memoria', 'redis']) {
  for (const [nombre, espera] of [['31 min', 31 * MIN], ['24 h 50 min', 24 * HORA + 50 * MIN]]) {
    test(`${almacen}: APPROVED que llega a los ${nombre} se registra y se anuncia`, async (t) => {
      const e = await escenario(t, almacen);
      const { cuerpo: i } = await e.intencion('total');
      e.avanzar(espera);
      const confirmado = esperar(e.admin, 'payment:confirmed', 1000);
      assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, REGISTRADO);
      assert.strictEqual((await confirmado).referencia_externa, i.referencia);
      assert.strictEqual(e.registros(), 1);
      assert.strictEqual((await e.s.almacenPagos.obtener(i.referencia)).estado, 'pagada');
    });
  }

  test(`${almacen}: DECLINED a los 31 min marca la intención rechazada y no anuncia nada`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(31 * MIN);
    const nada = esperar(e.admin, 'payment:confirmed', 200);
    assert.deepStrictEqual((await e.webhook(i.referencia, { estado: 'DECLINED' })).cuerpo, {
      ok: true, duplicado: false, registrado: false, estado: 'DECLINED',
    });
    assert.strictEqual(await nada, null);
    assert.strictEqual(e.registros(), 0);
    assert.strictEqual((await e.s.almacenPagos.obtener(i.referencia)).estado, 'rechazada');
  });

  test(`${almacen}: pasados 30 min, el mismo modo crea una referencia nueva aunque la vieja siga en el registro`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(31 * MIN);
    const nueva = await e.intencion('total');
    assert.strictEqual(nueva.status, 201);
    assert.notStrictEqual(nueva.cuerpo.referencia, i.referencia);
    assert.ok(await e.s.almacenPagos.obtener(i.referencia), 'la vieja sigue para su webhook');
  });

  test(`${almacen}: nunca reutiliza una intención vencida o por vencer, aunque la marca siga viva`, async (t) => {
    const e = await escenario(t, almacen);
    const sembrar = async (ref, msHastaVencer) => {
      await e.s.almacenPagos.guardarIntencion(ref, {
        id_mesa: 5, comensal: 'Ana', modo: 'total', monto_centavos: MONTO, estado: 'pendiente', expira_en: new Date(Date.now() + msHastaVencer).toISOString(),
      }, 93600);
      await e.s.almacenPagos.liberarPendiente(5, 'Ana', await e.s.almacenPagos.obtenerPendiente(5, 'Ana'));
      await e.s.almacenPagos.reservarPendiente(5, 'Ana', ref, 1800);
    };
    await sembrar('SD-5-1-vencida', -MIN);
    const a = await e.intencion('total');
    assert.deepStrictEqual([a.status, a.cuerpo.referencia === 'SD-5-1-vencida'], [201, false]);
    assert.strictEqual((await e.s.almacenPagos.obtener('SD-5-1-vencida')).estado, 'reemplazada');

    await sembrar('SD-5-1-por-vencer', 5 * MIN - 1000);
    const b = await e.intencion('total');
    assert.deepStrictEqual([b.status, b.cuerpo.referencia === 'SD-5-1-por-vencer'], [201, false]);

    await sembrar('SD-5-1-vigente', 5 * MIN + 1000);
    const c = await e.intencion('total');
    assert.deepStrictEqual([c.status, c.cuerpo.referencia], [200, 'SD-5-1-vigente']);
  });

  test(`${almacen}: repetir un eventId cuya intención va a vencer se trata como petición nueva`, async (t) => {
    // Con 10 min de plazo entra en el margen antes de que caduque la
    // idempotencia del eventId, que también dura 10 min.
    const e = await escenario(t, almacen, { PAGOS_TTL_MINUTOS: '10' });
    const eventId = crypto.randomUUID();
    const primera = await e.intencion('total', eventId);
    assert.strictEqual(primera.status, 201);
    e.avanzar(5 * MIN - 1000); // faltan 5 min 1 s
    assert.deepStrictEqual((await e.intencion('total', eventId)).cuerpo, primera.cuerpo, 'vigente: misma respuesta');
    e.avanzar(2000); // faltan 4 min 59 s
    const segunda = await e.intencion('total', eventId);
    assert.strictEqual(segunda.status, 201);
    assert.notStrictEqual(segunda.cuerpo.referencia, primera.cuerpo.referencia);
    assert.deepStrictEqual((await e.intencion('total', eventId)).cuerpo, segunda.cuerpo, 'la repetición ahora devuelve la nueva');
  });

  test(`${almacen}: una reemplazada pagada tarde se sigue registrando`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: vieja } = await e.intencion('total');
    assert.strictEqual((await e.intencion('igual')).status, 201);
    assert.strictEqual((await e.s.almacenPagos.obtener(vieja.referencia)).estado, 'reemplazada');
    e.avanzar(3 * HORA);
    assert.deepStrictEqual((await e.webhook(vieja.referencia)).cuerpo, REGISTRADO);
  });

  test(`${almacen}: límite del plazo por defecto: 26 h − 1 min se registra`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(26 * HORA - MIN);
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, REGISTRADO);
  });

  test(`${almacen}: límite del plazo por defecto: 26 h + 1 min ya es referencia_desconocida`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(26 * HORA + MIN);
    const alerta = esperar(e.admin, 'pago:alerta', 1000);
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, { ok: true, duplicado: false, registrado: false });
    assert.deepStrictEqual([(await alerta).motivo, e.registros()], ['referencia_desconocida', 0]);
  });

  test(`${almacen}: el mismo APPROVED tardío dos veces: un solo registro y un solo aviso`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(31 * MIN);
    let avisos = 0;
    e.admin.on('payment:confirmed', () => { avisos += 1; });
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, REGISTRADO);
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, { ok: true, duplicado: true });
    await esperar(e.admin, 'nunca', 200);
    assert.deepStrictEqual([avisos, e.registros()], [1, 1]);
  });

  test(`${almacen}: backend con 5xx en un APPROVED tardío: el reintento sí registra`, async (t) => {
    const e = await escenario(t, almacen);
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(31 * MIN);
    const correcto = e.registrar.respuesta;
    e.registrar.respuesta = () => ({ status: 503, cuerpo: null });
    assert.strictEqual((await e.webhook(i.referencia)).status, 503);
    e.registrar.respuesta = correcto;
    const confirmado = esperar(e.admin, 'payment:confirmed', 1000);
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, REGISTRADO);
    assert.ok(await confirmado);
    assert.strictEqual(e.registros(), 2, 'el 503 no consumió la clave de idempotencia');
  });

  test(`${almacen}: con 120 min de plazo y 48 h de tolerancia, un APPROVED a las 49 h se registra`, async (t) => {
    const e = await escenario(t, almacen, { PAGOS_TTL_MINUTOS: '120', PAGOS_WEBHOOK_TOLERANCIA_SEG: '172800' });
    const { cuerpo: i } = await e.intencion('total');
    e.avanzar(49 * HORA);
    assert.deepStrictEqual((await e.webhook(i.referencia)).cuerpo, REGISTRADO);
  });
}
