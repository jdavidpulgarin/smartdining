const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const webpush = require('web-push');
const { log, crearLog } = require('../src/log');
const { crearServicioPush, servicioDe } = require('../src/push');
const { notificarCambioEstado, resumirEnvio } = require('../src/suscripciones');

// T9: cada envío push deja una línea (host del servicio, código HTTP,
// caducada) y cada cambio de estado un resumen. Nunca el endpoint completo,
// las llaves de la suscripción ni el payload.

const llaves = webpush.generateVAPIDKeys();
const config = { vapidPublica: llaves.publicKey, vapidPrivada: llaves.privateKey, vapidSubject: 'mailto:equipo@smartdining.test' };

const aleatorio = (n = 24) => crypto.randomBytes(n).toString('base64url');
/** Una suscripción con forma real: el resto del endpoint y las llaves son únicos por dispositivo. */
const suscripcion = (host, extra = {}) => ({
  endpoint: `https://${host}/push/${aleatorio(40)}`,
  keys: { p256dh: aleatorio(65), auth: aleatorio(16) },
  comensal: 'Ana',
  ...extra,
});
const PAYLOAD = {
  titulo: 'Tu plato está listo', cuerpo: 'PED-20261113-0042', id_pedido: 42, estado: 'listo', url: '/seguimiento',
};

/** Cambia el log del módulo por uno que guarda las líneas JSON tal como saldrían (con su redacción). */
function capturarLog(t) {
  const lineas = [];
  const captura = crearLog({ nivel: 'debug', escribir: (linea) => lineas.push(linea) });
  const originales = { info: log.info, warn: log.warn, error: log.error };
  Object.assign(log, { info: captura.info, warn: captura.warn, error: captura.error });
  t.after(() => Object.assign(log, originales));
  return {
    lineas,
    de: (msg) => lineas.map((l) => JSON.parse(l)).filter((l) => l.msg === msg),
  };
}

/** Lo sensible de una suscripción y del payload no aparece en ninguna línea. */
function sinDatosSensibles(lineas, subs, payload = PAYLOAD) {
  const texto = lineas.join('\n');
  for (const s of subs) {
    assert.ok(!texto.includes(s.endpoint), 'el endpoint completo no sale');
    assert.ok(!texto.includes(s.endpoint.split('/').pop()), 'ni el identificador del dispositivo');
    assert.ok(!texto.includes(s.keys.p256dh), 'ni p256dh');
    assert.ok(!texto.includes(s.keys.auth), 'ni auth');
  }
  for (const v of [payload.titulo, payload.cuerpo]) assert.ok(!texto.includes(v), `ni el payload (${v})`);
  assert.ok(!texto.includes(llaves.privateKey), 'ni la llave VAPID privada');
  assert.ok(!texto.includes(llaves.publicKey), 'ni la pública');
}

