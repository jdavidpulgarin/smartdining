// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// Sitio público en el raíz del dominio: plantilla de nginx, X-Robots-Tag por
// entorno, www, CSP, CORS, Dockerfile, certificado y CI. Lee los archivos del
// repo; el nginx -t real se hace en el VPS con validar-nginx.sh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const PLANTILLA = leer('infra/nginx/templates/smartdining.conf.template');
const SEGURIDAD = leer('infra/nginx/snippets/seguridad.conf');
const CABECERAS = leer('infra/nginx/snippets/cabeceras-sitio.conf');
const COMPOSE = leer('docker-compose.prod.yml');
const DOCKERFILE = leer('infra/nginx/Dockerfile');
const CERT = leer('infra/scripts/primer-certificado.sh');
const CI = leer('.github/workflows/ci.yml');

/** La plantilla con ${DOMINIO} y ${NGINX_PROYECTO} sustituidos, como hace envsubst. */
function config(dominio, proyecto) {
  return PLANTILLA.replaceAll('${DOMINIO}', dominio).replaceAll('${NGINX_PROYECTO}', proyecto);
}

/** Bloques "server { … }" de primer nivel. */
function servers(conf) {
  const lista = [];
  const re = /^server \{$/gm;
  let m;
  while ((m = re.exec(conf))) {
    let nivel = 0;
    let i = m.index;
    for (; i < conf.length; i++) {
      if (conf[i] === '{') nivel++;
      if (conf[i] === '}' && --nivel === 0) break;
    }
    lista.push(conf.slice(m.index, i + 1));
  }
  return lista;
}
const serverDe = (conf, nombre, puerto) =>
  servers(conf).find((s) => s.includes(`listen ${puerto}`) && new RegExp(`server_name[^;]*\\s${nombre.replaceAll('.', '\\.')}[\\s;]`).test(s));

/** Evalúa el map $sd_robots como nginx: coincidencia exacta de la clave o default. */
function robots(conf, host) {
  const bloque = conf.match(/map "\$host\|([^"]*)" \$sd_robots \{([\s\S]*?)\n\}/);
  assert.ok(bloque, 'falta el map $sd_robots');
  const clave = `${host}|${bloque[1]}`;
  let valor = null;
  for (const linea of bloque[2].split('\n')) {
    const m = linea.trim().match(/^"?([^"\s]+)"?\s+"([^"]*)";$/);
    if (!m) continue;
    if (m[1] === 'default' && valor === null) valor = m[2];
    if (m[1] === clave) return m[2];
  }
  return valor;
}

const PROD = config('smartdining.com.co', 'smartdining');
const STAGING = config('staging.smartdining.com.co', 'smartdining-staging');
const SUBDOMINIOS = ['app', 'staff', 'cocina', 'api', 'rt'];

