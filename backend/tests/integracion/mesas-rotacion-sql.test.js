const test = require('node:test');
const assert = require('node:assert');

/**
 * Rotación AUTOMÁTICA del QR (POST /mesas/:id/token-qr/interno) contra
 * PostgreSQL real, con QR FIRMADOS DE VERDAD. También la MANUAL con
 * `solo_si_vacia` (POST /mesas/:id/rotar-qr, #174), que comparte su guarda.
 *
 * El backend habla con el socket-server en dos puntos: le pide el QR al abrir
 * la mesa (generarTokenQr) y le pregunta si un QR es válido al crear la sesión
 * del comensal (validarTokenQr). Aquí esos dos puntos se conectan, en el mismo
 * proceso, con el servicio QR REAL del socket-server (`crearServicioQr` de
 * socket-server/src/qr.js, que firma y valida con HMAC): los tokens son los
 * mismos que en producción y no hace falta levantar el socket-server. La prueba
 * de punta a punta usa además su rotador real (`crearRotadorQr`) y su cliente
 * HTTP real (`crearClienteBackend`) contra este backend escuchando en un puerto
 * efímero, con un reloj inyectado. No se toca nada de socket-server/.
 *
 * MESAS PROPIAS (criterio de #146): una por caso, desde MESA_NUMERO_ROTACION
 * (940 por omisión), marcadas en `ubicacion`. El `after` lo deja todo como
 * estaba aunque una prueba falle: devuelve el stock de los pedidos con
 * fn_cerrar_reserva_detalle, borra su libro, los pedidos y las mesas (el
 * histórico de tokens cae en cascada) y olvida sus alias.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const crypto = require('node:crypto');
const path = require('node:path');

// Entorno de ESTA prueba, sin tocar el .env: sin socket-server real (los dos
// puntos se conectan abajo), alias en memoria y una clave interna propia.
process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';
process.env.INTERNAL_API_KEY = crypto.randomBytes(32).toString('hex');
const CLAVE = process.env.INTERNAL_API_KEY;

const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const socketNotifier = require('../../src/services/socket.notifier');
const aliasComensal = require('../../src/services/alias-comensal');
const pedidosService = require('../../src/services/pedidos.service');
const { tokenStaff } = require('../helpers/fake-db');
const { instalarFakeRedis } = require('../helpers/fake-redis');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');

const SOCKET = path.resolve(B, '..', 'socket-server', 'src');
const { crearServicioQr } = require(path.join(SOCKET, 'qr'));
const { crearRotadorQr } = require(path.join(SOCKET, 'rotacion'));
const { crearClienteBackend } = require(path.join(SOCKET, 'backend'));

const MESA_BASE = parseInt(process.env.MESA_NUMERO_ROTACION || '940', 10);
const MARCA_MESA = 'PRUEBA rotacion-qr';

const servicioQr = crearServicioQr({ secreto: crypto.randomBytes(32).toString('hex') });
const original = {
  generarTokenQr: socketNotifier.generarTokenQr,
  validarTokenQr: socketNotifier.validarTokenQr,
};

let sonda = null;
let hayBase = false;
let admin = null;
let catalogo = null; // el de plato-prueba.js, con su limpiar()
let plato = null;
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1::int AND numero < $1::int + 20 AND ubicacion <> $2::text LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_ROTACION`);
  }
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
  if (ids.length === 0) return;
  await sonda.query(
    `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
       FROM detalles_pedido dp JOIN pedidos p ON p.id_pedido = dp.id_pedido
      WHERE p.id_mesa = ANY($1::int[]) ORDER BY dp.id_detalle`,
    [ids]
  );
  await sonda.query(
    `DELETE FROM movimientos_inventario
      WHERE id_detalle IN (SELECT dp.id_detalle FROM detalles_pedido dp
                           JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[]))`,
    [ids]
  );
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [ids]);
  for (const id of ids) await aliasComensal.olvidarMesa(id);
}

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  admin = u.rows[0] ? tokenStaff(u.rows[0].id_usuario, 'admin') : null;
  if (!admin) return;
  await limpiar();
  // Plato PROPIO SIN receta (tests/helpers/plato-prueba.js): aquí solo hace
  // falta "un pedido en la mesa", no inventario. Antes era el primero del seed
  // (Nachos Supremos), que compartía su poco stock con las demás suites.
  catalogo = await crearCatalogoPrueba(sonda, 'mesas-rotacion');
  plato = catalogo.plato;
  hayBase = true;

  // Los dos puntos backend <-> socket-server, contra el servicio QR real.
  socketNotifier.generarTokenQr = async (idMesa) => {
    const q = servicioQr.generar(idMesa);
    return { alcanzado: true, token: q.token, expira_en: q.expira_en };
  };
  socketNotifier.validarTokenQr = async (token) => {
    const r = await servicioQr.validar(token);
    return r.valido
      ? { alcanzado: true, valido: true, id_mesa: r.id_mesa, expira_en: r.expira_en }
      : { alcanzado: true, valido: false, motivo: r.motivo };
  };
});

test.after(async () => {
  Object.assign(socketNotifier, original);
  try {
    if (hayBase) await limpiar();
    if (catalogo) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Mesa propia, abierta por la ruta real. Devuelve id y el token que guardó. */
