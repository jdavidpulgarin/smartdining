const test = require('node:test');
const assert = require('node:assert');
const webpush = require('web-push');
const { crearServicioPush } = require('../src/push');
const { levantar } = require('./helpers');

const llaves = webpush.generateVAPIDKeys();
const config = { vapidPublica: llaves.publicKey, vapidPrivada: llaves.privateKey, vapidSubject: 'mailto:equipo@smartdining.test' };

test('las llaves VAPID generadas tienen el formato esperado', () => {
  // P-256 sin comprimir = 65 bytes; la privada = 32 bytes (base64url).
  assert.strictEqual(Buffer.from(llaves.publicKey, 'base64url').length, 65);
  assert.strictEqual(Buffer.from(llaves.privateKey, 'base64url').length, 32);
});

test('sin llaves el servicio queda deshabilitado y no lanza', async () => {
  const push = crearServicioPush({});
  assert.strictEqual(push.habilitado, false);
  assert.deepStrictEqual(await push.enviar({}, {}), { ok: false, caducada: false, motivo: 'deshabilitado' });
});

test('llaves o subject inválidos hacen fallar el arranque', () => {
  assert.throws(() => crearServicioPush({ ...config, vapidSubject: 'no-es-un-subject' }));
  assert.throws(() => crearServicioPush({ ...config, vapidPublica: 'corta' }));
});

test('enviar: éxito, suscripción caducada (410/404) y error transitorio', async () => {
  let resultado;
  const falso = {
    setVapidDetails() {},
    async sendNotification(sub, cuerpo, opts) {
      falso.ultimo = { sub, cuerpo, opts };
      if (resultado) throw Object.assign(new Error('x'), { statusCode: resultado });
    },
  };
  const push = crearServicioPush(config, { webpush: falso });
  assert.deepStrictEqual(await push.enviar({ endpoint: 'e' }, { titulo: 'Hola' }), { ok: true });
  assert.deepStrictEqual(JSON.parse(falso.ultimo.cuerpo), { titulo: 'Hola' });
  assert.strictEqual(falso.ultimo.opts.TTL, 3600);
  resultado = 410;
  assert.strictEqual((await push.enviar({}, {})).caducada, true);
  resultado = 404;
  assert.strictEqual((await push.enviar({}, {})).caducada, true);
  resultado = 500;
  assert.strictEqual((await push.enviar({}, {})).caducada, false);
});

test('GET /push/clave-publica entrega la clave pública, nunca la privada', async () => {
  const s = await levantar({ VAPID_PUBLIC_KEY: config.vapidPublica, VAPID_PRIVATE_KEY: config.vapidPrivada, VAPID_SUBJECT: config.vapidSubject });
  const r = await fetch(`${s.url}/push/clave-publica`);
  const texto = await r.text();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(texto).clave, llaves.publicKey);
  assert.ok(!texto.includes(llaves.privateKey));
  await s.cerrar();

  const sinPush = await levantar();
  assert.strictEqual((await fetch(`${sinPush.url}/push/clave-publica`)).status, 503);
  await sinPush.cerrar();
});