test('el raíz sirve el sitio (200 con try_files), ya no hace 301 a app.', () => {
  for (const conf of [PROD, STAGING]) {
    const dominio = conf === PROD ? 'smartdining.com.co' : 'staging.smartdining.com.co';
    const raiz = servers(conf).find((s) => s.includes('listen 443') && s.includes(`server_name ${dominio};`));
    assert.ok(raiz, `falta el server 443 de ${dominio}`);
    assert.match(raiz, /root \/usr\/share\/nginx\/html\/sitio;/);
    assert.match(raiz, /location \/ \{ try_files \$uri \$uri\/ \/index\.html;/);
    assert.doesNotMatch(raiz, /return 301/);
  }
});

test('caché del raíz: /assets un año; /videos 1 h; index.html, robots.txt y sitemap.xml sin caché', () => {
  const raiz = serverDe(PROD, 'smartdining.com.co', 443);
  assert.match(raiz, /location \/assets\/ \{ expires 1y; add_header Cache-Control "public, immutable" always;/);
  assert.match(raiz, /location \/videos\/ \{ add_header Cache-Control "public, max-age=3600" always;/);
  for (const ruta of ['robots.txt', 'sitemap.xml']) {
    assert.match(raiz, new RegExp(`location = /${ruta.replace('.', '\\.')} \\{ add_header Cache-Control "no-cache" always;`));
  }
  assert.match(raiz, /location \/ \{ try_files [^}]*Cache-Control "no-cache"/);
});

test('www: 301 a https://<raíz>$request_uri en 443 y en 80 (un solo salto)', () => {
  const s443 = serverDe(PROD, 'www.smartdining.com.co', 443);
  assert.ok(s443, 'falta el server 443 de www');
  assert.match(s443, /return 301 https:\/\/smartdining\.com\.co\$request_uri;/);
  const s80 = serverDe(PROD, 'www.smartdining.com.co', 80);
  assert.ok(s80, 'el server 80 no atiende www (tampoco serviría el reto ACME)');
  assert.match(s80, /if \(\$host = www\.smartdining\.com\.co\) \{ return 301 https:\/\/smartdining\.com\.co\$request_uri; \}/);
  assert.match(s80, /location \^~ \/\.well-known\/acme-challenge\//);
});

test('X-Robots-Tag: noindex en todos los subdominios y en TODO staging; sin cabecera solo en el raíz de producción', () => {
  assert.strictEqual(robots(PROD, 'smartdining.com.co'), '', 'el raíz de producción es indexable');
  assert.strictEqual(robots(PROD, 'www.smartdining.com.co'), 'noindex, nofollow');
  assert.strictEqual(robots(STAGING, 'staging.smartdining.com.co'), 'noindex, nofollow', 'el raíz de staging NO es indexable');
  for (const sub of SUBDOMINIOS) {
    assert.strictEqual(robots(PROD, `${sub}.smartdining.com.co`), 'noindex, nofollow', `${sub}. de producción`);
    assert.strictEqual(robots(STAGING, `${sub}.staging.smartdining.com.co`), 'noindex, nofollow', `${sub}. de staging`);
  }
  // Un proyecto desconocido (o NGINX_PROYECTO vacío) no abre nada.
  assert.strictEqual(robots(config('smartdining.com.co', 'otro'), 'smartdining.com.co'), 'noindex, nofollow');
  assert.strictEqual(robots(config('smartdining.com.co', ''), 'smartdining.com.co'), 'noindex, nofollow');
});

test('X-Robots-Tag sale en cada server HTTPS y en cada location con add_header propio', () => {
  assert.match(SEGURIDAD, /^add_header X-Robots-Tag \$sd_robots always;$/m);
  assert.match(CABECERAS, /include \/etc\/nginx\/snippets\/seguridad\.conf;/);
  for (const s of servers(PROD).filter((x) => x.includes('listen 443'))) {
    assert.match(s, /include \/etc\/nginx\/snippets\/(seguridad|cabeceras-sitio)\.conf;/, s.split('\n').slice(0, 6).join('\n'));
    // nginx no hereda los add_header del server en un location con los suyos.
    for (const linea of s.split('\n').filter((l) => /^\s*location .*add_header/.test(l))) {
      assert.match(linea, /include \/etc\/nginx\/snippets\/(seguridad|cabeceras-sitio)\.conf;/, linea.trim());
    }
  }
  // El location de imágenes de api. tiene add_header en varias líneas: repite seguridad.conf.
  const imagenes = PROD.match(/location ~ "\^\/imagenes\/[\s\S]*?\n    \}/)[0];
  assert.match(imagenes, /include \/etc\/nginx\/snippets\/seguridad\.conf;/);
});

test('NGINX_PROYECTO sale del proyecto de compose de cada entorno', () => {
  assert.match(COMPOSE, /^ {6}NGINX_PROYECTO: \$\{COMPOSE_PROJECT_NAME:-smartdining\}$/m);
  assert.match(COMPOSE, /^name: smartdining$/m, 'producción se llama smartdining');
  assert.match(leer('.github/workflows/deploy-staging.yml'), /COMPOSE_PROJECT_NAME=smartdining-staging/);
});

test('CSP del raíz: solo lo que carga el sitio; script-src sin unsafe-inline', () => {
  const csp = serverDe(PROD, 'smartdining.com.co', 443).match(/set \$csp "([^"]+)";/)[1];
  const directivas = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepStrictEqual(directivas['script-src'], ["'self'"]);
  assert.deepStrictEqual(directivas['style-src'], ["'self'", 'https://fonts.googleapis.com']);
  assert.deepStrictEqual(directivas['font-src'], ["'self'", 'https://fonts.gstatic.com']);
  assert.deepStrictEqual(directivas['img-src'], ["'self'", 'data:', 'https://api.smartdining.com.co', 'https://images.unsplash.com']);
  assert.deepStrictEqual(directivas['connect-src'], ["'self'", 'https://api.smartdining.com.co']);
  assert.deepStrictEqual(directivas['frame-src'], ['https://www.google.com']);
  assert.deepStrictEqual(directivas['media-src'], ["'self'"]);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(d), d);
  }
  assert.match(CABECERAS, /add_header Content-Security-Policy \$csp always;/);
});

test('CORS_ORIGINS del backend y del socket-server suman el raíz sin quitar app., staff. ni cocina.', () => {
  const lineas = COMPOSE.match(/^ {6}CORS_ORIGINS: .*$/gm);
  assert.strictEqual(lineas.length, 2);
  for (const l of lineas) {
    const origenes = l.split(': ')[1].split(',');
    assert.deepStrictEqual(origenes, ['https://app.${DOMINIO}', 'https://staff.${DOMINIO}', 'https://cocina.${DOMINIO}', 'https://${DOMINIO}']);
  }
});

test('Dockerfile: etapa sitio con URLs públicas y su dist en html/sitio', () => {
  const etapa = DOCKERFILE.match(/FROM node:22-alpine AS sitio[\s\S]*?RUN npm run build/)[0];
  assert.match(etapa, /ARG DOMINIO/);
  assert.match(etapa, /COPY sitio-publico\/package\.json sitio-publico\/package-lock\.json/);
  assert.match(etapa, /VITE_API_URL=https:\/\/api\.\$\{DOMINIO\}\/api/);
  assert.match(etapa, /VITE_SITIO_URL=https:\/\/\$\{DOMINIO\}/);
  assert.doesNotMatch(etapa, /SECRET|KEY|PASSWORD/i);
  assert.match(DOCKERFILE, /COPY --from=sitio \/src\/dist \/usr\/share\/nginx\/html\/sitio/);
});

test('primer-certificado: www solo en producción', () => {
  assert.match(CERT, /staging\) [^\n]* WWW=0 ;;/);
  assert.match(CERT, /produccion\) [^\n]* WWW=1 ;;/);
  assert.match(CERT, /\[ "\$WWW" = "1" \] && NOMBRE_WWW="-d www\.\$DOMINIO"/);
  assert.match(CERT, /-d \$DOMINIO \$NOMBRE_WWW -d app\.\$DOMINIO -d staff\.\$DOMINIO -d cocina\.\$DOMINIO -d api\.\$DOMINIO -d rt\.\$DOMINIO"/);
});

test('CI: sitio-publico en la matriz de frontends', () => {
  assert.match(CI, /app: \[frontend-cliente, frontend-restaurante, frontend-kds, sitio-publico\]/);
});

test('sin cambios en los límites de la feria ni en /api/health', () => {
  for (const zona of ['login', 'pagos', 'webhook']) {
    assert.match(PLANTILLA, new RegExp(`limit_req_zone \\$binary_remote_addr zone=${zona}:10m rate=\\$\\{NGINX_LIMITE_${zona.toUpperCase()}\\};`));
  }
  // /api/health va por el location / de api., que no tiene limit_req.
  const api = serverDe(PROD, 'api.smartdining.com.co', 443);
  const raizApi = api.match(/\n    location \/ \{[\s\S]*?\n    \}/)[0];
  assert.doesNotMatch(raizApi, /limit_req/);
  assert.doesNotMatch(api, /location[^{]*health/);
});