async function mesaAbierta() {
  const numero = siguienteMesa++;
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion) VALUES ($1::int, 4, $2::text) RETURNING id_mesa`,
    [numero, MARCA_MESA]
  );
  const idMesa = m.rows[0].id_mesa;
  const res = await request(app).post(`/api/mesas/${idMesa}/abrir`).set('Authorization', `Bearer ${admin}`);
  assert.strictEqual(res.status, 201, `abrir: ${JSON.stringify(res.body)}`);
  const { rows } = await sonda.query('SELECT token_qr FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  assert.strictEqual(rows[0].token_qr, res.body.token, 'la mesa guarda el token firmado');
  return { idMesa, token: res.body.token };
}

const rotar = (idMesa, cuerpo) => request(app)
  .post(`/api/mesas/${idMesa}/token-qr/interno`)
  .set('x-internal-key', CLAVE)
  .send(cuerpo);

const sesion = (token, comensal) => request(app)
  .post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`)
  .send({ comensal });

async function tokenGuardado(idMesa) {
  const { rows } = await sonda.query('SELECT token_qr FROM mesas WHERE id_mesa = $1::int', [idMesa]);
  return rows[0].token_qr;
}

test('abrir -> rotar con el token correcto: el nuevo queda guardado, el viejo ya no abre sesion y el nuevo si', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token: viejo } = await mesaAbierta();
  const nuevo = servicioQr.generar(idMesa).token;

  const r = await rotar(idMesa, { token_qr: nuevo, token_anterior: viejo });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { ok: true });
  assert.strictEqual(await tokenGuardado(idMesa), nuevo);

  const { rows: hist } = await sonda.query(
    'SELECT token_antiguo FROM token_qr_historico WHERE id_mesa = $1::int', [idMesa]
  );
  assert.deepStrictEqual(hist.map((h) => h.token_antiguo), [viejo], 'el anterior queda en el historico');

  // El VIEJO tiene firma valida, pero ya no es el vigente de la mesa.
  const conViejo = await sesion(viejo, 'Ana');
  assert.strictEqual(conViejo.status, 401);
  assert.strictEqual(conViejo.body.motivo, 'no_es_el_vigente');
  assert.strictEqual(conViejo.body.token, undefined, 'sin JWT');

  const conNuevo = await sesion(nuevo, 'Ana');
  assert.strictEqual(conNuevo.status, 201, JSON.stringify(conNuevo.body));
  assert.ok(conNuevo.body.token, 'el nuevo si da sesion');
});

test('dos rotaciones a la vez con el mismo token_anterior: una gana y la otra es 409', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token: viejo } = await mesaAbierta();
  const a = servicioQr.generar(idMesa).token;
  const b = servicioQr.generar(idMesa).token;

  const [ra, rb] = await Promise.all([
    rotar(idMesa, { token_qr: a, token_anterior: viejo }),
    rotar(idMesa, { token_qr: b, token_anterior: viejo }),
  ]);
  const estados = [ra.status, rb.status].sort();
  assert.deepStrictEqual(estados, [200, 409]);
  const perdedor = ra.status === 409 ? ra : rb;
  assert.strictEqual(perdedor.body.motivo, 'token_anterior_distinto');
  const ganador = ra.status === 200 ? a : b;
  assert.strictEqual(await tokenGuardado(idMesa), ganador, 'queda el del que gano, no una mezcla');
});

