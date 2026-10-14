const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { crearLog, redactar, REDACTADO } = require('../src/log');
const { firmar } = require('./helpers');

function capturar(opciones = {}) {
  const lineas = [];
  const log = crearLog({ nivel: 'debug', ahora: () => '2026-10-11T00:00:00.000Z', escribir: (l) => lineas.push(JSON.parse(l)), ...opciones });
  return { log, lineas };
}

test('una línea JSON por evento con ts, nivel, servicio y mensaje', () => {
  const { log, lineas } = capturar();
  log.info('socket conectado', { socket: 'abc', rol: 'comensal', id_mesa: 5 });
  assert.deepStrictEqual(lineas[0], {
    ts: '2026-10-11T00:00:00.000Z', nivel: 'info', servicio: 'socket-server', msg: 'socket conectado', socket: 'abc', rol: 'comensal', id_mesa: 5,
  });
});

test('respeta el nivel mínimo', () => {
  const { log, lineas } = capturar({ nivel: 'warn' });
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  assert.deepStrictEqual(lineas.map((l) => l.nivel), ['warn', 'error']);
  const silencio = capturar({ nivel: 'silencio' });
  silencio.log.error('nada');
  assert.strictEqual(silencio.lineas.length, 0);
});

test('redacta por nombre de campo, también anidados', () => {
  const r = redactar({
    headers: { authorization: 'Bearer abc', 'x-internal-key': 'k', 'content-type': 'json' },
    token_qr: 'v1.x.y',
    firma_integridad: 'f',
    subscription: { endpoint: 'https://fcm', keys: { p256dh: 'p', auth: 'a' } },
    customer_email: 'a@b.co',
    id_mesa: 5,
  });
  assert.deepStrictEqual(r, {
    headers: { authorization: REDACTADO, 'x-internal-key': REDACTADO, 'content-type': 'json' },
    token_qr: REDACTADO,
    firma_integridad: REDACTADO,
    subscription: REDACTADO,
    customer_email: REDACTADO,
    id_mesa: 5,
  });
});

test('redacta por forma del valor, incluso dentro del mensaje', () => {
  const { log, lineas } = capturar();
  const jwt = firmar({ id_mesa: 5, rol: 'comensal' });
  const hex = crypto.randomBytes(32).toString('hex');
  const qr = `v1.${Buffer.from('{"m":5,"iat":1,"exp":2,"sid":"abc"}').toString('base64url')}.${crypto.randomBytes(32).toString('base64url')}`;
  log.warn(`falló con ${jwt} y Bearer ${jwt}`, {
    detalle: `clave ${hex} qr ${qr} wompi prv_test_abc123 test_events_xyz`,
  });
  const texto = JSON.stringify(lineas[0]);
  for (const secreto of [jwt, hex, qr, 'prv_test_abc123', 'test_events_xyz']) {
    assert.ok(!texto.includes(secreto), `no debe aparecer: ${secreto.slice(0, 20)}`);
  }
  assert.match(lineas[0].msg, /falló con \[REDACTADO\]/);
});

test('los errores se registran sin pila (salvo LOG_NIVEL=debug) y sin secretos en el mensaje', () => {
  const { log, lineas } = capturar();
  const err = Object.assign(new Error(`timeout llamando con ${'a'.repeat(64)}`), { codigo: 'BACKEND_TIMEOUT' });
  log.error('falló', { error: err });
  assert.deepStrictEqual(lineas[0].error, { nombre: 'Error', mensaje: `timeout llamando con ${REDACTADO}`, codigo: 'BACKEND_TIMEOUT' });
});

test('no explota con buffers, ciclos profundos ni textos enormes', () => {
  const profundo = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
  const r = redactar({ cuerpo: Buffer.from('secreto'), profundo, largo: 'x'.repeat(5000) });
  assert.strictEqual(r.cuerpo, '[buffer 7 bytes]');
  assert.strictEqual(r.profundo.a.b.c.d, '[…]', 'se corta a los 5 niveles');
  assert.ok(r.largo.length < 2100);
});

test('hijo agrega campos fijos', () => {
  const { log, lineas } = capturar();
  log.hijo({ modulo: 'pagos' }).info('ok', { id_mesa: 5 });
  assert.strictEqual(lineas[0].modulo, 'pagos');
  assert.strictEqual(lineas[0].id_mesa, 5);
});
