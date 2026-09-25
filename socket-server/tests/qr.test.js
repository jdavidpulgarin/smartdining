const test = require('node:test');
const assert = require('node:assert');
const { crearServicioQr } = require('../src/qr');
const { levantar, tokenPersonal, tokenComensal } = require('./helpers');

function servicio(secreto = 's3creto') {
  const reloj = { t: 1_000_000 };
  const qr = crearServicioQr({ secreto, ttlMinutosPorDefecto: 60, ahora: () => reloj.t });
  return { qr, reloj };
}

test('un token válido se puede validar VARIAS veces (reutilizable en la sesión)', () => {
  const { qr } = servicio();
  const { token } = qr.generar(5);
  for (let i = 0; i < 3; i += 1) assert.deepStrictEqual(qr.validar(token).id_mesa, 5);
});

test('expira de forma explícita', () => {
  const { qr, reloj } = servicio();
  const { token, expira_en } = qr.generar(5, 10);
  assert.strictEqual(expira_en, reloj.t + 10 * 60 * 1000);
  reloj.t += 10 * 60 * 1000 - 1;
  assert.strictEqual(qr.validar(token).valido, true);
  reloj.t += 1;
  assert.deepStrictEqual(qr.validar(token), { valido: false, motivo: 'expirado' });
});

test('rechaza tokens manipulados: mesa cambiada, expiración alargada, firma ajena, basura', () => {
  const { qr } = servicio();
  const { token } = qr.generar(5, 10);
  const [v, payload, firma] = token.split('.');
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString());

  const conMesa = Buffer.from(JSON.stringify({ ...p, m: 6 })).toString('base64url');
  assert.strictEqual(qr.validar(`${v}.${conMesa}.${firma}`).motivo, 'firma');
  const conExp = Buffer.from(JSON.stringify({ ...p, exp: p.exp + 9e9 })).toString('base64url');
  assert.strictEqual(qr.validar(`${v}.${conExp}.${firma}`).motivo, 'firma');

  const otro = crearServicioQr({ secreto: 'otro' }).generar(5).token;
  assert.strictEqual(qr.validar(otro).motivo, 'firma');
  for (const basura of ['', 'a.b', 'v2.a.b', null, 42, 'v1..', 'x'.repeat(600)]) {
    assert.strictEqual(qr.validar(basura).valido, false);
  }
});

test('liberar la mesa revoca los QR anteriores pero no el siguiente', () => {
  const { qr, reloj } = servicio();
  const viejo = qr.generar(5).token;
  const deOtraMesa = qr.generar(6).token;
  reloj.t += 1000;
  qr.revocarMesa(5);
  assert.strictEqual(qr.validar(viejo).motivo, 'revocado');
  assert.strictEqual(qr.validar(deOtraMesa).valido, true);
  reloj.t += 1000;
  assert.strictEqual(qr.validar(qr.generar(5).token).valido, true);
});

test('valida el rango del TTL y el id de mesa', () => {
  const { qr } = servicio();
  assert.throws(() => qr.generar(5, 0), RangeError);
  assert.throws(() => qr.generar(5, 1441), RangeError);
  assert.throws(() => qr.generar('5'), RangeError);
});

test('HTTP: generar exige rol de personal; validar es público; mesa-liberada revoca', async () => {
  const s = await levantar({ INTERNAL_API_KEY: 'k' });
  const post = (ruta, cuerpo, cabeceras = {}) => fetch(`${s.url}${ruta}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, body: JSON.stringify(cuerpo),
  });
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });

  assert.strictEqual((await post('/qr/generar', { id_mesa: 5 })).status, 401);
  assert.strictEqual((await post('/qr/generar', { id_mesa: 5 }, bearer(tokenComensal(5)))).status, 403);
  assert.strictEqual((await post('/qr/generar', { id_mesa: 5 }, bearer(tokenPersonal('cocina')))).status, 403);
  assert.strictEqual((await post('/qr/generar', { id_mesa: 'x' }, bearer(tokenPersonal('mesero')))).status, 400);
  assert.strictEqual((await post('/qr/generar', { id_mesa: 5, ttl_minutos: 99999 }, bearer(tokenPersonal('mesero')))).status, 400);

  const r = await post('/qr/generar', { id_mesa: 5, ttl_minutos: 30 }, bearer(tokenPersonal('mesero')));
  assert.strictEqual(r.status, 201);
  const { token } = await r.json();

  const ok = await post('/qr/validar', { token });
  assert.deepStrictEqual([ok.status, (await ok.json()).id_mesa], [200, 5]);
  assert.strictEqual((await post('/qr/validar', { token: token + 'x' })).status, 401);

  assert.strictEqual((await post('/internal/mesa-liberada', { id_mesa: 5 })).status, 401);
  await new Promise((r2) => setTimeout(r2, 5)); // el QR debe ser anterior a la liberación
  assert.strictEqual((await post('/internal/mesa-liberada', { id_mesa: 5 }, { 'x-internal-key': 'k' })).status, 200);
  const revocado = await post('/qr/validar', { token });
  assert.deepStrictEqual([revocado.status, (await revocado.json()).motivo], [401, 'revocado']);
  await s.cerrar();
});