test('rotar despues de liberar la mesa: 409 mesa_no_ocupada', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token: viejo } = await mesaAbierta();
  const lib = await request(app).post(`/api/mesas/${idMesa}/liberar`).set('Authorization', `Bearer ${admin}`);
  assert.strictEqual(lib.status, 200, JSON.stringify(lib.body));

  const r = await rotar(idMesa, { token_qr: servicioQr.generar(idMesa).token, token_anterior: viejo });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.motivo, 'mesa_no_ocupada');
  assert.strictEqual(await tokenGuardado(idMesa), null, 'sigue liberada');
});

test('guarda de continuidad: con un comensal dentro, o con un pedido, no se rota', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // Un comensal entra por QR: reserva su alias.
  const m1 = await mesaAbierta();
  assert.strictEqual((await sesion(m1.token, 'Beto')).status, 201);
  const r1 = await rotar(m1.idMesa, { token_qr: servicioQr.generar(m1.idMesa).token, token_anterior: m1.token });
  assert.strictEqual(r1.status, 409);
  assert.strictEqual(r1.body.motivo, 'mesa_con_comensales');
  assert.strictEqual(await tokenGuardado(m1.idMesa), m1.token, 'el QR queda fijo: Beto conserva su sesion');

  // El mesero toma un pedido sin que nadie haya escaneado.
  const m2 = await mesaAbierta();
  await pedidosService.crearConDetalles({ id_mesa: m2.idMesa, id_usuario: null, items: [{ id_plato: plato.id_plato, cantidad: 1 }] });
  const r2 = await rotar(m2.idMesa, { token_qr: servicioQr.generar(m2.idMesa).token, token_anterior: m2.token });
  assert.strictEqual(r2.status, 409);
  assert.strictEqual(r2.body.motivo, 'mesa_con_comensales');
  assert.strictEqual(await tokenGuardado(m2.idMesa), m2.token);
});

// ---------------------------------------------------------------------------
// Rotación MANUAL con solo_si_vacia (#174): la misma guarda, en PG real
// ---------------------------------------------------------------------------

const rotarManual = (idMesa, cuerpo) => {
  const r = request(app).post(`/api/mesas/${idMesa}/rotar-qr`).set('Authorization', `Bearer ${admin}`);
  return cuerpo === undefined ? r : r.send(cuerpo);
};

test('rotar-qr con solo_si_vacia y la mesa vacia: rota (sin historico, como el manual de siempre)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token: viejo } = await mesaAbierta();

  const r = await rotarManual(idMesa, { solo_si_vacia: true });
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  const nuevo = await tokenGuardado(idMesa);
  assert.notStrictEqual(nuevo, viejo);
  assert.ok(r.body.url.includes(encodeURIComponent(nuevo)), 'la url lleva el token guardado');
  assert.deepStrictEqual(Object.keys(r.body).sort(), ['expira_en', 'mesa', 'url']);
  const { rows: hist } = await sonda.query(
    'SELECT count(*)::int AS n FROM token_qr_historico WHERE id_mesa = $1::int', [idMesa]
  );
  assert.strictEqual(hist[0].n, 0, 'la manual no escribe historico, igual que antes');
  assert.strictEqual((await sesion(nuevo, 'Ana')).status, 201, 'el nuevo da sesion');
});

