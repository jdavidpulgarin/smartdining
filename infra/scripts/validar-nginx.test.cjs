// node --test infra/scripts/*.test.cjs  (lo corre el job "infra" del CI)
// Prueba validar-nginx.sh con un "docker" falso: `compose config` devuelve
// FALSO_CONFIG y `compose exec` anota sus argumentos y sale con FALSO_T.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'validar-nginx.sh');

const DOCKER_FALSO = `#!/bin/sh
case "$*" in
  *" config nginx"*) cat "$FALSO_CONFIG" ;;
  *" exec "*) printf '%s\\n' "$*" >> "$FALSO_EXEC"; exit "\${FALSO_T:-0}" ;;
esac
`;

const CONFIG = `services:
  nginx:
    environment:
      DOMINIO: staging.ejemplo.com
      NGINX_LIMITE_LOGIN: 30r/m
      NGINX_RAFAGA_LOGIN: "20"
      NGINX_LIMITE_PAGOS: 240r/m
      NGINX_RAFAGA_PAGOS: "60"
`;

function correr(config, extra = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-nginx-'));
  const docker = path.join(raiz, 'docker');
  fs.writeFileSync(docker, DOCKER_FALSO, { mode: 0o755 });
  const archivoConfig = path.join(raiz, 'config.yml');
  fs.writeFileSync(archivoConfig, config);
  const exec = path.join(raiz, 'exec.txt');
  fs.writeFileSync(exec, '');
  const r = spawnSync('sh', [SCRIPT], {
    env: {
      ...process.env, DOCKER: docker, FALSO_CONFIG: archivoConfig, FALSO_EXEC: exec, ...extra,
    },
    encoding: 'utf8',
  });
  return { ...r, exec: fs.readFileSync(exec, 'utf8') };
}

test('pasa al nginx en marcha los NGINX_* que resuelve compose (sin comillas) y corre nginx -t', () => {
  const r = correr(CONFIG);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.exec, /compose -f docker-compose\.prod\.yml --env-file infra\/\.env exec -T/);
  for (const par of ['NGINX_LIMITE_LOGIN=30r/m', 'NGINX_RAFAGA_LOGIN=20', 'NGINX_LIMITE_PAGOS=240r/m', 'NGINX_RAFAGA_PAGOS=60']) {
    assert.ok(r.exec.includes(`-e ${par} `), par);
  }
  assert.doesNotMatch(r.exec, /DOMINIO=/, 'solo las NGINX_*');
  assert.match(r.exec, / nginx sh -c /);
  assert.match(r.exec, /nginx -t -c/);
  assert.match(r.stdout, /OK: aplica con:.*up -d nginx/);
});

test('ENV_FILE elige el .env (staging)', () => {
  const r = correr(CONFIG, { ENV_FILE: 'infra/.env.staging' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.exec, /--env-file infra\/\.env\.staging exec/);
  assert.match(r.stdout, /--env-file infra\/\.env\.staging up -d nginx/);
});

test('si nginx -t falla: sale con 1 y dice que NO se aplique', () => {
  const r = correr(CONFIG, { FALSO_T: '1' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /NO apliques/);
  assert.doesNotMatch(r.stdout, /OK:/);
});

test('sin variables NGINX_* (compose viejo): sale con 1 sin llamar a exec', () => {
  const r = correr('services:\n  nginx:\n    environment:\n      DOMINIO: x\n');
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No encontré variables NGINX_/);
  assert.strictEqual(r.exec, '');
});
