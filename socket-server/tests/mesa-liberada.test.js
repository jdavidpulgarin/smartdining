const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPantalla, tokenPersonal, firmar, CLAVE_INTERNA,
} = require('./helpers');

const liberar = (s, cuerpo) => fetch(`${s.url}/internal/mesa-liberada`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
  body: JSON.stringify(cuerpo),
});
const generarQr = (s, id_mesa) => fetch(`${s.url}/qr/generar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPersonal('mesero')}` },
  body: JSON.stringify({ id_mesa }),
});
const validarQr = async (s, token) => (await fetch(`${s.url}/qr/validar`, {
  method: 'POST', body: JSON.stringify({ token }),
})).json();
const desconexion = (socket, ms = 1000) => new Promise((res) => {
  const t = setTimeout(() => res(null), ms);
  socket.once('disconnect', (motivo) => { clearTimeout(t); res(motivo); });
});
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// JWT de comensal emitido hace `seg` segundos (el grupo que ya estaba sentado).
const comensalDeAntes = (id_mesa, seg = 60) => tokenComensal(id_mesa, 'Ana', { iat: Math.floor(Date.now() / 1000) - seg });

async function escenario(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(comensalDeAntes(5));
  await emitir(ana, 'join:table', {});
  await emitir(ana, 'cart:update', {
    eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 3, cantidad: 1,
  });
  const pantalla = await s.conectar(tokenPantalla(5));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 5 });
  return { s, ana, pantalla, mesero };
}

test('el comensal recibe mesa:liberada antes de que se vacíe el carrito y queda desconectado', async (t) => {
  const { s, ana } = await escenario(t);
  // Se registra el orden real en el servidor: emitir mesa:liberada y vaciar.
  const orden = [];
  // socket.io no exporta BroadcastOperator: se toma el prototipo de una instancia.
  const proto = Object.getPrototypeOf(s.io.to('room:ninguna'));
  const emitOriginal = proto.emit;
  proto.emit = function emit(evento, ...args) {
    if (evento === 'mesa:liberada') orden.push('mesa:liberada');
    return emitOriginal.call(this, evento, ...args);
  };
  t.after(() => { proto.emit = emitOriginal; });
  const vaciarOriginal = s.carritos.vaciar;
  s.carritos.vaciar = (id) => { orden.push('vaciar'); return vaciarOriginal(id); };
  const llega = esperar(ana, 'mesa:liberada', 1000);
  const fuera = desconexion(ana);
  const r = await liberar(s, { id_mesa: 5, motivo: 'pagada' });
  assert.deepStrictEqual([r.status, (await r.json()).duplicado], [200, false]);

  const ev = await llega;
  assert.strictEqual(ev.id_mesa, 5);
  assert.strictEqual(ev.motivo, 'pagada');
  assert.ok(!Number.isNaN(Date.parse(ev.emitidoEn)));
  assert.strictEqual(await fuera, 'io server disconnect');
  assert.deepStrictEqual(orden, ['mesa:liberada', 'vaciar'], 'el evento sale antes de vaciar el carrito');
  assert.strictEqual(s.carritos.snapshot(5).items.length, 0);
});

test('la pantalla y el personal siguen conectados y el panel recibe el aviso', async (t) => {
  const { s, pantalla, mesero } = await escenario(t);
  const admin = await s.conectar(tokenPersonal('admin')); // en room:admin, sin join a la mesa
  const enPantalla = esperar(pantalla, 'mesa:liberada');
  const enMesero = esperar(mesero, 'mesa:liberada');
  const enAdmin = esperar(admin, 'mesa:liberada');
  await liberar(s, { id_mesa: 5 });

  assert.strictEqual((await enPantalla).motivo, 'liberada', 'sin motivo se usa "liberada"');
  assert.strictEqual((await enAdmin).id_mesa, 5);
  assert.ok(await enMesero);
  await pausa(100);
  assert.strictEqual(pantalla.connected, true);
  assert.strictEqual(mesero.connected, true);
  assert.ok(s.io.sockets.adapter.rooms.get('room:mesa-5').has(pantalla.id));
});

