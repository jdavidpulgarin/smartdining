const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { claveAlias } = require('../src/alias');
const { calcularMonto, personasPorPagar } = require('../src/cuenta');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');
const { crearRedisFalso } = require('./redis-falso');
const { levantar, emitir, tokenComensal } = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');

// El comensal de la cuenta (/mesas/:id/cuenta/interno, el texto que guardó el
// backend en cada línea) se cruza con el alias del JWT por la CLAVE de alias.js
// (claveAlias): tildes, mayúsculas y espacios no cambian a la persona. Antes,
// «Ana» ≠ « ana » y «lo mío» daba SIN_SALDO (lo vio Daniel).

const VARIANTES_ANA = ['Ana', 'ana', ' ana ', 'ANA', 'Ána', 'ÁNA', 'Aná', 'ana  ', 'A.na', "An'a", 'A-n-a'];

test('claveAlias: la misma persona con tildes, mayúsculas, espacios y . _ \' -; lo inválido es null', () => {
  for (const v of VARIANTES_ANA) assert.strictEqual(claveAlias(v), 'ana', JSON.stringify(v));
  assert.strictEqual(claveAlias('Ana María'), claveAlias('ana   maria'));
  for (const malo of ['General', ' general ', '', 'a', 'x'.repeat(41), null, 5, 'Ana<script>']) {
    assert.strictEqual(claveAlias(malo), null, JSON.stringify(malo));
  }
});

test('«lo mío»: el comensal de la cuenta se compara por la clave, no por el texto exacto', () => {
  for (const enLaCuenta of VARIANTES_ANA) {
    const c = cuenta(5, 9_000_000, 9_000_000, { [enLaCuenta]: 2_500_000, Beto: 6_500_000 });
    for (const delJwt of ['Ana', 'Ána', 'ANA']) {
      assert.deepStrictEqual(
        calcularMonto({ modo: 'propio', cuenta: c, comensal: delJwt, personas: 2 }),
        { montoCentavos: 2_500_000 },
        `cuenta ${JSON.stringify(enLaCuenta)} / JWT ${delJwt}`,
      );
    }
  }
});

test('«lo mío»: si la cuenta trae a la misma persona en dos filas, se suman; otra persona no cuenta', () => {
  const c = cuenta(5, 9_000_000, 9_000_000, {
    Ana: 1_000_000, ' ana ': 1_500_000, Anabel: 3_000_000, General: 3_500_000,
  });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'Ana', personas: 3 }), { montoCentavos: 2_500_000 });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'Anabel', personas: 3 }), { montoCentavos: 3_000_000 });
  // Nadie es «General» (el cajón de lo que no tiene dueño), ni un alias inválido.
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: 'General', personas: 3 }), { error: 'SIN_SALDO' });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: c, comensal: '', personas: 3 }), { error: 'SIN_SALDO' });
  // Nunca más que el saldo de la mesa.
  const poca = cuenta(5, 9_000_000, 2_000_000, { Ana: 1_500_000, ana: 1_500_000 });
  assert.deepStrictEqual(calcularMonto({ modo: 'propio', cuenta: poca, comensal: 'ANA', personas: 1 }), { montoCentavos: 2_000_000 });
});

test('personasPorPagar: «Ana» presente y «ana» en pagaron son la misma persona', () => {
  assert.strictEqual(personasPorPagar({ comensales: ['Ana', 'Beto'], pagaron: ['ana'], comensal: 'Beto' }), 1);
  assert.strictEqual(personasPorPagar({ comensales: ['Ána', 'Beto'], pagaron: ['ANA'], comensal: 'beto' }), 1);
  assert.strictEqual(personasPorPagar({ comensales: ['Ana', 'Beto'], pagaron: [], comensal: ' ana ' }), 2, 'quien paga no cuenta dos veces');
});

for (const [nombre, crear] of [
  ['memoria', () => ({ e: crearEstadoMesasMemoria() })],
  ['Redis falso', () => { const falso = crearRedisFalso(); return { e: crearEstadoMesasRedis({ cliente: falso.cliente }), falso }; }],
]) {
  test(`[${nombre}] pagaron: una persona aunque se anote con tildes, mayúsculas o espacios distintos`, async () => {
    const { e } = crear();
    await e.marcarPago(5, 'Ana');
    await e.marcarPago(5, 'ana');
    await e.marcarPago(5, 'Ána');
    await e.marcarPago(5, 'Beto');
    assert.deepStrictEqual(await e.pagaron(5), ['Ana', 'Beto'], 'queda el primer alias con que se anotó');
    await e.desmarcarPago(5, 'ANA');
    assert.deepStrictEqual(await e.pagaron(5), ['Beto']);
  });
}

test('[Redis falso] pagaron anotado antes por el texto exacto: no se duplica y se puede deshacer', async () => {
  const falso = crearRedisFalso();
  const e = crearEstadoMesasRedis({ cliente: falso.cliente });
  await falso.cliente.hSet('sd:mesa:5:pagaron', 'Ana', 'Ana'); // formato viejo: campo = texto
  await e.marcarPago(5, 'ana');
  assert.deepStrictEqual(await e.pagaron(5), ['Ana']);
  await e.desmarcarPago(5, 'Ana');
  assert.deepStrictEqual(await e.pagaron(5), []);
});

test('POST /pagos/intencion «propio»: con la cuenta en « ana » y el JWT en «Ana», cobra lo de Ana (antes 409 SIN_SALDO)', async (t) => {
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, 9_000_000, 9_000_000, { ' ana ': 2_500_000, BETO: 6_500_000 }) }),
  });
  const s = await levantar(WOMPI_ENV, { backend, pasarela: pasarelaFalsa({}).pasarela });
  t.after(() => s.cerrar());
  const pedir = async (alias) => {
    const token = tokenComensal(5, alias);
    const c = await s.conectar(token);
    await emitir(c, 'join:table', {});
    return fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ modo: 'propio', eventId: crypto.randomUUID(), comensal: alias }),
    });
  };
  const ana = await pedir('Ana');
  assert.strictEqual(ana.status, 201);
  assert.strictEqual((await ana.json()).monto_en_centavos, 2_500_000);
  const beto = await pedir('Beto');
  assert.strictEqual(beto.status, 201);
  assert.strictEqual((await beto.json()).monto_en_centavos, 6_500_000);
});

const REDIS_URL = process.env.REDIS_URL;
test('Redis real: pagaron por clave, con el formato viejo (campo = texto) también', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const { crearConexionRedis } = require('../src/almacen/redis');
  const conexion = crearConexionRedis({ url: REDIS_URL, log: { info() {}, error() {} } });
  await conexion.conectar();
  const e = crearEstadoMesasRedis({ cliente: conexion.cliente });
  const mesa = 800000 + Math.floor(Math.random() * 90000);
  t.after(async () => {
    await e.limpiarMesa(mesa);
    await conexion.cerrar?.();
  });
  await conexion.cliente.hSet(`sd:mesa:${mesa}:pagaron`, 'Ana', 'Ana');
  await e.marcarPago(mesa, 'ána');
  await e.marcarPago(mesa, 'Beto');
  await e.marcarPago(mesa, ' beto ');
  assert.deepStrictEqual(await e.pagaron(mesa), ['Ana', 'Beto']);
  await e.desmarcarPago(mesa, 'ANA');
  assert.deepStrictEqual(await e.pagaron(mesa), ['Beto']);
});
