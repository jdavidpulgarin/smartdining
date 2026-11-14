// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// Permissions-Policy y CSP por sitio: la cámara solo en app. (escáner de QR de
// la PWA) y el worker blob: de qr-scanner solo en la CSP de app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', 'nginx');
const PLANTILLA = fs.readFileSync(path.join(RAIZ, 'templates', 'smartdining.conf.template'), 'utf8');
const SEGURIDAD = fs.readFileSync(path.join(RAIZ, 'snippets', 'seguridad.conf'), 'utf8');
const DOMINIO = 'staging.ejemplo.com';

/** El map $host $sd_permisos de la plantilla, con ${DOMINIO} sustituido, como hace envsubst. */
function mapaPermisos() {
  const bloque = PLANTILLA.match(/map \$host \$sd_permisos \{([\s\S]*?)\n\}/);
  assert.ok(bloque, 'la plantilla define map $host $sd_permisos');
  const entradas = new Map();
  for (const linea of bloque[1].split('\n')) {
    const m = linea.trim().match(/^(\S+)\s+"([^"]*)";$/);
    if (m) entradas.set(m[1].replace('${DOMINIO}', DOMINIO), m[2]);
  }
  return entradas;
}
const permisosDe = (mapa, host) => (mapa.has(host) ? mapa.get(host) : mapa.get('default'));

/** La CSP ($csp) del server con ese server_name. */
function cspDe(sub) {
  const re = new RegExp(`server_name ${sub.replace('.', '\\.')}\\$\\{DOMINIO\\};[\\s\\S]*?set \\$csp "([^"]*)";`);
  const m = PLANTILLA.match(re);
  assert.ok(m, `CSP de ${sub}`);
  return m[1];
}
const directiva = (csp, nombre) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${nombre} `)) || '');

test('seguridad.conf toma la Permissions-Policy del map (no un valor fijo)', () => {
  assert.match(SEGURIDAD, /^add_header Permissions-Policy \$sd_permisos always;$/m);
  assert.doesNotMatch(SEGURIDAD, /add_header Permissions-Policy "/, 'ningún valor fijo que pise el del map');
});

test('cámara solo en app. y solo para sí misma; staff., cocina., api., rt. y el dominio, sin cámara', () => {
  const mapa = mapaPermisos();
  assert.strictEqual(permisosDe(mapa, `app.${DOMINIO}`), 'camera=(self), microphone=(), geolocation=()');
  for (const host of [`staff.${DOMINIO}`, `cocina.${DOMINIO}`, `api.${DOMINIO}`, `rt.${DOMINIO}`, DOMINIO, 'otro.ejemplo.com']) {
    assert.strictEqual(permisosDe(mapa, host), 'camera=(), microphone=(), geolocation=()', host);
  }
  // Nadie más tiene una entrada propia, y ninguna abre micrófono ni ubicación.
  assert.deepStrictEqual([...mapa.keys()].sort(), [`app.${DOMINIO}`, 'default'].sort());
  for (const valor of mapa.values()) {
    assert.match(valor, /microphone=\(\)/);
    assert.match(valor, /geolocation=\(\)/);
    assert.doesNotMatch(valor, /camera=\*|camera=\(\s*\*/, 'nunca cámara para otros orígenes');
  }
});

test('CSP: worker-src blob: solo en app. (el worker de qr-scanner); el resto igual que antes', () => {
  assert.strictEqual(directiva(cspDe('app.'), 'worker-src'), "worker-src 'self' blob:");
  // script-src no cambia: el chunk del worker sale del mismo origen y el worker blob: lo cubre worker-src.
  assert.strictEqual(directiva(cspDe('app.'), 'script-src'), "script-src 'self' https://checkout.wompi.co");
  for (const sub of ['staff.', 'cocina.']) {
    assert.doesNotMatch(cspDe(sub), /blob:/, `${sub} sin blob:`);
  }
});