test('otra mesa no recibe nada ni pierde su carrito', async (t) => {
  const { s } = await escenario(t);
  const beto = await s.conectar(tokenComensal(7, 'Beto'));
  await emitir(beto, 'join:table', {});
  await emitir(beto, 'cart:update', {
    eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Beto', id_plato: 1, cantidad: 2,
  });
  const nada = esperar(beto, 'mesa:liberada', 300);
  await liberar(s, { id_mesa: 5 });
  assert.strictEqual(await nada, null);
  assert.strictEqual(beto.connected, true);
  assert.strictEqual(s.carritos.snapshot(7).items.length, 1);
});

test('liberar dos veces es idempotente: no repite el evento ni revoca de más', async (t) => {
  const { s, pantalla } = await escenario(t);
  const primero = esperar(pantalla, 'mesa:liberada');
  assert.strictEqual((await (await liberar(s, { id_mesa: 5 })).json()).duplicado, false);
  await primero;

  const repetido = esperar(pantalla, 'mesa:liberada', 300);
  const r2 = await liberar(s, { id_mesa: 5, motivo: 'pagada' });
  assert.deepStrictEqual([r2.status, (await r2.json()).duplicado], [200, true]);
  assert.strictEqual(await repetido, null, 'no se repite el evento');
});

test('tras un QR nuevo la mesa tiene sesión nueva y se puede volver a liberar', async (t) => {
  const { s, pantalla } = await escenario(t);
  await liberar(s, { id_mesa: 5 });
  await pausa(5);
  const { token } = await (await generarQr(s, 5)).json();
  assert.strictEqual((await validarQr(s, token)).valido, true);

  await pausa(5);
  const otra = esperar(pantalla, 'mesa:liberada');
  assert.strictEqual((await (await liberar(s, { id_mesa: 5 })).json()).duplicado, false);
  assert.ok(await otra);
  assert.strictEqual((await validarQr(s, token)).motivo, 'revocado');
});

test('un comensal del grupo anterior no puede reconectarse; uno nuevo sí entra', async (t) => {
  const { s } = await escenario(t);
  const viejoToken = comensalDeAntes(5);
  await liberar(s, { id_mesa: 5 });
  await assert.rejects(s.conectar(viejoToken), { message: 'TOKEN_INVALIDO' });

  // Un JWT emitido en un segundo posterior a la liberación (grupo nuevo) entra.
  await pausa(1100);
  const nuevo = await s.conectar(tokenComensal(5));
  const join = await emitir(nuevo, 'join:table', {});
  assert.strictEqual(join.ok, true);
  assert.deepStrictEqual(join.carrito.items, []);
});

test('un comensal viejo conectado pero fuera de la sala tampoco puede unirse después', async (t) => {
  const { s } = await escenario(t);
  const rezagado = await s.conectar(comensalDeAntes(5));
  await liberar(s, { id_mesa: 5 });
  const join = await emitir(rezagado, 'join:table', {});
  assert.strictEqual(join.codigo, 'NO_AUTORIZADO');
});

test('motivo o id_mesa inválidos responden 400; sin clave 401; nada cambia', async (t) => {
  const { s } = await escenario(t);
  assert.strictEqual((await liberar(s, { id_mesa: 5, motivo: 'robada' })).status, 400);
  assert.strictEqual((await liberar(s, { id_mesa: 'x' })).status, 400);
  const sinClave = await fetch(`${s.url}/internal/mesa-liberada`, { method: 'POST', body: JSON.stringify({ id_mesa: 5 }) });
  assert.strictEqual(sinClave.status, 401);
  assert.strictEqual(s.carritos.snapshot(5).items.length, 1);
});
