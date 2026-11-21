const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, esperar, emitir: emitirSinLimite, tokenComensal, tokenPersonal, tokenPantalla,
} = require('./helpers');
const { backendFalso, sinRespuesta } = require('./pagos-helpers');
const { registrarMesaAtendida, crearVerificadorMesas } = require('../src/mesa-atendida');
const { crearRegistroIdempotencia } = require('../src/idempotencia');

// Sin manejador (develop) no hay ack: la prueba falla en 2 s y no en el timeout global.
const emitir = (socket, evento, payload, ms = 2000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${evento}: sin ack`)), ms);
  socket.emit(evento, payload, (a) => { clearTimeout(t); res(a); });
});

const mesaActiva = (id) => () => ({ status: 200, cuerpo: { id_mesa: id, numero: id, capacidad: 4, estado: 'ocupada', activa: true } });

async function escenario(t, rutas = {}) {
  const backend = backendFalso({
    'GET /api/mesas/5': mesaActiva(5),
    'GET /api/mesas/6': mesaActiva(6),
    ...rutas,
  });
  // La tabla de cuerpos inválidos manda más de 20 eventos seguidos (límite por socket).
  const s = await levantar({}, { backend, limiteEventos: { max: 1000 } });
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitirSinLimite(ana, 'join:table', {});
  const vecina = await s.conectar(tokenComensal(6, 'Beto'));
  await emitirSinLimite(vecina, 'join:table', {});
  const mesero = await s.conectar(tokenPersonal('mesero', 7));
  const cajero = await s.conectar(tokenPersonal('cajero', 8));
  // Al conectar, limites.js ya consultó la capacidad de las mesas 5 y 6: no cuenta.
  backend.llamadas.length = 0;
  return {
    s, backend, ana, vecina, mesero, cajero,
  };
}

// Escucha en todos los sockets dados; resuelve con lo recibido (null = nada).
const escuchar = (sockets, ms = 300) => Promise.all(sockets.map((c) => esperar(c, 'mesa:atendida', ms)));
const consultas = (backend) => backend.llamadas.filter((l) => l.ruta.startsWith('/api/mesas/')).length;

test('personal: la mesa y room:admin reciben el cuerpo exacto, sin datos del mesero', async (t) => {
  const { ana, mesero, cajero } = await escenario(t);
  const eventId = randomUUID();
  const llega = escuchar([ana, cajero, mesero]);
  const ack = await emitir(mesero, 'mesa:atendida', { eventId, idMesa: 5, tipo: 'llamado' });
  assert.deepStrictEqual(ack, { ok: true, eventId, duplicado: false });
  const [enMesa, enPanel, enEmisor] = await llega;
  for (const ev of [enMesa, enPanel, enEmisor]) {
    assert.ok(ev, 'debe llegar a la mesa y a room:admin (incluido quien lo marcó)');
    assert.deepStrictEqual(Object.keys(ev).sort(), ['emitidoEn', 'eventId', 'id_mesa', 'tipo']);
    assert.deepStrictEqual({ eventId: ev.eventId, id_mesa: ev.id_mesa, tipo: ev.tipo }, { eventId, id_mesa: 5, tipo: 'llamado' });
    assert.ok(!Number.isNaN(Date.parse(ev.emitidoEn)));
  }
  // Sin nombre, id ni rol del mesero en ninguna parte del evento.
  const texto = JSON.stringify(enMesa);
  for (const dato of ['id_usuario', 'mesero', 'rol', 'nombre', 'comensal']) assert.ok(!texto.includes(dato), dato);
});

test('tipo cuenta y cualquier rol de personal (admin, mesero, cajero)', async (t) => {
  const { s, ana } = await escenario(t);
  for (const rol of ['admin', 'mesero', 'cajero']) {
    const c = await s.conectar(tokenPersonal(rol));
    const eventId = randomUUID();
    const llega = esperar(ana, 'mesa:atendida');
    assert.strictEqual((await emitir(c, 'mesa:atendida', { eventId, idMesa: 5, tipo: 'cuenta' })).ok, true, rol);
    assert.strictEqual((await llega).tipo, 'cuenta');
  }
});

test('comensal, pantalla y cocina: NO_AUTORIZADO y nadie recibe nada (aunque el cuerpo sea inválido)', async (t) => {
  const {
    s, backend, ana, vecina, cajero,
  } = await escenario(t);
  const pantalla = await s.conectar(tokenPantalla(5));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const nada = escuchar([ana, vecina, cajero, pantalla], 400);
  for (const c of [ana, pantalla, cocina]) {
    for (const cuerpo of [{ eventId: randomUUID(), idMesa: 5, tipo: 'llamado' }, { idMesa: 'x', extra: 1 }, null]) {
      const ack = await emitir(c, 'mesa:atendida', cuerpo);
      assert.strictEqual(ack.ok, false);
      assert.strictEqual(ack.codigo, 'NO_AUTORIZADO');
    }
  }
  assert.deepStrictEqual(await nada, [null, null, null, null]);
  assert.strictEqual(consultas(backend), 0, 'ni siquiera se consulta la mesa');
});

test('aislamiento: otra mesa no lo recibe', async (t) => {
  const { ana, vecina, mesero } = await escenario(t);
  const enMesa = esperar(ana, 'mesa:atendida');
  const enVecina = esperar(vecina, 'mesa:atendida', 400);
  await emitir(mesero, 'mesa:atendida', { eventId: randomUUID(), idMesa: 5, tipo: 'llamado' });
  assert.ok(await enMesa);
  assert.strictEqual(await enVecina, null);
});

test('eventId repetido: un solo aviso; el repetido responde duplicado: true', async (t) => {
  const {
    s, ana, mesero, cajero,
  } = await escenario(t);
  const eventId = randomUUID();
  const recibidos = [];
  ana.on('mesa:atendida', (e) => recibidos.push(['mesa', e.eventId]));
  cajero.on('mesa:atendida', (e) => recibidos.push(['admin', e.eventId]));
  const cuerpo = { eventId, idMesa: 5, tipo: 'llamado' };
  assert.deepStrictEqual(await emitir(mesero, 'mesa:atendida', cuerpo), { ok: true, eventId, duplicado: false });
  // También desde otra pantalla del panel (el mismo clic reenviado tras reconectar).
  const otroPanel = await s.conectar(tokenPersonal('mesero', 7));
  assert.deepStrictEqual(await emitir(otroPanel, 'mesa:atendida', cuerpo), { ok: true, eventId, duplicado: true });
  assert.deepStrictEqual(await emitir(mesero, 'mesa:atendida', cuerpo), { ok: true, eventId, duplicado: true });
  await new Promise((r) => { setTimeout(r, 300); });
  assert.deepStrictEqual(recibidos.sort(), [['admin', eventId], ['mesa', eventId]]);
});

test('cuerpo inválido: PAYLOAD_INVALIDO y no se reenvía nada', async (t) => {
  const {
    backend, ana, vecina, mesero, cajero,
  } = await escenario(t, { 'GET /api/mesas/99': () => ({ status: 404, cuerpo: { error: 'Mesa no encontrada' } }) });
  const valido = () => ({ eventId: randomUUID(), idMesa: 5, tipo: 'llamado' });
  const casos = {
    'sin eventId': { idMesa: 5, tipo: 'llamado' },
    'eventId no UUID': { ...valido(), eventId: 'abc' },
    'eventId numérico': { ...valido(), eventId: 123 },
    'sin idMesa': { eventId: randomUUID(), tipo: 'llamado' },
    'idMesa texto': { ...valido(), idMesa: '5' },
    'idMesa decimal': { ...valido(), idMesa: 5.5 },
    'idMesa cero': { ...valido(), idMesa: 0 },
    'idMesa negativo': { ...valido(), idMesa: -5 },
    'idMesa fuera de INTEGER': { ...valido(), idMesa: 2147483648 },
    'id_mesa en vez de idMesa': { eventId: randomUUID(), id_mesa: 5, tipo: 'llamado' },
    'mesa que no existe': { ...valido(), idMesa: 99 },
    'sin tipo': { eventId: randomUUID(), idMesa: 5 },
    'tipo distinto': { ...valido(), tipo: 'pedido' },
    'tipo en mayúsculas': { ...valido(), tipo: 'LLAMADO' },
    'campo de más': { ...valido(), id_mesero: 7 },
    'campo de más (nombre)': { ...valido(), nombre: 'Pedro' },
    'arreglo': [valido()],
    'null': null,
    'texto': 'hola',
  };
  const nada = escuchar([ana, vecina, cajero], 400);
  for (const [nombre, cuerpo] of Object.entries(casos)) {
    const ack = await emitir(mesero, 'mesa:atendida', cuerpo);
    assert.strictEqual(ack.ok, false, nombre);
    assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO', nombre);
  }
  assert.deepStrictEqual(await nada, [null, null, null]);
  // Solo la mesa 99 llegó a consultarse: lo demás se rechaza antes.
  assert.deepStrictEqual(backend.llamadas.map((l) => l.ruta), ['/api/mesas/99']);
  const deMas = await emitir(mesero, 'mesa:atendida', { ...valido(), id_mesero: 7 });
  assert.match(deMas.mensaje, /Campos no permitidos: id_mesero/);
});

test('un rechazo no gasta el eventId: el mismo eventId pasa después con un cuerpo válido', async (t) => {
  const { ana, mesero } = await escenario(t, { 'GET /api/mesas/99': () => ({ status: 404, cuerpo: null }) });
  const eventId = randomUUID();
  assert.strictEqual((await emitir(mesero, 'mesa:atendida', { eventId, idMesa: 99, tipo: 'llamado' })).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(mesero, 'mesa:atendida', { eventId, idMesa: 5, tipo: 'otro' })).codigo, 'PAYLOAD_INVALIDO');
  const llega = esperar(ana, 'mesa:atendida');
  assert.deepStrictEqual(await emitir(mesero, 'mesa:atendida', { eventId, idMesa: 5, tipo: 'llamado' }), { ok: true, eventId, duplicado: false });
  assert.ok(await llega);
});

test('mesa con activa: false → PAYLOAD_INVALIDO y nadie recibe nada', async (t) => {
  const { s, cajero, mesero } = await escenario(t, {
    'GET /api/mesas/8': () => ({ status: 200, cuerpo: { id_mesa: 8, capacidad: 4, activa: false } }),
  });
  const comensal8 = await s.conectar(tokenComensal(8, 'Caro'));
  await emitirSinLimite(comensal8, 'join:table', {});
  const nada = escuchar([comensal8, cajero], 400);
  const ack = await emitir(mesero, 'mesa:atendida', { eventId: randomUUID(), idMesa: 8, tipo: 'cuenta' });
  assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO');
  assert.match(ack.mensaje, /inactiva/);
  assert.deepStrictEqual(await nada, [null, null]);
});

test('respuesta sin el campo activa: se trata como activa', async (t) => {
  const { s, mesero } = await escenario(t, {
    'GET /api/mesas/8': () => ({ status: 200, cuerpo: { id_mesa: 8, capacidad: 4 } }),
  });
  const comensal8 = await s.conectar(tokenComensal(8, 'Caro'));
  await emitirSinLimite(comensal8, 'join:table', {});
  const llega = esperar(comensal8, 'mesa:atendida');
  assert.strictEqual((await emitir(mesero, 'mesa:atendida', { eventId: randomUUID(), idMesa: 8, tipo: 'llamado' })).ok, true);
  assert.ok(await llega);
});

test('backend caído → ERROR_INTERNO sin reenviar; el reintento con el mismo eventId pasa cuando vuelve', async (t) => {
  const {
    backend, ana, mesero, cajero,
  } = await escenario(t, { 'GET /api/mesas/5': () => sinRespuesta() });
  const eventId = randomUUID();
  const cuerpo = { eventId, idMesa: 5, tipo: 'llamado' };
  const nada = escuchar([ana, cajero], 400);
  const caido = await emitir(mesero, 'mesa:atendida', cuerpo);
  assert.deepStrictEqual([caido.ok, caido.codigo, caido.eventId], [false, 'ERROR_INTERNO', eventId]);
  assert.deepStrictEqual(await nada, [null, null]);

  backend.rutas['GET /api/mesas/5'] = mesaActiva(5);
  const llega = escuchar([ana, cajero]);
  assert.deepStrictEqual(await emitir(mesero, 'mesa:atendida', cuerpo), { ok: true, eventId, duplicado: false });
  const [enMesa, enPanel] = await llega;
  assert.strictEqual(enMesa.eventId, eventId);
  assert.strictEqual(enPanel.eventId, eventId);
});

test('backend con 5xx o sin configurar → ERROR_INTERNO y no se reenvía', async (t) => {
  const { ana, mesero } = await escenario(t, { 'GET /api/mesas/5': () => ({ status: 503, cuerpo: null }) });
  const nada = esperar(ana, 'mesa:atendida', 400);
  assert.strictEqual((await emitir(mesero, 'mesa:atendida', { eventId: randomUUID(), idMesa: 5, tipo: 'llamado' })).codigo, 'ERROR_INTERNO');
  assert.strictEqual(await nada, null);

  const sinBackend = await levantar();
  t.after(() => sinBackend.cerrar());
  assert.strictEqual(sinBackend.ctx.backend, null);
  const admin = await sinBackend.conectar(tokenPersonal('admin'));
  assert.strictEqual((await emitir(admin, 'mesa:atendida', { eventId: randomUUID(), idMesa: 5, tipo: 'cuenta' })).codigo, 'ERROR_INTERNO');
});

test('caché: una mesa activa se consulta una vez; una inactiva o inexistente se vuelve a preguntar', async () => {
  let t0 = 0;
  const backend = backendFalso({
    'GET /api/mesas/5': () => ({ status: 200, cuerpo: { activa: true } }),
    'GET /api/mesas/8': () => ({ status: 200, cuerpo: { activa: false } }),
    'GET /api/mesas/9': () => ({ status: 404, cuerpo: null }),
  });
  const v = crearVerificadorMesas({ backend, ahora: () => t0 });
  assert.strictEqual(await v.estado(5), 'activa');
  assert.strictEqual(await v.estado(5), 'activa');
  assert.strictEqual(await v.estado(8), 'inactiva');
  assert.strictEqual(await v.estado(8), 'inactiva');
  assert.strictEqual(await v.estado(9), 'no_existe');
  assert.strictEqual(await v.estado(9), 'no_existe');
  assert.deepStrictEqual(backend.llamadas.map((l) => l.ruta), ['/api/mesas/5', '/api/mesas/8', '/api/mesas/8', '/api/mesas/9', '/api/mesas/9']);
  t0 += 5 * 60 * 1000; // vence la caché de la activa
  backend.rutas['GET /api/mesas/5'] = () => ({ status: 200, cuerpo: { activa: false } });
  assert.strictEqual(await v.estado(5), 'inactiva');
});

test('si la emisión falla, se libera el eventId y el reintento pasa', async () => {
  const handlers = {};
  const socket = { data: { identidad: { rol: 'mesero', id_usuario: 7 } }, on: (ev, fn) => { handlers[ev] = fn; } };
  const registro = crearRegistroIdempotencia();
  let falla = true;
  const emitidos = [];
  const io = {
    to() { return this; },
    emit(ev, datos) {
      if (falla) throw new Error('emisión rota');
      emitidos.push([ev, datos]);
    },
  };
  registrarMesaAtendida(socket, { io, registro, verificadorMesas: { estado: async () => 'activa' } });
  const llamar = (p) => new Promise((res) => { handlers['mesa:atendida'](p, res); });
  const eventId = randomUUID();
  const cuerpo = { eventId, idMesa: 5, tipo: 'llamado' };
  assert.strictEqual((await llamar(cuerpo)).codigo, 'ERROR_INTERNO');
  assert.strictEqual(registro.obtener(`personal:atendida:5:${eventId}`), undefined);
  falla = false;
  assert.deepStrictEqual(await llamar(cuerpo), { ok: true, eventId, duplicado: false });
  assert.strictEqual(emitidos.length, 1);
});