/** webpush falso: responde lo que diga `respuesta(sub)` (un objeto) o lanza el error que devuelva. */
function webpushFalso(respuesta) {
  return {
    setVapidDetails() {},
    async sendNotification(sub) {
      const r = respuesta(sub);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}
const errorPush = (statusCode, body, code) => Object.assign(new Error(`Received unexpected response code ${statusCode}`), { statusCode, body, code });

test('servicioDe: solo el host; un endpoint raro da «desconocido»', () => {
  assert.strictEqual(servicioDe({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc:APA91b' }), 'fcm.googleapis.com');
  assert.strictEqual(servicioDe({ endpoint: 'https://web.push.apple.com/QGxkZWFk' }), 'web.push.apple.com');
  for (const s of [{}, { endpoint: 'no es url' }, { endpoint: 42 }, null]) assert.strictEqual(servicioDe(s), 'desconocido');
});

test('envío aceptado: una línea info con el host, el código y caducada:false; nada sensible', async (t) => {
  const log = capturarLog(t);
  const push = crearServicioPush(config, { webpush: webpushFalso(() => ({ statusCode: 201, body: '', headers: {} })) });
  const sub = suscripcion('web.push.apple.com');
  const r = await push.enviar(sub, PAYLOAD);
  assert.deepStrictEqual(r, {
    ok: true, caducada: false, servicio: 'web.push.apple.com', status: 201,
  });
  const [linea, ...otras] = log.de('push: enviado');
  assert.deepStrictEqual(otras, []);
  assert.deepStrictEqual(
    [linea.nivel, linea.servicio_push, linea.status, linea.caducada],
    ['info', 'web.push.apple.com', 201, false],
  );
  assert.strictEqual(linea.servicio, 'socket-server', 'no pisa el campo servicio del logger');
  sinDatosSensibles(log.lineas, [sub]);
});

test('suscripción caducada (404/410): info con caducada:true; no es un error', async (t) => {
  for (const status of [404, 410]) {
    const log = capturarLog(t);
    const push = crearServicioPush(config, { webpush: webpushFalso(() => errorPush(status, 'push subscription has unsubscribed or expired.')) });
    const sub = suscripcion('fcm.googleapis.com');
    const r = await push.enviar(sub, PAYLOAD);
    assert.deepStrictEqual([r.ok, r.caducada, r.status, r.servicio], [false, true, status, 'fcm.googleapis.com']);
    const [linea] = log.de('push: suscripción caducada');
    assert.deepStrictEqual([linea.nivel, linea.status, linea.caducada], ['info', status, true]);
    assert.deepStrictEqual(log.de('push: error al enviar'), []);
    sinDatosSensibles(log.lineas, [sub]);
  }
});

test('rechazo de Apple (403 BadJwtToken): error con la razón; el cuerpo no se copia si no es una palabra', async (t) => {
  const log = capturarLog(t);
  const sub = suscripcion('web.push.apple.com');
  let cuerpo = '{"reason":"BadJwtToken"}';
  const push = crearServicioPush(config, { webpush: webpushFalso(() => errorPush(403, cuerpo)) });
  await push.enviar(sub, PAYLOAD);
  cuerpo = JSON.stringify({ reason: `mira ${sub.endpoint}` });
  await push.enviar(sub, PAYLOAD);
  cuerpo = `<html>${sub.keys.auth}</html>`;
  await push.enviar(sub, PAYLOAD);
  const lineas = log.de('push: error al enviar');
  assert.strictEqual(lineas.length, 3);
  assert.deepStrictEqual([lineas[0].nivel, lineas[0].status, lineas[0].caducada, lineas[0].razon], ['error', 403, false, 'BadJwtToken']);
  assert.ok(!('razon' in lineas[1]) && !('razon' in lineas[2]), 'una razón que no es una palabra corta no se registra');
  sinDatosSensibles(log.lineas, [sub]);
});

test('sin respuesta HTTP (red): status null y el código de red; el mensaje del error no sale', async (t) => {
  const log = capturarLog(t);
  const sub = suscripcion('updates.push.services.mozilla.com');
  const err = Object.assign(new Error(`connect ECONNRESET ${sub.endpoint}`), { code: 'ECONNRESET' });
  const push = crearServicioPush(config, { webpush: webpushFalso(() => err) });
  const r = await push.enviar(sub, PAYLOAD);
  assert.deepStrictEqual([r.ok, r.caducada, r.status, r.motivo], [false, false, null, 'error']);
  const [linea] = log.de('push: error al enviar');
  assert.deepStrictEqual([linea.status, linea.codigo, linea.servicio_push], [null, 'ECONNRESET', 'updates.push.services.mozilla.com']);
  sinDatosSensibles(log.lineas, [sub]);
});

test('sin VAPID: no se envía ni se registra nada por envío', async (t) => {
  const log = capturarLog(t);
  const push = crearServicioPush({});
  assert.deepStrictEqual(await push.enviar(suscripcion('fcm.googleapis.com'), PAYLOAD), { ok: false, caducada: false, motivo: 'deshabilitado' });
  assert.deepStrictEqual(log.de('push: enviado'), []);
});

/** ctx mínimo de notificarCambioEstado con el servicio push real y un webpush falso. */
function ctxDe(subs, respuesta, { duenos = ['Ana'] } = {}) {
  const quitadas = [];
  return {
    quitadas,
    push: crearServicioPush(config, { webpush: webpushFalso(respuesta) }),
    suscripciones: {
      async listar() { return subs; },
      async quitar(idMesa, endpoint) { quitadas.push(endpoint); },
    },
    duenosPedidos: { async obtener() { return duenos; } },
  };
}
const cambio = (estado) => ({
  id_mesa: 5, id_pedido: 42, codigo_pedido: 'PED-20261113-0042', estado,
});

test('resumen por cambio de estado: enviados, fallidos, caducados y cuántas por servicio; borra las caducadas', async (t) => {
  const log = capturarLog(t);
  const subs = [
    suscripcion('fcm.googleapis.com'),
    suscripcion('fcm.googleapis.com'),
    suscripcion('web.push.apple.com'),
    suscripcion('updates.push.services.mozilla.com'),
  ];
  const respuestas = new Map([
    [subs[0].endpoint, { statusCode: 201 }],
    [subs[1].endpoint, errorPush(410, 'expired')],
    [subs[2].endpoint, errorPush(403, '{"reason":"BadJwtToken"}')],
    [subs[3].endpoint, { statusCode: 201 }],
  ]);
  const ctx = ctxDe(subs, (s) => respuestas.get(s.endpoint));
  await notificarCambioEstado(ctx, cambio('en_preparacion'));

  assert.deepStrictEqual(ctx.quitadas, [subs[1].endpoint], 'la caducada se borra');
  assert.strictEqual(log.de('push: enviado').length + log.de('push: suscripción caducada').length + log.de('push: error al enviar').length, 4, 'una línea por envío');
  const [resumen, ...otros] = log.de('push: resumen del envío');
  assert.deepStrictEqual(otros, []);
  const { ts, nivel, servicio, msg, ...campos } = resumen;
  assert.strictEqual(nivel, 'info');
  assert.deepStrictEqual(campos, {
    estado: 'en_preparacion',
    destinatarios: 4,
    enviados: 2,
    fallidos: 1,
    caducados: 1,
    servicios: { 'fcm.googleapis.com': 2, 'web.push.apple.com': 1, 'updates.push.services.mozilla.com': 1 },
  });
  sinDatosSensibles(log.lineas, subs, { titulo: 'Tu pedido está en preparación', cuerpo: 'PED-20261113-0042' });
  assert.ok(!log.lineas.join('\n').includes('"Ana"'), 'ni el alias del comensal');
});

test('resumen con 0 destinatarios: también se registra (nadie de la mesa activó avisos)', async (t) => {
  const log = capturarLog(t);
  await notificarCambioEstado(ctxDe([], () => ({ statusCode: 201 })), cambio('en_preparacion'));
  const [resumen] = log.de('push: resumen del envío');
  assert.deepStrictEqual(
    [resumen.destinatarios, resumen.enviados, resumen.fallidos, resumen.caducados, resumen.servicios],
    [0, 0, 0, 0, {}],
  );
});

test('«listo» solo a quien lo pidió: el resumen cuenta a los destinatarios filtrados', async (t) => {
  const log = capturarLog(t);
  const subs = [suscripcion('fcm.googleapis.com', { comensal: 'Ana' }), suscripcion('web.push.apple.com', { comensal: 'Beto' })];
  await notificarCambioEstado(ctxDe(subs, () => ({ statusCode: 201 }), { duenos: ['Ana'] }), cambio('listo'));
  const [resumen] = log.de('push: resumen del envío');
  assert.deepStrictEqual([resumen.destinatarios, resumen.enviados, resumen.servicios], [1, 1, { 'fcm.googleapis.com': 1 }]);
});

test('un estado sin aviso (recibido, entregado) no envía ni deja resumen', async (t) => {
  const log = capturarLog(t);
  for (const estado of ['recibido', 'entregado', 'pagado']) {
    await notificarCambioEstado(ctxDe([suscripcion('fcm.googleapis.com')], () => ({ statusCode: 201 })), cambio(estado));
  }
  assert.deepStrictEqual(log.lineas, []);
});

test('resumirEnvio: un resultado sin servicio cuenta como «desconocido»', () => {
  assert.deepStrictEqual(resumirEnvio('cancelado', [{ ok: true }, { ok: false, caducada: false }]), {
    estado: 'cancelado', destinatarios: 2, enviados: 1, fallidos: 1, caducados: 0, servicios: { desconocido: 2 },
  });
});
