const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPantalla, tokenPersonal, firmar, CLAVE_INTERNA,
} = require('./helpers');
const { crearClienteBackend } = require('../src/backend');

/** Reloj manual: los temporizadores solo corren cuando la prueba llama a avanzar(). */
function relojManual() {
  let id = 0;
  const pendientes = new Map();
  return {
    programar(fn) { id += 1; pendientes.set(id, fn); return id; },
    cancelar(h) { pendientes.delete(h); },
    get pendientes() { return pendientes.size; },
    /** Dispara los temporizadores vencidos (todos: cada uno es "pasaron 3 min"). */
    async avanzar() {
      const lote = [...pendientes.entries()];
      pendientes.clear();
      for (const [, fn] of lote) fn();
      await new Promise((r) => setTimeout(r, 50)); // deja terminar los ciclos async
    },
  };
}

/** Backend falso: guarda el token por mesa con compare-and-swap, como el contrato. */
function backendFalso({ responder } = {}) {
  const llamadas = [];
  const tokens = new Map();
  return {
    llamadas,
    tokens,
    async post(ruta, cuerpo) {
      llamadas.push({ ruta, cuerpo });
      if (responder) return responder(ruta, cuerpo);
      const id = Number(ruta.split('/')[3]);
      if (cuerpo.token_anterior && tokens.has(id) && tokens.get(id) !== cuerpo.token_anterior) {
        return { ok: false, status: 409, cuerpo: null };
      }
      tokens.set(id, cuerpo.token_qr);
      return { ok: true, status: 200, cuerpo: { ok: true } };
    },
  };
}

async function escenario(t, opciones = {}) {
  const reloj = relojManual();
  const backend = opciones.backend || backendFalso();
  const s = await levantar({}, { backend, rotacion: { programar: reloj.programar, cancelar: reloj.cancelar } });
  t.after(() => s.cerrar());
  const abrir = async (id_mesa) => {
    const r = await fetch(`${s.url}/qr/generar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPersonal('mesero')}` },
      body: JSON.stringify({ id_mesa }),
    });
    const qr = await r.json();
    backend.tokens?.set(id_mesa, qr.token); // el backend guardó este token al abrir
    return qr.token;
  };
  const pantalla = await s.conectar(tokenPantalla(5));
  return { s, reloj, backend, abrir, pantalla };
}

test('rota cada ciclo mientras la mesa está abierta y vacía, y la tablet recibe el QR nuevo', async (t) => {
  const { s, reloj, backend, abrir, pantalla } = await escenario(t);
  const inicial = await abrir(5);
  assert.strictEqual(reloj.pendientes, 1);

  const llega = esperar(pantalla, 'qr:actualizado');
  await reloj.avanzar();
  const ev = await llega;
  assert.notStrictEqual(ev.token_qr, inicial);
  assert.deepStrictEqual(backend.llamadas[0].cuerpo, { token_qr: ev.token_qr, token_anterior: inicial });
  assert.strictEqual(backend.llamadas[0].ruta, '/api/mesas/5/token-qr/interno');
  assert.strictEqual((await (await fetch(`${s.url}/qr/validar`, { method: 'POST', body: JSON.stringify({ token: ev.token_qr }) })).json()).valido, true);

  const otra = esperar(pantalla, 'qr:actualizado');
  await reloj.avanzar();
  const ev2 = await otra;
  assert.strictEqual(backend.llamadas[1].cuerpo.token_anterior, ev.token_qr, 'encadena el compare-and-swap');
  assert.notStrictEqual(ev2.token_qr, ev.token_qr);
});

test('no rota cuando hay comensales: con el primero el QR queda fijo', async (t) => {
  const { s, reloj, backend, abrir, pantalla } = await escenario(t);
  await abrir(5);
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', { comensal: 'Ana' });
  assert.strictEqual(reloj.pendientes, 0, 'el primer comensal detiene la rotación');

  // Aunque Ana se vaya, el QR sigue fijo hasta liberar la mesa.
  ana.close();
  const nada = esperar(pantalla, 'qr:actualizado', 200);
  await reloj.avanzar();
  assert.strictEqual(await nada, null);
  assert.strictEqual(backend.llamadas.length, 0);
});

test('si al rotar hay un comensal en la sala (sin pasar por el gancho), no rota', async (t) => {
  const { s, reloj, backend, abrir } = await escenario(t);
  await abrir(5);
  const ana = await s.conectar(tokenComensal(5));
  ana.emit('join:table', {}); // sin esperar el ack
  await new Promise((r) => setTimeout(r, 50));
  s.rotador.abrir(5, backend.tokens.get(5)); // simula una carrera: el ciclo se rearma igual
  await reloj.avanzar();
  assert.strictEqual(backend.llamadas.length, 0);
  assert.strictEqual(s.rotador.activa(5), false);
});

test('se detiene al liberar la mesa', async (t) => {
  const { s, reloj, backend, abrir } = await escenario(t);
  await abrir(5);
  await fetch(`${s.url}/internal/mesa-liberada`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }),
  });
  assert.strictEqual(reloj.pendientes, 0);
  await reloj.avanzar();
  assert.strictEqual(backend.llamadas.length, 0);
});

