// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// T13: el access log de nginx no guarda tokens QR. Se leen los `map` REALES de
// la plantilla y se aplican en cadena, como nginx, a peticiones y Referer de
// ejemplo. Las regex de los map son PCRE; las que usa la plantilla (grupos
// con nombre, \s, \S, lookahead, ~* = sin mayúsculas) se escriben igual en
// JavaScript. La validación con nginx de verdad es `nginx -t` (validar-nginx.sh)
// y una petición real en staging (docs/despliegue.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLANTILLA = fs.readFileSync(path.join(__dirname, '../nginx/templates/smartdining.conf.template'), 'utf8');
const ACCESS_LOG = 'access_log /var/log/nginx/access.log sd_sin_token;';

/** map $origen $destino { "~*regex" "valor"; default $x; } -> { origen, destino, regla, porDefecto } */
function leerMaps(texto) {
  const maps = new Map();
  const re = /^map \$(\w+) \$(\w+) \{\n([\s\S]*?)\n\}/gm;
  for (const [, origen, destino, cuerpo] of texto.matchAll(re)) {
    const regla = /^\s*"(~\*?)(.+)"\s+"(.*)";\s*$/m.exec(cuerpo);
    const porDefecto = /^\s*default \$(\w+);\s*$/m.exec(cuerpo);
    if (!regla || !porDefecto) continue;
    maps.set(destino, {
      origen,
      regex: new RegExp(regla[2], regla[1] === '~*' ? 'i' : ''),
      // "${sd_a}***${sd_b}" -> reemplazo con los grupos con nombre.
      valor: regla[3],
      porDefecto: porDefecto[1],
    });
  }
  return maps;
}

const MAPS = leerMaps(PLANTILLA);

/** Valor de la variable nginx `nombre` con $request y $http_referer dados. */
function evaluar(nombre, vars) {
  if (nombre in vars) return vars[nombre];
  const m = MAPS.get(nombre);
  assert.ok(m, `la plantilla no define $${nombre}`);
  const entrada = evaluar(m.origen, vars);
  const r = m.regex.exec(entrada);
  if (!r) return evaluar(m.porDefecto, { ...vars, [m.origen]: entrada });
  return m.valor.replace(/\$\{(\w+)\}/g, (_, g) => r.groups[g] ?? '');
}

const peticion = (request) => evaluar('sd_req_sin_token', { request, http_referer: '-' });
const referer = (http_referer) => evaluar('sd_ref_sin_token', { request: 'GET / HTTP/2.0', http_referer });

// Con la forma del token real (v1.<payload>.<firma>), pero inventado.
const TOKEN = 'v1.eyJtIjoyLCJzaWQiOiJmYWxzbyJ9.FirmaFalsaDePrueba_-123';

