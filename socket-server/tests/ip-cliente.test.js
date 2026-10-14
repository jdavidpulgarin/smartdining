const test = require('node:test');
const assert = require('node:assert');
const { io: cliente } = require('socket.io-client');
const { parsearProxiesConfiables, crearIpCliente } = require('../src/ip-cliente');
const { cargarConfig } = require('../src/config');
const { log } = require('../src/log');
const { levantar, tokenPantalla, ENV_BASE, ORIGEN } = require('./helpers');
const { WOMPI_ENV, backendFalso, pasarelaFalsa } = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');

const NGINX = '172.31.250.10';
const CLIENTE = '203.0.113.7';
const peticion = (remota, cabeceras = {}) => ({ socket: { remoteAddress: remota }, headers: cabeceras });

test('sin TRUST_PROXY: siempre la IP de la conexión, X-Real-IP se ignora', () => {
  const ip = crearIpCliente(parsearProxiesConfiables(''));
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': CLIENTE })), NGINX);
  assert.strictEqual(ip(peticion('::ffff:198.51.100.4')), '198.51.100.4');
  assert.strictEqual(ip(peticion(undefined)), null);
  assert.strictEqual(parsearProxiesConfiables(undefined), null);
});

test('desde el proxy de confianza: X-Real-IP', () => {
  const ip = crearIpCliente(parsearProxiesConfiables(NGINX));
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': CLIENTE })), CLIENTE);
  // Docker puede entregar la IPv4 de nginx como IPv4 mapeada en IPv6.
  assert.strictEqual(ip(peticion(`::ffff:${NGINX}`, { 'x-real-ip': CLIENTE })), CLIENTE);
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': '2001:db8::5' })), '2001:db8::5');
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': `::ffff:${CLIENTE}` })), CLIENTE);
});

test('abuso: X-Real-IP enviada por alguien que NO es el proxy se ignora', () => {
  const ip = crearIpCliente(parsearProxiesConfiables(NGINX));
  assert.strictEqual(ip(peticion('172.31.250.11', { 'x-real-ip': '1.1.1.1' })), '172.31.250.11');
  assert.strictEqual(ip(peticion(CLIENTE, { 'x-real-ip': '127.0.0.1' })), CLIENTE);
});

test('desde el proxy, una X-Real-IP ausente, repetida o que no es IP → IP de la conexión', () => {
  const ip = crearIpCliente(parsearProxiesConfiables(NGINX));
  assert.strictEqual(ip(peticion(NGINX)), NGINX);
  // Node une las cabeceras repetidas con ", ": deja de ser una IP.
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': `${CLIENTE}, 1.1.1.1` })), NGINX);
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': 'localhost' })), NGINX);
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': '999.1.1.1' })), NGINX);
  assert.strictEqual(ip(peticion(NGINX, { 'x-real-ip': ['1.1.1.1'] })), NGINX);
});

test('rangos CIDR e IPv6, separados por comas', () => {
  const ip = crearIpCliente(parsearProxiesConfiables(' 10.0.0.0/24 , fd00::/64 '));
  assert.strictEqual(ip(peticion('10.0.0.200', { 'x-real-ip': CLIENTE })), CLIENTE);
  assert.strictEqual(ip(peticion('10.0.1.1', { 'x-real-ip': CLIENTE })), '10.0.1.1');
  assert.strictEqual(ip(peticion('fd00::9', { 'x-real-ip': CLIENTE })), CLIENTE);
  assert.strictEqual(ip(peticion('fd01::9', { 'x-real-ip': CLIENTE })), 'fd01::9');
});

test('TRUST_PROXY inválido o que confía en todo Internet → no arranca', () => {
  const arrancar = (valor) => () => cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE, TRUST_PROXY: valor });
  for (const malo of ['nginx', '10.0.0.0/33', '10.0.0.0/x', '10.0.0.0/8/1', '1.2.3', 'fd00::/129']) {
    assert.throws(arrancar(malo), /TRUST_PROXY/, malo);
  }
  assert.throws(arrancar('0.0.0.0/0'), /todo Internet/);
  assert.throws(arrancar('::/0'), /todo Internet/);
  assert.strictEqual(cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE }).proxiesConfiables, null);
});

// --- De punta a punta: la IP que llega a los logs.

async function servidorConLog(t, extraEnv) {
  const { pasarela } = pasarelaFalsa({});
  const s = await levantar({ ...WOMPI_ENV, ...extraEnv }, { backend: backendFalso(), pasarela });
  const avisos = t.mock.method(log, 'warn');
  const infos = t.mock.method(log, 'info');
  t.after(() => s.cerrar());
  const webhookMalo = () => fetch(`${s.url}/pagos/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': CLIENTE },
    body: JSON.stringify(eventoWompi({ secreto: 'test_events_otro', referencia: 'SD-5-1-x' })),
  });
  const ipLog = (espia, mensaje) => espia.mock.calls.find((c) => c.arguments[0] === mensaje)?.arguments[1].ip;
  return { s, webhookMalo, ipLog, avisos, infos };
}

// Las pruebas conectan por localhost: la conexión llega desde 127.0.0.1 o ::1.
const LOOPBACK = '127.0.0.1,::1';

test('webhook rechazado: el log trae la IP real si la petición viene del proxy', async (t) => {
  const { webhookMalo, ipLog, avisos } = await servidorConLog(t, { TRUST_PROXY: LOOPBACK });
  assert.strictEqual((await webhookMalo()).status, 400);
  assert.strictEqual(ipLog(avisos, 'pagos: webhook rechazado'), CLIENTE);
});

test('webhook rechazado sin TRUST_PROXY: un X-Real-IP falso no llega al log', async (t) => {
  const { webhookMalo, ipLog, avisos } = await servidorConLog(t, {});
  assert.strictEqual((await webhookMalo()).status, 400);
  assert.match(ipLog(avisos, 'pagos: webhook rechazado'), /^(127\.0\.0\.1|::1)$/);
});

test('socket conectado: el log trae la IP real del handshake detrás del proxy', async (t) => {
  for (const [env, esperada] of [[{ TRUST_PROXY: LOOPBACK }, CLIENTE], [{}, null]]) {
    const { s, ipLog, infos } = await servidorConLog(t, env);
    const c = cliente(s.url, {
      auth: { token: tokenPantalla(5) }, transports: ['websocket'], reconnection: false, extraHeaders: { 'X-Real-IP': CLIENTE },
    });
    await new Promise((res, rej) => { c.on('connect', res); c.on('connect_error', rej); });
    c.close();
    const ip = ipLog(infos, 'socket conectado');
    if (esperada) assert.strictEqual(ip, esperada);
    else assert.match(ip, /^(127\.0\.0\.1|::1)$/);
    infos.mock.resetCalls();
  }
});