test('backend caído: conserva el QR anterior, no avisa y reintenta en el siguiente ciclo', async (t) => {
  let caido = true;
  const backend = backendFalso({
    responder: () => {
      if (caido) throw Object.assign(new Error('sin respuesta'), { codigo: 'BACKEND_TIMEOUT' });
      return { ok: true, status: 200, cuerpo: { ok: true } };
    },
  });
  const { reloj, abrir, pantalla } = await escenario(t, { backend });
  await abrir(5);
  const nada = esperar(pantalla, 'qr:actualizado', 200);
  await reloj.avanzar();
  assert.strictEqual(await nada, null);
  assert.strictEqual(reloj.pendientes, 1, 'queda programado el reintento');
  caido = false;
  const llega = esperar(pantalla, 'qr:actualizado');
  await reloj.avanzar();
  assert.ok(await llega);
});

test('409 del backend (mesa ya no ocupada o rotada a mano): deja de rotar sin avisar', async (t) => {
  const backend = backendFalso({ responder: () => ({ ok: false, status: 409, cuerpo: null }) });
  const { s, reloj, abrir, pantalla } = await escenario(t, { backend });
  await abrir(5);
  const nada = esperar(pantalla, 'qr:actualizado', 200);
  await reloj.avanzar();
  assert.strictEqual(await nada, null);
  assert.strictEqual(s.rotador.activa(5), false);
  assert.strictEqual(reloj.pendientes, 0);
});

test('quien entró antes de una rotación sigue operando en el socket', async (t) => {
  const { s, reloj, abrir, pantalla } = await escenario(t);
  await abrir(5);
  // Ana escaneó el QR inicial y recibió su JWT, pero aún no conecta el socket.
  const jwtAna = firmar({ id_mesa: 5, rol: 'comensal', sid: 'sid-del-qr-inicial' });
  const llega = esperar(pantalla, 'qr:actualizado');
  await reloj.avanzar();
  await llega; // el QR ya rotó

  const ana = await s.conectar(jwtAna);
  const join = await emitir(ana, 'join:table', { comensal: 'Ana' });
  assert.strictEqual(join.ok, true);
  const ack = await emitir(ana, 'cart:update', {
    eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 1, cantidad: 1,
  });
  assert.strictEqual(ack.ok, true, 'rotar no revoca: solo liberar la mesa corta las sesiones');
  // La continuidad en el BACKEND (middleware que compara sid) está BLOQUEADA
  // para Daniel: ver docs/rotacion-qr.md.
});

test('sin BACKEND_URL la rotación automática queda apagada', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  assert.strictEqual(s.rotador.habilitado, false);
  s.rotador.abrir(5, 'x');
  assert.strictEqual(s.rotador.activa(5), false);
});

test('cliente del backend: x-internal-key, timeout y error de red', async () => {
  const vistas = [];
  const ok = crearClienteBackend({
    url: 'http://backend:4000/',
    claveInterna: 'clave-de-prueba',
    fetch: async (url, opts) => {
      vistas.push({ url, opts });
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    },
  });
  assert.deepStrictEqual(await ok.post('/api/x', { a: 1 }), { ok: true, status: 200, cuerpo: { ok: true } });
  assert.strictEqual(vistas[0].url, 'http://backend:4000/api/x');
  assert.strictEqual(vistas[0].opts.headers['x-internal-key'], 'clave-de-prueba');
  assert.ok(vistas[0].opts.signal instanceof AbortSignal);

  const lento = crearClienteBackend({
    url: 'http://backend:4000',
    claveInterna: 'k',
    timeoutMs: 50,
    fetch: (url, opts) => new Promise((_, rechazar) => {
      opts.signal.addEventListener('abort', () => rechazar(new Error('abortado')));
    }),
  });
  await assert.rejects(lento.post('/api/x', {}), (e) => e.codigo === 'BACKEND_TIMEOUT');

  const caido = crearClienteBackend({ url: 'http://backend:4000', claveInterna: 'k', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(caido.get('/api/x'), (e) => e.codigo === 'BACKEND_INALCANZABLE');

  const noJson = crearClienteBackend({ url: 'http://b', claveInterna: 'k', fetch: async () => ({ ok: false, status: 502, text: async () => '<html>' }) });
  assert.deepStrictEqual(await noJson.get('/x'), { ok: false, status: 502, cuerpo: null });
});

test('configuración: BACKEND_URL y ROTACION_QR_MINUTOS se validan', () => {
  const { cargarConfig } = require('../src/config');
  const { ENV_BASE, ORIGEN } = require('./helpers');
  const base = { CORS_ORIGINS: ORIGEN, ...ENV_BASE };
  assert.strictEqual(cargarConfig({ ...base, BACKEND_URL: 'http://localhost:4000/' }).backendUrl, 'http://localhost:4000');
  assert.strictEqual(cargarConfig(base).rotacionQrMs, 3 * 60 * 1000);
  assert.throws(() => cargarConfig({ ...base, BACKEND_URL: 'ftp://x' }), /BACKEND_URL/);
  assert.throws(() => cargarConfig({ ...base, ROTACION_QR_MINUTOS: '0' }), /ROTACION_QR_MINUTOS/);
});