test('rotar-qr con solo_si_vacia: un pedido, un comensal por QR o uno sin celular -> 409 y el token NO cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // Pedido de la sesión, sin que nadie haya escaneado.
  const m1 = await mesaAbierta();
  await pedidosService.crearConDetalles({ id_mesa: m1.idMesa, id_usuario: null, items: [{ id_plato: plato.id_plato, cantidad: 1 }] });
  // Alguien entra por QR y reserva su nombre.
  const m2 = await mesaAbierta();
  assert.strictEqual((await sesion(m2.token, 'Beto')).status, 201);
  // El mesero da de alta a alguien sin celular.
  const m3 = await mesaAbierta();
  const alta = await request(app).post(`/api/mesas/${m3.idMesa}/comensales`)
    .set('Authorization', `Bearer ${admin}`).send({ alias: 'Abuela' });
  assert.strictEqual(alta.status, 201, JSON.stringify(alta.body));

  for (const [caso, m] of [['pedido', m1], ['comensal por QR', m2], ['sin celular', m3]]) {
    const r = await rotarManual(m.idMesa, { solo_si_vacia: true });
    assert.strictEqual(r.status, 409, `${caso}: ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.motivo, 'mesa_con_comensales', caso);
    assert.strictEqual(await tokenGuardado(m.idMesa), m.token, `${caso}: el QR queda fijo`);
  }
  // Beto conserva su sesión: el QR que escaneó sigue siendo el vigente.
  assert.strictEqual((await sesion(m2.token, 'Ana')).status, 201);
});

test('rotar-qr con solo_si_vacia y Redis caido: 503 alias_no_disponible y NO rota', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token } = await mesaAbierta();
  const redis = instalarFakeRedis({ caido: true });
  try {
    const r = await rotarManual(idMesa, { solo_si_vacia: true });
    assert.strictEqual(r.status, 503, JSON.stringify(r.body));
    assert.strictEqual(r.body.motivo, 'alias_no_disponible');
  } finally {
    redis.restaurar();
  }
  assert.strictEqual(await tokenGuardado(idMesa), token);
});

test('rotar-qr SIN solo_si_vacia y con comensales: rota como hoy (el "Nuevo QR" manual)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token } = await mesaAbierta();
  assert.strictEqual((await sesion(token, 'Dora')).status, 201);
  await pedidosService.crearConDetalles({ id_mesa: idMesa, id_usuario: null, items: [{ id_plato: plato.id_plato, cantidad: 1 }] });

  const r = await rotarManual(idMesa);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.notStrictEqual(await tokenGuardado(idMesa), token);

  const r2 = await rotarManual(idMesa, { solo_si_vacia: false });
  assert.strictEqual(r2.status, 201, JSON.stringify(r2.body));
});

test('rotar-qr con un campo extra: 400 cuerpo_invalido y el token NO cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { idMesa, token } = await mesaAbierta();
  const r = await rotarManual(idMesa, { solo_si_vacia: true, forzar: true });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.motivo, 'cuerpo_invalido');
  assert.strictEqual(await tokenGuardado(idMesa), token);
});

test('punta a punta con el rotador real del socket-server: ya no recibe 404, rota y anuncia qr:actualizado', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  try {
    const { idMesa, token: inicial } = await mesaAbierta();

    // Reloj inyectado: el ciclo solo corre cuando la prueba lo dispara.
    const pendientes = [];
    const emitidos = [];
    const silencio = { error() {}, info() {}, warn() {} };
    const rotador = crearRotadorQr({
      io: { to: () => ({ emit: (evento, datos) => emitidos.push({ evento, datos }) }) },
      qr: servicioQr,
      presencia: { calcular: async () => ({ total: 0 }) }, // nadie conectado por socket
      backend: crearClienteBackend({ url: `http://127.0.0.1:${servidor.address().port}`, claveInterna: CLAVE }),
      programar: (fn) => { pendientes.push(fn); return { unref() {} }; },
      cancelar: () => {},
      log: silencio,
    });
    const correrCiclo = async () => { await rotador.ciclo(idMesa); };

    rotador.abrir(idMesa, inicial);
    assert.strictEqual(rotador.activa(idMesa), true);

    // Ciclo 1: mesa abierta y vacía -> 200 -> anuncia el QR nuevo.
    await correrCiclo();
    assert.strictEqual(emitidos.length, 1, 'anuncio qr:actualizado');
    assert.strictEqual(emitidos[0].evento, 'qr:actualizado');
    const segundo = emitidos[0].datos.token_qr;
    assert.notStrictEqual(segundo, inicial);
    assert.strictEqual(await tokenGuardado(idMesa), segundo, 'el backend guardo el que se anuncio');
    assert.strictEqual(rotador.activa(idMesa), true, 'sigue rotando');

    // Ciclo 2: encadena con el token que el rotador recuerda.
    await correrCiclo();
    assert.strictEqual(emitidos.length, 2);
    const tercero = emitidos[1].datos.token_qr;
    assert.strictEqual(await tokenGuardado(idMesa), tercero);

    // Alguien escanea el QR vigente (aun sin socket abierto): el backend lo sabe
    // por su alias, responde 409 y el rotador deja de rotar. El QR queda fijo.
    assert.strictEqual((await sesion(tercero, 'Carla')).status, 201);
    await correrCiclo();
    assert.strictEqual(emitidos.length, 2, 'no anuncia nada nuevo');
    assert.strictEqual(rotador.activa(idMesa), false, 'el rotador se detuvo con el 409');
    assert.strictEqual(await tokenGuardado(idMesa), tercero, 'Carla conserva su QR');
    rotador.detenerTodo();
  } finally {
    await new Promise((r) => servidor.close(r));
  }
});
