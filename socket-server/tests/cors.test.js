const test = require('node:test');
const assert = require('node:assert');
const { io: cliente } = require('socket.io-client');
const { cargarConfig } = require('../src/config');
const { crearServidor } = require('../src/servidor');

const PERMITIDO = 'http://localhost:5173';

async function levantar() {
  const config = cargarConfig({ CORS_ORIGINS: PERMITIDO, PORT: '0' });
  const { httpServer, io } = crearServidor(config);
  await new Promise((r) => httpServer.listen(0, r));
  return { httpServer, io, url: `http://localhost:${httpServer.address().port}` };
}

test('rechaza CORS_ORIGINS con comodín o vacío', () => {
  assert.throws(() => cargarConfig({ CORS_ORIGINS: '*' }));
  assert.throws(() => cargarConfig({}));
});

test('handshake polling: origen permitido recibe ACAO, origen ajeno no', async () => {
  const s = await levantar();
  const pedir = (origin) => fetch(`${s.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  const ok = await pedir(PERMITIDO);
  const mal = await pedir('http://evil.example');
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), PERMITIDO);
  assert.notStrictEqual(mal.headers.get('access-control-allow-origin'), 'http://evil.example');
  s.io.close();
});

test('un cliente se conecta y /health responde', async () => {
  const s = await levantar();
  const c = cliente(s.url, { transports: ['websocket'] });
  await new Promise((res, rej) => { c.on('connect', res); c.on('connect_error', rej); });
  const h = await (await fetch(`${s.url}/health`)).json();
  assert.strictEqual(h.estado, 'ok');
  c.close();
  s.io.close();
});
