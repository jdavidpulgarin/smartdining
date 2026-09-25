const test = require('node:test');
const assert = require('node:assert');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal, firmar } = require('./helpers');

test('rechaza conexiones sin token, con token inválido, expirado o de otro secreto', async () => {
  const s = await levantar();
  await assert.rejects(s.conectar(null), { message: 'AUTH_REQUERIDA' });
  await assert.rejects(s.conectar('basura'), { message: 'TOKEN_INVALIDO' });
  await assert.rejects(s.conectar(firmar({ id_mesa: 1, rol: 'comensal' }, 'otro-secreto')), { message: 'TOKEN_INVALIDO' });
  await assert.rejects(s.conectar(firmar({ id_mesa: 1, rol: 'comensal' }, undefined, { expiresIn: -10 })), { message: 'TOKEN_INVALIDO' });
  await assert.rejects(s.conectar(firmar({ rol: 'superusuario' })), { message: 'TOKEN_INVALIDO' });
  await s.cerrar();
});

test('un comensal solo puede unirse a su propia mesa', async () => {
  const s = await levantar();
  const ana = await s.conectar(tokenComensal(1));
  const ok = await emitir(ana, 'join:table', {});
  assert.deepStrictEqual([ok.ok, ok.sala], [true, 'room:mesa-1']);
  const ajena = await emitir(ana, 'join:table', { id_mesa: 2 });
  assert.strictEqual(ajena.codigo, 'NO_AUTORIZADO');
  await s.cerrar();
});

test('aislamiento: lo emitido a una mesa no llega a otra ni al KDS', async () => {
  const s = await levantar();
  const m1 = await s.conectar(tokenComensal(1));
  const m2 = await s.conectar(tokenComensal(2));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  await emitir(m1, 'join:table', {});
  await emitir(m2, 'join:table', {});

  const en1 = esperar(m1, 'prueba');
  const en2 = esperar(m2, 'prueba');
  const enKds = esperar(cocina, 'prueba');
  s.io.to('room:mesa-1').emit('prueba', { x: 1 });
  assert.deepStrictEqual(await en1, { x: 1 });
  assert.strictEqual(await en2, null);
  assert.strictEqual(await enKds, null);
  await s.cerrar();
});

test('el personal entra a sus salas al conectar y puede vigilar cualquier mesa', async () => {
  const s = await levantar();
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const admin = await s.conectar(tokenPersonal('admin'));
  assert.strictEqual(s.io.sockets.adapter.rooms.get('room:kds').size, 2); // cocina + admin
  assert.strictEqual(s.io.sockets.adapter.rooms.get('room:admin').size, 2); // mesero + admin

  assert.strictEqual((await emitir(mesero, 'join:table', {})).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(mesero, 'join:table', { id_mesa: 7 })).ok, true);
  assert.strictEqual((await emitir(cocina, 'join:table', { id_mesa: 7 })).codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await emitir(admin, 'leave:table', { id_mesa: 7 })).ok, true);
  await s.cerrar();
});

test('leave:table saca al socket de la sala', async () => {
  const s = await levantar();
  const ana = await s.conectar(tokenComensal(3));
  await emitir(ana, 'join:table', {});
  await emitir(ana, 'leave:table', {});
  const recibido = esperar(ana, 'prueba');
  s.io.to('room:mesa-3').emit('prueba', {});
  assert.strictEqual(await recibido, null);
  await s.cerrar();
});
