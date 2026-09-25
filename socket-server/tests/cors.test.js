const test = require('node:test');
const assert = require('node:assert');
const { levantar } = require('./helpers');
const { cargarConfig } = require('../src/config');

const PERMITIDO = 'http://localhost:5173';

test('rechaza una configuración insegura o incompleta', () => {
  assert.throws(() => cargarConfig({ CORS_ORIGINS: '*', JWT_SECRET: 's' }), /"\*"/);
  assert.throws(() => cargarConfig({ JWT_SECRET: 's' }), /CORS_ORIGINS/);
  assert.throws(() => cargarConfig({ CORS_ORIGINS: PERMITIDO }), /JWT_SECRET/);
});

test('handshake polling: origen permitido recibe ACAO, origen ajeno no', async () => {
  const s = await levantar();
  const pedir = (origin) => fetch(`${s.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  const ok = await pedir(PERMITIDO);
  const mal = await pedir('http://evil.example');
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), PERMITIDO);
  assert.notStrictEqual(mal.headers.get('access-control-allow-origin'), 'http://evil.example');
  await s.cerrar();
});

test('/health responde y hay preflight CORS para POST con Authorization', async () => {
  const s = await levantar();
  const h = await (await fetch(`${s.url}/health`)).json();
  assert.strictEqual(h.estado, 'ok');
  const pre = await fetch(`${s.url}/health`, {
    method: 'OPTIONS',
    headers: { Origin: PERMITIDO, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
  });
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), PERMITIDO);
  await s.cerrar();
});