test('cada server de la plantilla escribe su access log con el formato sin tokens', () => {
  const servers = PLANTILLA.split(/^server \{$/m).slice(1);
  assert.strictEqual(servers.length, 7);
  for (const s of servers) {
    const nombre = /server_name ([^;]+);/.exec(s)[1];
    assert.ok(s.includes(ACCESS_LOG), `falta "${ACCESS_LOG}" en ${nombre}`);
  }
  // Ningún access_log con otro formato (p. ej. "main") ni a nivel http.
  const todos = PLANTILLA.match(/^\s*access_log .*$/gm).map((l) => l.trim());
  assert.deepStrictEqual([...new Set(todos)], [ACCESS_LOG]);
});

test('log_format sd_sin_token es el "main" de nginx con $request y $http_referer enmascarados', () => {
  const f = /log_format sd_sin_token ([\s\S]*?);\n/.exec(PLANTILLA)[1];
  assert.ok(f.includes('"$sd_req_sin_token"') && f.includes('"$sd_ref_sin_token"'));
  assert.ok(!/\$request\b|\$http_referer\b|\$request_uri\b|\$args\b|\$query_string\b/.test(f), 'no debe usar las variables con token');
  for (const v of ['$remote_addr', '$remote_user', '$time_local', '$status', '$body_bytes_sent', '$http_user_agent', '$http_x_forwarded_for']) {
    assert.ok(f.includes(v), `falta ${v}`);
  }
});

test('la ruta /mesas/qr/<token>/sesion (con y sin /v1) queda con ***', () => {
  assert.strictEqual(peticion(`POST /api/mesas/qr/${TOKEN}/sesion HTTP/2.0`), 'POST /api/mesas/qr/***/sesion HTTP/2.0');
  assert.strictEqual(peticion(`POST /api/v1/mesas/qr/${TOKEN}/sesion HTTP/1.1`), 'POST /api/v1/mesas/qr/***/sesion HTTP/1.1');
  assert.strictEqual(peticion(`GET /api/mesas/qr/${TOKEN}?x=1 HTTP/2.0`), 'GET /api/mesas/qr/***?x=1 HTTP/2.0');
});

test('el parámetro token= del enlace del QR queda con ***, esté donde esté', () => {
  assert.strictEqual(peticion(`GET /?token=${TOKEN}&mesa=2 HTTP/2.0`), 'GET /?token=***&mesa=2 HTTP/2.0');
  assert.strictEqual(peticion(`GET /mesa?mesa=2&token=${TOKEN} HTTP/2.0`), 'GET /mesa?mesa=2&token=*** HTTP/2.0');
  assert.strictEqual(peticion(`GET /?Token=${TOKEN} HTTP/2.0`), 'GET /?Token=*** HTTP/2.0');
});

test('hasta dos parámetros *token en la misma petición', () => {
  assert.strictEqual(
    peticion(`GET /a?token=${TOKEN}&refresh_token=OTRO-SECRETO&x=1 HTTP/2.0`),
    'GET /a?token=***&refresh_token=***&x=1 HTTP/2.0',
  );
  assert.strictEqual(peticion(`GET /a?access_token=${TOKEN} HTTP/2.0`), 'GET /a?access_token=*** HTTP/2.0');
});

test('ruta QR y query con token en la misma petición', () => {
  assert.strictEqual(
    peticion(`POST /api/mesas/qr/${TOKEN}/sesion?token=${TOKEN} HTTP/2.0`),
    'POST /api/mesas/qr/***/sesion?token=*** HTTP/2.0',
  );
});

test('el Referer con el enlace del QR queda con ***', () => {
  assert.strictEqual(referer(`https://app.ejemplo.co/?token=${TOKEN}&mesa=3`), 'https://app.ejemplo.co/?token=***&mesa=3');
  assert.strictEqual(referer(`https://app.ejemplo.co/mesa/3?token=${TOKEN}`), 'https://app.ejemplo.co/mesa/3?token=***');
  assert.strictEqual(referer('-'), '-');
});

test('lo que no lleva token no cambia', () => {
  for (const r of [
    'GET /api/menu HTTP/2.0',
    'GET /assets/index-abc.js?v=1 HTTP/2.0',
    'POST /api/mesas/2/rotar-qr HTTP/2.0',
    'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1',
    'GET /api/pedidos?tokens=3 HTTP/2.0',
    '-',
  ]) {
    assert.strictEqual(peticion(r), r);
  }
  assert.strictEqual(referer('https://staff.ejemplo.co/'), 'https://staff.ejemplo.co/');
});

test('ninguna línea de ejemplo conserva el token', () => {
  const casos = [
    `POST /api/mesas/qr/${TOKEN}/sesion HTTP/2.0`,
    `GET /?token=${TOKEN}&mesa=2 HTTP/2.0`,
    `GET /?mesa=2&token=${encodeURIComponent(TOKEN)} HTTP/2.0`,
    `GET /a?token=${TOKEN}&id_token=${TOKEN} HTTP/2.0`,
  ];
  for (const c of casos) assert.ok(!peticion(c).includes(TOKEN.slice(3, 20)), c);
  assert.ok(!referer(`https://app.ejemplo.co/?token=${TOKEN}`).includes(TOKEN.slice(3, 20)));
});
