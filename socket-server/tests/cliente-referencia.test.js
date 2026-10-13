// Prueba el cliente de referencia (examples/clienteMesa.js) contra el
// servidor real: lo que se documenta en docs/cliente.md tiene que funcionar.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, tokenComensal, firmar, CLAVE_INTERNA,
} = require('./helpers');

const RUTA = pathToFileURL(path.join(__dirname, '..', 'examples', 'clienteMesa.js')).href;
const cargar = () => import(RUTA);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const hasta = async (cond, ms = 2000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await pausa(20);
  }
  return false;
};
const linea = (cantidad = 1) => ({ accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 3, cantidad });

async function escenario(t, token = tokenComensal(5)) {
  const s = await levantar();
  const { crearClienteMesa } = await cargar();
  const cliente = crearClienteMesa({
    url: s.url,
    token,
    alias: 'Ana',
    esperas: { ackMs: 400, reintentosMs: [30, 30, 30, 30] },
    opcionesSocket: { transports: ['websocket'], reconnectionDelay: 50, reconnectionDelayMax: 100 },
  });
  t.after(async () => { cliente.cerrar(); await s.cerrar(); });
  return { s, cliente };
}

test('al conectar hace join:table con el alias y REEMPLAZA el carrito por el snapshot', async (t) => {
  const s0 = await levantar();
  t.after(() => s0.cerrar());
  const otro = await s0.conectar(tokenComensal(5));
  await emitir(otro, 'join:table', {});
  await emitir(otro, 'cart:update', { eventId: randomUUID(), ...linea(2) });

  const { crearClienteMesa } = await cargar();
  const cliente = crearClienteMesa({ url: s0.url, token: tokenComensal(5), alias: 'Ana', opcionesSocket: { transports: ['websocket'] } });
  t.after(() => cliente.cerrar());
  assert.ok(await hasta(() => cliente.estado === 'conectado'));
  assert.strictEqual(cliente.carrito.items.length, 1);
  assert.deepStrictEqual((await s0.presencia.calcular(5)).comensales, ['Ana']);
});

test('enviar pone eventId, resuelve con el ack y actualiza el carrito', async (t) => {
  const { cliente } = await escenario(t);
  await hasta(() => cliente.estado === 'conectado');
  const ack = await cliente.enviar('cart:update', linea());
  assert.strictEqual(ack.ok, true);
  assert.match(ack.eventId, /^[0-9a-f-]{36}$/);
  assert.strictEqual(cliente.carrito.version, 1);
});

test('cart:updated con version menor se descarta; mayor se aplica', async (t) => {
  const { s, cliente } = await escenario(t);
  await hasta(() => cliente.estado === 'conectado');
  await cliente.enviar('cart:update', linea());
  await cliente.enviar('cart:update', linea());
  s.io.to('room:mesa-5').emit('cart:updated', { carrito: { version: 1, items: [] } });
  await pausa(100);
  assert.strictEqual(cliente.carrito.version, 2, 'el viejo se ignoró');
  s.io.to('room:mesa-5').emit('cart:updated', { carrito: { version: 7, items: [] } });
  assert.ok(await hasta(() => cliente.carrito.version === 7));
});

test('ERROR_INTERNO: reintenta con el MISMO eventId hasta que entra', async (t) => {
  const { s, cliente } = await escenario(t);
  await hasta(() => cliente.estado === 'conectado');
  const vistos = [];
  const original = s.carritos.aplicarUnaVez;
  let fallos = 2;
  s.carritos.aplicarUnaVez = (idMesa, op, clave) => {
    vistos.push(op.eventId);
    if (fallos > 0) { fallos -= 1; throw new Error('falla simulada'); }
    return original(idMesa, op, clave);
  };
  const ack = await cliente.enviar('cart:update', linea());
  assert.strictEqual(ack.ok, true);
  assert.strictEqual(vistos.length, 3);
  assert.strictEqual(new Set(vistos).size, 1, 'todos los intentos con el mismo eventId');
});

test('errores definitivos no se reintentan y rechazan con su código', async (t) => {
  const { cliente } = await escenario(t);
  await hasta(() => cliente.estado === 'conectado');
  await assert.rejects(cliente.enviar('cart:update', { ...linea(), cantidad: 0 }), (e) => e.codigo === 'PAYLOAD_INVALIDO');
  await assert.rejects(cliente.enviar('cart:update', { accion: 'clear' }), (e) => e.codigo === 'NO_AUTORIZADO');
  assert.strictEqual(cliente.pendientes, 0);
});

test('corte de red: lo enviado sin conexión queda en cola y sale tras el nuevo join:table', async (t) => {
  const { s, cliente } = await escenario(t);
  await hasta(() => cliente.estado === 'conectado');
  cliente.socket.io.engine.close(); // la red se cae (no es el servidor quien corta)
  assert.ok(await hasta(() => cliente.estado === 'reconectando'));
  const envio = cliente.enviar('cart:update', linea(3));
  assert.strictEqual(cliente.pendientes, 1);
  const ack = await envio;
  assert.strictEqual(ack.ok, true);
  assert.strictEqual(cliente.estado, 'conectado');
  assert.strictEqual((await s.carritos.snapshot(5)).items[0].cantidad, 3);
});

test('mesa:liberada cierra la sesión: vacía carrito, rechaza la cola y no reconecta', async (t) => {
  const { s, cliente } = await escenario(t, firmar({ id_mesa: 5, rol: 'comensal', iat: Math.floor(Date.now() / 1000) - 60 }));
  await hasta(() => cliente.estado === 'conectado');
  await cliente.enviar('cart:update', linea());
  let liberada = null;
  cliente.on('mesa:liberada', (ev) => { liberada = ev; });
  await fetch(`${s.url}/internal/mesa-liberada`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5, motivo: 'pagada' }),
  });
  assert.ok(await hasta(() => cliente.estado === 'sesion_cerrada'));
  assert.strictEqual(liberada.motivo, 'pagada');
  assert.deepStrictEqual(cliente.carrito, { version: 0, items: [] });
  await assert.rejects(cliente.enviar('cart:update', linea()), (e) => e.codigo === 'SESION_CERRADA');
  await pausa(300);
  assert.strictEqual(cliente.socket.connected, false, 'no reconecta');
});

test('TOKEN_INVALIDO en el handshake cierra la sesión', async (t) => {
  const { cliente } = await escenario(t, 'token-basura');
  assert.ok(await hasta(() => cliente.estado === 'sesion_cerrada'));
});

test('uuidV4 produce UUID v4 también sin crypto.randomUUID', async () => {
  const { uuidV4 } = await cargar();
  const original = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const id = uuidV4();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
  }
});
