const test = require('node:test');
const assert = require('node:assert');

/**
 * Cobro de MESA en caja (POST /transacciones/mesa) contra PostgreSQL real.
 *
 * Pedido de Jarrison tras la prueba de punta a punta: la Caja cobraba siempre
 * al primer pedido. Aquí se prueba el reparto de verdad (triggers, saldos,
 * liberación de la mesa), la idempotencia por id_cobro con peticiones a la vez,
 * la convivencia con el webhook de Wompi sobre la misma mesa, y el autor.
 *
 * MESAS PROPIAS (el criterio de #146 y #158): una por caso, desde
 * MESA_NUMERO_COBRO (904 por omisión), marcadas en `ubicacion`. El `after` lo
 * deja todo como estaba aunque una prueba falle:
 *   1. borra las transacciones de esas mesas y su rastro en auditoria_cambios,
 *      identificado por el id_transaccion del JSON (registro_id, para esta
 *      tabla, es el id_pedido: ver 08_triggers.sql);
 *   2. cierra la reserva de inventario de cada detalle con
 *      fn_cerrar_reserva_detalle(id, false), que DEVUELVE el stock (y no hace
 *      nada si ya estaba cerrada), sea cual sea el estado del pedido;
 *   3. borra el libro de esos detalles, los pedidos (detalles e historial caen
 *      en cascada) y las mesas.
 * Una corrida interrumpida se limpia al empezar la siguiente.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const crypto = require('node:crypto');
const { Pool } = require('pg');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const transaccionesService = require('../../src/services/transacciones.service');
const autorInexistente = require('../../src/services/autor-inexistente');

const MESA_BASE = parseInt(process.env.MESA_NUMERO_COBRO || '904', 10);
const MARCA_MESA = 'PRUEBA cobro-de-mesa';

let sonda = null;
let hayBase = false;
let plato = null; // { id_plato, precio_centavos }
let usuarioReal = null;
let siguienteMesa = MESA_BASE;

async function limpiar() {
  const mesas = await sonda.query('SELECT id_mesa, numero FROM mesas WHERE ubicacion = $1', [MARCA_MESA]);
  const ids = mesas.rows.map((m) => m.id_mesa);
  // Una mesa en el rango que NO es nuestra: no se toca nada.
  const ajena = await sonda.query(
    'SELECT numero FROM mesas WHERE numero >= $1 AND numero < $1 + 20 AND ubicacion <> $2 LIMIT 1',
    [MESA_BASE, MARCA_MESA]
  );
  if (ajena.rows.length) {
    throw new Error(`la mesa ${ajena.rows[0].numero} existe y no es de esta prueba: usa otro MESA_NUMERO_COBRO`);
  }
  if (ids.length === 0) return;

  const t = await sonda.query(
    `DELETE FROM transacciones
      WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_mesa = ANY($1::int[]))
      RETURNING id_transaccion`,
    [ids]
  );
  const idsT = t.rows.map((f) => f.id_transaccion);
  if (idsT.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios
        WHERE tabla_afectada = 'transacciones'
          AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
      [idsT]
    );
  }
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
}

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    const p = await sonda.query(
      `SELECT id_plato, ROUND(precio * 100)::bigint AS precio_centavos FROM platos
        WHERE disponible AND stock_suficiente AND NOT personalizable AND precio >= 5000
        ORDER BY id_plato LIMIT 1`
    );
    const u = await sonda.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1');
    plato = p.rows[0] ? { id_plato: p.rows[0].id_plato, precio_centavos: Number(p.rows[0].precio_centavos) } : null;
    usuarioReal = u.rows[0] || null;
    hayBase = Boolean(plato && usuarioReal);
    if (hayBase) await limpiar();
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.includes('MESA_NUMERO')) throw err;
    hayBase = false;
  }
});

test.after(async () => {
  try {
    if (hayBase) await limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Una mesa propia con `n` pedidos de un plato, llevados al estado dado. */
async function mesaConPedidos(n, estado = 'entregado') {
  const numero = siguienteMesa++;
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado) VALUES ($1, 4, $2, 'ocupada') RETURNING id_mesa`,
    [numero, MARCA_MESA]
  );
  const idMesa = m.rows[0].id_mesa;
  const pedidos = [];
  for (let i = 0; i < n; i++) {
    const ped = await pedidosService.crearConDetalles({
      id_mesa: idMesa, id_usuario: usuarioReal.id_usuario, items: [{ id_plato: plato.id_plato, cantidad: 1 }],
    });
    const camino = { recibido: [], en_preparacion: ['en_preparacion'], entregado: ['en_preparacion', 'listo', 'entregado'] }[estado];
    for (const e of camino) await pedidosService.actualizarEstado(ped.id_pedido, e, null, usuarioReal.id_usuario);
    pedidos.push(ped.id_pedido);
  }
  return { idMesa, pedidos };
}

const cobro = (idMesa, montoCentavos, extra = {}) => transaccionesService.cobrarMesaEnCaja({
  id_mesa: idMesa,
  monto_centavos: montoCentavos,
  metodo_pago: 'efectivo',
  id_cobro: crypto.randomUUID(),
  id_usuario: usuarioReal.id_usuario,
  ...extra,
});

async function estados(ids) {
  const { rows } = await sonda.query('SELECT id_pedido, estado FROM pedidos WHERE id_pedido = ANY($1::int[]) ORDER BY id_pedido', [ids]);
  return rows.map((r) => r.estado);
}
async function saldoMesa(idMesa) {
  const { rows } = await sonda.query(
    `SELECT COALESCE(SUM(ROUND(obtener_saldo_pendiente(id_pedido) * 100)), 0)::bigint AS s
       FROM pedidos WHERE id_mesa = $1 AND estado <> 'cancelado'`, [idMesa]);
  return Number(rows[0].s);
}
async function cobradoEnMesa(idMesa) {
  const { rows } = await sonda.query(
    `SELECT COALESCE(SUM(ROUND(t.monto * 100)), 0)::bigint AS s, count(*)::int AS n
       FROM transacciones t JOIN pedidos p ON p.id_pedido = t.id_pedido WHERE p.id_mesa = $1`, [idMesa]);
  return { centavos: Number(rows[0].s), filas: rows[0].n };
}
async function estadoMesa(idMesa) {
  const { rows } = await sonda.query('SELECT estado, token_qr FROM mesas WHERE id_mesa = $1', [idMesa]);
  return rows[0];
}

test('a. 3 pedidos entregados: un comensal paga el primero y luego "toda la mesa" el resto', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(3);

  const r1 = await cobro(idMesa, P, { comensal: 'Ana' });
  assert.strictEqual(r1.duplicado, false);
  assert.deepStrictEqual(r1.pagados.map((p) => p.id_pedido), [pedidos[0]], 'cae en el pedido mas viejo');
  assert.strictEqual(r1.saldo_restante_centavos, 2 * P);
  assert.strictEqual(r1.mesa_liberada, false);
  assert.deepStrictEqual(await estados(pedidos), ['pagado', 'entregado', 'entregado']);

  const r2 = await cobro(idMesa, 2 * P);
  assert.deepStrictEqual(r2.pagados.map((p) => p.id_pedido), [pedidos[1], pedidos[2]], 'reparte entre los que quedan');
  assert.deepStrictEqual(r2.transacciones.map((x) => [x.id_pedido, x.monto_centavos]), [[pedidos[1], P], [pedidos[2], P]]);
  assert.strictEqual(r2.saldo_restante_centavos, 0);
  assert.strictEqual(r2.mesa_liberada, true);
  assert.deepStrictEqual(await estados(pedidos), ['pagado', 'pagado', 'pagado']);
  const mesa = await estadoMesa(idMesa);
  assert.strictEqual(mesa.estado, 'disponible');
  assert.strictEqual(mesa.token_qr, null, 'mesa liberada: el QR deja de valer');
  assert.strictEqual(await saldoMesa(idMesa), 0);
});

test('b. un monto que cubre medio pedido deja saldo y el pedido no pasa a pagado', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(1);
  const mitad = Math.floor(P / 2);

  const r = await cobro(idMesa, mitad);
  assert.strictEqual(r.duplicado, false);
  assert.deepStrictEqual(r.pagados, []);
  assert.strictEqual(r.saldo_restante_centavos, P - mitad);
  assert.strictEqual(r.mesa_liberada, false);
  assert.deepStrictEqual(await estados(pedidos), ['entregado']);
  assert.strictEqual((await estadoMesa(idMesa)).estado, 'ocupada');
});

test('c. pedido aun en cocina: el pago queda registrado y el pedido no pasa a pagado', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(1, 'en_preparacion');

  const r = await cobro(idMesa, P);
  assert.strictEqual(r.duplicado, false);
  assert.deepStrictEqual(r.pagados, [], 'solo un pedido entregado puede pasar a pagado');
  assert.strictEqual(r.saldo_restante_centavos, 0);
  assert.strictEqual((await cobradoEnMesa(idMesa)).centavos, P, 'el dinero entro');
  assert.deepStrictEqual(await estados(pedidos), ['en_preparacion']);
  assert.strictEqual(r.mesa_liberada, false);
});

test('d. mas que el saldo: excede y no se escribe nada', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(2);

  const r = await cobro(idMesa, 2 * P + 1);
  assert.deepStrictEqual(r, { excede: true, saldo_centavos: 2 * P });
  assert.deepStrictEqual(await cobradoEnMesa(idMesa), { centavos: 0, filas: 0 });
  assert.deepStrictEqual(await estados(pedidos), ['entregado', 'entregado']);
});

test('e. el mismo id_cobro dos veces, en serie y a la vez: se cobra una sola vez', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa } = await mesaConPedidos(2);

  // En serie.
  const id = crypto.randomUUID();
  const primero = await cobro(idMesa, P, { id_cobro: id });
  const segundo = await cobro(idMesa, P, { id_cobro: id });
  assert.strictEqual(primero.duplicado, false);
  assert.deepStrictEqual(segundo, { duplicado: true, saldo_restante_centavos: P });
  assert.strictEqual((await cobradoEnMesa(idMesa)).centavos, P);

  // A la vez: dos peticiones con otro id_cobro igual entre ellas.
  const otro = crypto.randomUUID();
  const [x, y] = await Promise.all([cobro(idMesa, 1000, { id_cobro: otro }), cobro(idMesa, 1000, { id_cobro: otro })]);
  assert.deepStrictEqual([x.duplicado, y.duplicado].sort(), [false, true], 'una cobra y la otra es duplicado');
  assert.strictEqual((await cobradoEnMesa(idMesa)).centavos, P + 1000, 'el segundo cobro entro UNA vez');
});

test('f. caja y webhook de Wompi a la vez sobre la misma mesa: sin interbloqueo ni cobrar de mas', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(3);
  const saldo = 3 * P;
  // Cada uno intenta cobrar 2/3 del saldo: los dos juntos excederian.
  const parte = 2 * P;

  const [caja, wompi] = await Promise.all([
    cobro(idMesa, parte),
    transaccionesService.registrarPagoInterno({
      referencia_externa: `PRUEBA-${crypto.randomUUID()}`, id_mesa: idMesa, comensal: null,
      monto_centavos: parte, metodo_pago: 'online',
    }),
  ]);

  const exitos = [caja, wompi].filter((r) => r.duplicado === false);
  const excedidos = [caja, wompi].filter((r) => r.excede);
  assert.strictEqual(exitos.length, 1, 'uno cobra');
  assert.strictEqual(excedidos.length, 1, 'el otro ve el saldo ya reducido y no cobra de mas');
  assert.strictEqual(excedidos[0].saldo_centavos, saldo - parte);
  const cobrado = await cobradoEnMesa(idMesa);
  assert.strictEqual(cobrado.centavos, parte);
  assert.ok(cobrado.centavos <= saldo);
  assert.deepStrictEqual(await estados(pedidos), ['pagado', 'pagado', 'entregado']);
});

test('g. autor inexistente: 409 autor_inexistente y la base queda igual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(1);
  const { rows } = await sonda.query('SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS f FROM usuarios');
  const antes = { cobrado: await cobradoEnMesa(idMesa), estados: await estados(pedidos), mesa: await estadoMesa(idMesa) };

  await assert.rejects(
    () => cobro(idMesa, P, { id_usuario: Number(rows[0].f) }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );

  assert.deepStrictEqual(await cobradoEnMesa(idMesa), antes.cobrado, 'ni una transaccion');
  assert.deepStrictEqual(await estados(pedidos), antes.estados, 'el pedido sigue entregado');
  assert.deepStrictEqual(await estadoMesa(idMesa), antes.mesa, 'la mesa sigue igual');
});

test("h. el historial lleva el usuario de la sesion y 'Pago en caja'", async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(1);

  await cobro(idMesa, P);

  const { rows } = await sonda.query(
    `SELECT id_usuario, estado_anterior, observaciones FROM historial_estados
      WHERE id_pedido = $1 AND estado_nuevo = 'pagado'`, [pedidos[0]]);
  assert.deepStrictEqual(rows, [{ id_usuario: usuarioReal.id_usuario, estado_anterior: 'entregado', observaciones: 'Pago en caja' }]);
  const ref = await sonda.query(
    `SELECT referencia_externa FROM transacciones WHERE id_pedido = $1`, [pedidos[0]]);
  assert.match(ref.rows[0].referencia_externa, /^caja:[0-9a-f-]{36}$/);
});

test("el pago en linea sigue escribiendo su historial como siempre: sin autor y 'Pago en linea'", async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const { idMesa, pedidos } = await mesaConPedidos(1);

  const r = await transaccionesService.registrarPagoInterno({
    referencia_externa: `PRUEBA-${crypto.randomUUID()}`, id_mesa: idMesa, comensal: null, monto_centavos: P, metodo_pago: 'online',
  });
  assert.deepStrictEqual(Object.keys(r).sort(), ['duplicado', 'mesa_liberada', 'pagados', 'saldo_restante_centavos'], 'las mismas claves de siempre');

  const { rows } = await sonda.query(
    `SELECT id_usuario, observaciones FROM historial_estados WHERE id_pedido = $1 AND estado_nuevo = 'pagado'`, [pedidos[0]]);
  assert.deepStrictEqual(rows, [{ id_usuario: null, observaciones: 'Pago en linea' }]);
});

// ---------------------------------------------------------------------------
// id_cobro de OTRA mesa: 409 id_cobro_en_uso, no un duplicado
// ---------------------------------------------------------------------------

test('id_cobro usado en la mesa A y reusado en la mesa B: 409 id_cobro_en_uso y B no cambia', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const a = await mesaConPedidos(1);
  const b = await mesaConPedidos(1);
  const idCobro = crypto.randomUUID();

  const enA = await cobro(a.idMesa, P, { id_cobro: idCobro });
  assert.strictEqual(enA.duplicado, false);

  const antesB = { cobrado: await cobradoEnMesa(b.idMesa), estados: await estados(b.pedidos), mesa: await estadoMesa(b.idMesa) };
  const enB = await cobro(b.idMesa, P, { id_cobro: idCobro });
  assert.deepStrictEqual(enB, { idCobroEnUso: true }, 'ni duplicado ni cobro');
  assert.deepStrictEqual(await cobradoEnMesa(b.idMesa), antesB.cobrado, 'B no tiene ninguna transaccion nueva');
  assert.deepStrictEqual(await estados(b.pedidos), antesB.estados);
  assert.deepStrictEqual(await estadoMesa(b.idMesa), antesB.mesa);

  // Y en la misma mesa A, el mismo id_cobro sigue siendo un duplicado.
  const otraVezEnA = await cobro(a.idMesa, P, { id_cobro: idCobro });
  assert.strictEqual(otraVezEnA.duplicado, true);
  assert.ok(!('otraMesa' in otraVezEnA), 'el flag interno no sale');
  assert.strictEqual((await cobradoEnMesa(a.idMesa)).centavos, P, 'A se cobro una sola vez');
});

test('el mismo id_cobro a la vez en dos mesas distintas: una cobra y la otra 409 (no duplicado)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const a = await mesaConPedidos(1);
  const b = await mesaConPedidos(1);
  const idCobro = crypto.randomUUID();

  const [ra, rb] = await Promise.all([
    cobro(a.idMesa, P, { id_cobro: idCobro }),
    cobro(b.idMesa, P, { id_cobro: idCobro }),
  ]);
  const cobraron = [ra, rb].filter((r) => r.duplicado === false);
  const rechazados = [ra, rb].filter((r) => r.idCobroEnUso === true);
  assert.strictEqual(cobraron.length, 1, 'una cobra');
  assert.strictEqual(rechazados.length, 1, 'la otra es 409 id_cobro_en_uso, no duplicado');
  assert.ok(![ra, rb].some((r) => r.duplicado === true), 'ninguna contesta duplicado');

  const total = (await cobradoEnMesa(a.idMesa)).centavos + (await cobradoEnMesa(b.idMesa)).centavos;
  assert.strictEqual(total, P, 'entre las dos mesas se cobro una sola vez');
});

test('el pago en linea con una referencia de otra mesa sigue siendo duplicado (contrato de /internal)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const P = plato.precio_centavos;
  const a = await mesaConPedidos(1);
  const b = await mesaConPedidos(1);
  const ref = `PRUEBA-${crypto.randomUUID()}`;
  const pagar = (idMesa) => transaccionesService.registrarPagoInterno({
    referencia_externa: ref, id_mesa: idMesa, comensal: null, monto_centavos: P, metodo_pago: 'online',
  });

  assert.strictEqual((await pagar(a.idMesa)).duplicado, false);
  const enB = await pagar(b.idMesa);
  assert.deepStrictEqual(Object.keys(enB).sort(), ['duplicado', 'saldo_restante_centavos'], 'las mismas claves de siempre');
  assert.strictEqual(enB.duplicado, true);
  assert.deepStrictEqual(await cobradoEnMesa(b.idMesa), { centavos: 0, filas: 0 });
});
