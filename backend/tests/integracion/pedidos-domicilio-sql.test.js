const test = require('node:test');
const assert = require('node:assert');

/**
 * D-20b: pedidos para llevar y a domicilio desde la app, contra PostgreSQL REAL
 * (script 36: por_pagar, registrar_pago_anticipado, cancelar_pedido_por_pagar,
 * cancelar_por_pagar_vencidos, cotizar_zona y pagos_por_devolver).
 *
 * Las CARRERAS son el centro: por_pagar -> recibido y por_pagar -> cancelado
 * nunca pasan los dos.
 *   - dos confirmaciones del mismo pago a la vez;
 *   - confirmar contra cancelar (el cliente);
 *   - vencimiento contra confirmación.
 *
 * DATOS PROPIOS: un cliente y una zona con barrios de esta corrida, y platos de
 * tests/helpers/plato-prueba.js (uno con receta: el stock). Se borra todo en el
 * `after` (y lo que dejó una corrida cortada, al empezar).
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || `clave-de-prueba-d20b-${Date.now()}`;

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const { firmarTokenCliente } = require('../../src/controllers/clientes-auth.controller');
const vencimiento = require('../../src/services/vencimiento-por-pagar');

const CORRIDA = crypto.randomBytes(5).toString('hex');
const DOMINIO = `prueba-d20b-${CORRIDA}.test`;
const PREFIJO_ZONA = `prueba-d20b-${CORRIDA}`;
const BARRIO = `barrio d20b ${CORRIDA}`;
const HASH = `$2b$10$${'x'.repeat(53)}`;
const ENVIO = 5000;

let sonda = null;
let hayBase = false;
let ana = null; // { id, jwt, direccion, fuera }
let beto = null;
let caro = null; // sin teléfono en el perfil
let platoLibre = null; // sin receta, 10.000
let conStock = null; // con receta propia, 12.000
const clave = () => process.env.INTERNAL_API_KEY;

async function limpiar() {
  const { rows: cs } = await sonda.query('SELECT id_cliente FROM clientes WHERE email LIKE $1::text', [`%@${DOMINIO}`]);
  const idsClientes = cs.map((r) => r.id_cliente);
  if (idsClientes.length) {
    const { rows: ps } = await sonda.query('SELECT id_pedido FROM pedidos WHERE id_cliente = ANY($1::int[])', [idsClientes]);
    const ids = ps.map((r) => r.id_pedido);
    if (ids.length) {
      const d = await sonda.query('DELETE FROM pagos_por_devolver WHERE id_pedido = ANY($1::int[]) RETURNING id', [ids]);
      if (d.rows.length) {
        await sonda.query(
          `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'pagos_por_devolver'
             AND COALESCE(datos_nuevos->>'id', datos_anteriores->>'id')::int = ANY($1::int[])`,
          [d.rows.map((r) => r.id)]
        );
      }
      const t = await sonda.query('DELETE FROM transacciones WHERE id_pedido = ANY($1::int[]) RETURNING id_transaccion', [ids]);
      if (t.rows.length) {
        await sonda.query(
          `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'transacciones'
             AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
          [t.rows.map((r) => r.id_transaccion)]
        );
      }
      await sonda.query(
        `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
           FROM detalles_pedido dp WHERE dp.id_pedido = ANY($1::int[]) ORDER BY dp.id_detalle`,
        [ids]
      );
      await sonda.query(
        `DELETE FROM movimientos_inventario
          WHERE id_detalle IN (SELECT id_detalle FROM detalles_pedido WHERE id_pedido = ANY($1::int[]))`,
        [ids]
      );
      await sonda.query('DELETE FROM pedidos WHERE id_pedido = ANY($1::int[])', [ids]);
    }
    await sonda.query('DELETE FROM clientes WHERE id_cliente = ANY($1::int[])', [idsClientes]);
  }
  await sonda.query('DELETE FROM zonas_envio WHERE nombre LIKE $1::text', [`${PREFIJO_ZONA}%`]);
}

async function crearCliente(nombre, { telefono = '3001234567' } = {}) {
  const c = await sonda.query(
    `INSERT INTO clientes (nombre, email, telefono, password_hash)
     VALUES ($1::varchar, $2::varchar, $3::varchar, $4::varchar) RETURNING id_cliente`,
    [nombre, `${nombre.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@${DOMINIO}`, telefono, HASH]
  );
  const id = c.rows[0].id_cliente;
  const dentro = await sonda.query(
    `INSERT INTO direcciones (id_cliente, direccion, barrio, principal)
     VALUES ($1::int, 'Calle 1 # 2-3', $2::varchar, TRUE) RETURNING id_direccion`,
    [id, `  ${BARRIO.toUpperCase()} `]
  );
  const fuera = await sonda.query(
    `INSERT INTO direcciones (id_cliente, direccion, barrio, principal)
     VALUES ($1::int, 'Lejos 9', $2::varchar, FALSE) RETURNING id_direccion`,
    [id, `fuera ${CORRIDA}`]
  );
  return { id, jwt: firmarTokenCliente(id).token, direccion: dentro.rows[0].id_direccion, fuera: fuera.rows[0].id_direccion };
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  await limpiar();
  await sonda.query(
    `INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
     VALUES ($1::varchar, $2::text[], $3::numeric, 40)`,
    [`${PREFIJO_ZONA} norte`, [BARRIO], ENVIO]
  );
  ana = await crearCliente('Ana');
  beto = await crearCliente('Beto');
  caro = await crearCliente('Caro', { telefono: null });
  platoLibre = (await crearCatalogoPrueba(sonda, 'pedidos-domicilio', { precio: 10000 }));
  conStock = (await crearCatalogoPrueba(sonda, 'pedidos-domicilio-stock', { receta: true, precio: 12000 }));
  hayBase = true;
});

test.after(async () => {
  try {
    if (hayBase) {
      await limpiar();
      await platoLibre.limpiar();
      await conStock.limpiar();
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

const saltar = (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return true;
  }
  return false;
};

const v1 = (c) => ({
  crear: (cuerpo) => request(app).post('/api/v1/pedidos-domicilio').set('Authorization', `Bearer ${c.jwt}`).send(cuerpo),
  mios: () => request(app).get('/api/v1/pedidos-domicilio/mios').set('Authorization', `Bearer ${c.jwt}`),
  cancelar: (id) => request(app).post(`/api/v1/pedidos-domicilio/${id}/cancelar`).set('Authorization', `Bearer ${c.jwt}`),
});

const cobro = (id, idCliente) => request(app)
  .get(`/api/pedidos-domicilio/${id}/cobro/interno?id_cliente=${idCliente}`).set('x-internal-key', clave());

const pagar = (id, referencia, montoCentavos) => request(app)
  .post(`/api/pedidos-domicilio/${id}/pago/interno`).set('x-internal-key', clave())
  .send({
    referencia_externa: referencia,
    id_transaccion_pasarela: `tx-${crypto.randomBytes(4).toString('hex')}`,
    pasarela: 'wompi',
    monto_centavos: montoCentavos,
    moneda: 'COP',
    metodo_pago: 'online',
  });

/**
 * Cierra los pedidos en por_pagar que haya dejado un caso anterior (preparación:
 * desde el ajuste de Juan, un cliente solo puede tener uno en por_pagar).
 */
async function sinPendientes(c) {
  await sonda.query(
    "SELECT cancelar_pedido_por_pagar(id_pedido, 'preparación de la prueba') FROM pedidos WHERE id_cliente = $1::int AND estado = 'por_pagar'",
    [c.id]
  );
}

/** Un pedido a domicilio de Ana por un plato de 10.000 (+ 5.000 de envío). */
async function pedidoDeAna({ canal = 'domicilio', plato = platoLibre.plato, cantidad = 1, quien = null } = {}) {
  const c = quien || ana;
  await sinPendientes(c);
  const cuerpo = { canal, items: [{ id_plato: plato.id_plato, cantidad }] };
  if (canal === 'domicilio') cuerpo.id_direccion = c.direccion;
  const res = await v1(c).crear(cuerpo);
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body.pedido;
}

async function estado(idPedido) {
  const { rows } = await sonda.query('SELECT estado FROM pedidos WHERE id_pedido = $1::int', [idPedido]);
  return rows[0].estado;
}

async function pagosDe(idPedido) {
  const t = await sonda.query("SELECT count(*)::int AS n FROM transacciones WHERE id_pedido = $1::int AND estado_transaccion = 'completada'", [idPedido]);
  const d = await sonda.query('SELECT motivo FROM pagos_por_devolver WHERE id_pedido = $1::int', [idPedido]);
  return { transacciones: t.rows[0].n, porDevolver: d.rows.map((r) => r.motivo) };
}

/** Lleva el pedido más allá de su plazo (la base calcula vence_en desde creado_en). */
async function vencer(idPedido) {
  await sonda.query("UPDATE pedidos SET creado_en = creado_en - interval '1 hour' WHERE id_pedido = $1::int", [idPedido]);
}

// ---------------------------------------------------------------------------
// Crear, listar y cancelar (la app)
// ---------------------------------------------------------------------------

test('crear a domicilio: por_pagar, total con el envío, vence_en a 15 min, la dirección copiada y la zona cotizada', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  assert.strictEqual(p.estado, 'por_pagar');
  assert.strictEqual(p.canal, 'domicilio');
  assert.strictEqual(p.total, 10000 + ENVIO);
  assert.strictEqual(p.costo_envio, ENVIO);
  assert.deepStrictEqual(
    { ...p.entrega },
    { direccion: 'Calle 1 # 2-3', barrio: `  ${BARRIO.toUpperCase()} `, zona: `${PREFIJO_ZONA} norte`, estado_entrega: 'por_asignar' }
  );
  const { rows } = await sonda.query(
    `SELECT p.id_mesa, p.id_cliente, extract(epoch FROM ($2::timestamptz - p.creado_en))::int AS segundos,
            d.telefono_contacto, d.costo_envio
       FROM pedidos p JOIN pedidos_domicilio d ON d.id_pedido = p.id_pedido WHERE p.id_pedido = $1::int`,
    [p.id_pedido, p.vence_en]
  );
  assert.deepStrictEqual(
    [rows[0].id_mesa, rows[0].id_cliente, rows[0].segundos, rows[0].telefono_contacto, Number(rows[0].costo_envio)],
    [null, ana.id, 15 * 60, '3001234567', ENVIO]
  );
  const kds = await sonda.query("SELECT count(*)::int AS n FROM obtener_pedidos_activos() WHERE id_pedido = $1::int", [p.id_pedido]);
  assert.strictEqual(kds.rows[0].n, 0, 'por_pagar no llega a cocina');
});

test('crear para llevar: sin entrega ni envío', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna({ canal: 'para_llevar' });
  assert.deepStrictEqual([p.canal, p.estado, p.total, p.costo_envio, p.entrega], ['para_llevar', 'por_pagar', 10000, 0, null]);
});

test('crear: dirección fuera de cobertura -> 422; dirección de otro cliente -> 404', async (t) => {
  if (saltar(t)) return;
  const fuera = await v1(ana).crear({ canal: 'domicilio', id_direccion: ana.fuera, items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }] });
  assert.deepStrictEqual([fuera.status, fuera.body.motivo], [422, 'fuera_de_cobertura']);
  const ajena = await v1(ana).crear({ canal: 'domicilio', id_direccion: beto.direccion, items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }] });
  assert.deepStrictEqual([ajena.status, ajena.body.motivo], [404, 'no_encontrado']);
});

test('crear sin stock: 409 sin_stock con disponible, como en POST /pedidos, y no queda nada', async (t) => {
  if (saltar(t)) return;
  await sinPendientes(ana);
  const { rows } = await sonda.query('SELECT stock_actual FROM insumos WHERE id_insumo = $1::int', [conStock.idInsumo]);
  const delta = 2 - Number(rows[0].stock_actual);
  await sonda.query('SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)', [conStock.idInsumo, 'ajuste', delta, 'prueba d20b']);
  const antes = await sonda.query('SELECT count(*)::int AS n FROM pedidos WHERE id_cliente = $1::int', [ana.id]);
  const res = await v1(ana).crear({ canal: 'para_llevar', items: [{ id_plato: conStock.plato.id_plato, cantidad: 3 }] });
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'sin_stock');
  assert.strictEqual(res.body.faltantes[0].disponible, 2);
  const despues = await sonda.query('SELECT count(*)::int AS n FROM pedidos WHERE id_cliente = $1::int', [ana.id]);
  assert.strictEqual(despues.rows[0].n, antes.rows[0].n, 'nada a medias');
  // Se repone para los demás casos.
  await sonda.query('SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)', [conStock.idInsumo, 'ajuste', 1000, 'prueba d20b']);
});

test('mios: solo los del cliente, del más nuevo al más viejo', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna({ canal: 'para_llevar' });
  const deAna = await v1(ana).mios();
  assert.strictEqual(deAna.status, 200);
  assert.strictEqual(deAna.body.pedidos[0].id_pedido, p.id_pedido);
  const deBeto = await v1(beto).mios();
  assert.ok(!deBeto.body.pedidos.some((x) => x.id_pedido === p.id_pedido), 'Beto no ve los de Ana');
});

test('cancelar en por_pagar: 200 y el stock vuelve; otra vez -> 409 pedido_ya_cancelado; de otro cliente -> 404', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna({ canal: 'para_llevar', plato: conStock.plato });
  const ajeno = await v1(beto).cancelar(p.id_pedido);
  assert.deepStrictEqual([ajeno.status, ajeno.body.motivo], [404, 'no_encontrado']);
  const ok = await v1(ana).cancelar(p.id_pedido);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.pedido.estado, 'cancelado');
  const libro = await sonda.query(
    `SELECT COALESCE(SUM(m.cantidad), 0)::numeric AS neto FROM movimientos_inventario m
       JOIN detalles_pedido d ON d.id_detalle = m.id_detalle WHERE d.id_pedido = $1::int`,
    [p.id_pedido]
  );
  assert.strictEqual(Number(libro.rows[0].neto), 0, 'reserva y devolución se anulan: el stock volvió');
  const otra = await v1(ana).cancelar(p.id_pedido);
  assert.deepStrictEqual([otra.status, otra.body.motivo], [409, 'pedido_ya_cancelado']);
});

// ---------------------------------------------------------------------------
// El cobro y el pago (socket-server)
// ---------------------------------------------------------------------------

test('cobro: monto en centavos con el envío y la MISMA referencia cada vez; otro cliente 404; vencido 409', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const a = await cobro(p.id_pedido, ana.id);
  const b = await cobro(p.id_pedido, ana.id);
  assert.strictEqual(a.status, 200, JSON.stringify(a.body));
  assert.strictEqual(a.body.monto_centavos, (10000 + ENVIO) * 100);
  assert.match(a.body.referencia, new RegExp(`^SD-P-${p.id_pedido}-[0-9A-F]{5}$`));
  assert.strictEqual(b.body.referencia, a.body.referencia, 'una sola intención por pedido');
  assert.deepStrictEqual([(await cobro(p.id_pedido, beto.id)).status], [404]);
  await vencer(p.id_pedido);
  const vencido = await cobro(p.id_pedido, ana.id);
  assert.deepStrictEqual([vencido.status, vencido.body.motivo], [409, 'pedido_vencido']);
});

test('pago confirmado: por_pagar -> recibido, una transacción; el reintento -> 200 duplicado con lo mismo', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const { body: c } = await cobro(p.id_pedido, ana.id);
  const r1 = await pagar(p.id_pedido, c.referencia, c.monto_centavos);
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.body));
  assert.deepStrictEqual([r1.body.resultado, r1.body.duplicado], ['confirmado', false]);
  assert.ok(Number.isInteger(r1.body.id_transaccion));
  assert.strictEqual(await estado(p.id_pedido), 'recibido', 'llega a cocina');
  const r2 = await pagar(p.id_pedido, c.referencia, c.monto_centavos);
  assert.strictEqual(r2.status, 200);
  assert.deepStrictEqual([r2.body.duplicado, r2.body.resultado, r2.body.id_transaccion], [true, 'confirmado', r1.body.id_transaccion]);
  assert.deepStrictEqual(await pagosDe(p.id_pedido), { transacciones: 1, porDevolver: [] });
  const cancelado = await v1(ana).cancelar(p.id_pedido);
  assert.deepStrictEqual([cancelado.status, cancelado.body.motivo], [409, 'pedido_pagado']);
});

test('pago por otro monto: no se rechaza, queda en pagos_por_devolver (monto_distinto) y el pedido sigue por_pagar', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const { body: c } = await cobro(p.id_pedido, ana.id);
  const r = await pagar(p.id_pedido, c.referencia, c.monto_centavos - 100);
  assert.strictEqual(r.status, 201, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.resultado, r.body.motivo_devolucion, r.body.id_transaccion], ['por_devolver', 'monto_distinto', null]);
  assert.strictEqual(await estado(p.id_pedido), 'por_pagar');
});

test('pago de un pedido ya cancelado: no se rechaza, queda por devolver (pedido_cancelado); referencia de otro pedido -> 400', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const { body: c } = await cobro(p.id_pedido, ana.id);
  assert.strictEqual((await v1(ana).cancelar(p.id_pedido)).status, 200);
  const r = await pagar(p.id_pedido, c.referencia, c.monto_centavos);
  assert.deepStrictEqual([r.status, r.body.resultado, r.body.motivo_devolucion], [201, 'por_devolver', 'pedido_cancelado']);
  const otra = await pagar(p.id_pedido, `SD-P-${p.id_pedido + 1}-AAAAA`, c.monto_centavos);
  assert.deepStrictEqual([otra.status, otra.body.motivo], [400, 'referencia_invalida']);
});

// ---------------------------------------------------------------------------
// Carreras
// ---------------------------------------------------------------------------

test('CARRERA: dos confirmaciones del mismo pago a la vez -> una confirma, la otra es duplicado; una sola transacción', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const { body: c } = await cobro(p.id_pedido, ana.id);
  const [a, b] = await Promise.all([
    pagar(p.id_pedido, c.referencia, c.monto_centavos),
    pagar(p.id_pedido, c.referencia, c.monto_centavos),
  ]);
  assert.deepStrictEqual([a.status, b.status].sort(), [200, 201], `${a.status} ${b.status}`);
  assert.strictEqual(a.body.id_transaccion, b.body.id_transaccion);
  assert.deepStrictEqual(await pagosDe(p.id_pedido), { transacciones: 1, porDevolver: [] });
  assert.strictEqual(await estado(p.id_pedido), 'recibido');
});

test('CARRERA: confirmar contra cancelar (el cliente) -> nunca los dos', async (t) => {
  if (saltar(t)) return;
  for (let vuelta = 0; vuelta < 5; vuelta += 1) {
    const p = await pedidoDeAna();
    const { body: c } = await cobro(p.id_pedido, ana.id);
    const [pago, cancelacion] = await Promise.all([
      pagar(p.id_pedido, c.referencia, c.monto_centavos),
      v1(ana).cancelar(p.id_pedido),
    ]);
    const final = await estado(p.id_pedido);
    const pagos = await pagosDe(p.id_pedido);
    if (pago.body.resultado === 'confirmado') {
      assert.deepStrictEqual([cancelacion.status, cancelacion.body.motivo, final], [409, 'pedido_pagado', 'recibido']);
      assert.deepStrictEqual(pagos, { transacciones: 1, porDevolver: [] });
    } else {
      assert.deepStrictEqual([cancelacion.status, pago.body.resultado, final], [200, 'por_devolver', 'cancelado']);
      assert.deepStrictEqual(pagos, { transacciones: 0, porDevolver: ['pedido_cancelado'] });
    }
  }
});

test('CARRERA: vencimiento contra confirmación -> nunca los dos (el pago tardío queda por devolver)', async (t) => {
  if (saltar(t)) return;
  for (let vuelta = 0; vuelta < 5; vuelta += 1) {
    const p = await pedidoDeAna();
    const { body: c } = await cobro(p.id_pedido, ana.id);
    await vencer(p.id_pedido);
    const [pago] = await Promise.all([
      pagar(p.id_pedido, c.referencia, c.monto_centavos),
      vencimiento.cancelarVencidos(),
    ]);
    const final = await estado(p.id_pedido);
    const pagos = await pagosDe(p.id_pedido);
    if (pago.body.resultado === 'confirmado') {
      // El pago llegó primero (o el vencimiento lo saltó por SKIP LOCKED): sigue pagado.
      assert.strictEqual(final, 'recibido');
      assert.deepStrictEqual(pagos, { transacciones: 1, porDevolver: [] });
    } else {
      assert.strictEqual(final, 'cancelado');
      assert.deepStrictEqual(pagos, { transacciones: 0, porDevolver: ['pedido_cancelado'] });
    }
  }
});

test('vencimiento: la tarea cancela lo vencido (y no lo que sigue en plazo); el stock vuelve', async (t) => {
  if (saltar(t)) return;
  // Dos clientes: con el ajuste de Juan, uno solo no puede tener dos en por_pagar.
  const vencido = await pedidoDeAna({ canal: 'para_llevar', plato: conStock.plato });
  const vigente = await pedidoDeAna({ canal: 'para_llevar', plato: conStock.plato, quien: beto });
  await vencer(vencido.id_pedido);
  const tarea = vencimiento.crearTareaVencimiento({ registro: { log() {}, error() {} } });
  await tarea.pasada();
  assert.ok(tarea.estado().cancelados >= 1);
  assert.strictEqual(await estado(vencido.id_pedido), 'cancelado');
  assert.strictEqual(await estado(vigente.id_pedido), 'por_pagar');
  const libro = await sonda.query(
    `SELECT COALESCE(SUM(m.cantidad), 0)::numeric AS neto FROM movimientos_inventario m
       JOIN detalles_pedido d ON d.id_detalle = m.id_detalle WHERE d.id_pedido = $1::int`,
    [vencido.id_pedido]
  );
  assert.strictEqual(Number(libro.rows[0].neto), 0, 'el stock volvió');
});

// ---------------------------------------------------------------------------
// Ajustes de Juan: un solo por_pagar por cliente, teléfono y GET /:id
// ---------------------------------------------------------------------------

test('un solo por_pagar: el segundo POST -> 409 pedido_pendiente con el primero, sin crear otro; cancelado, ya se puede', async (t) => {
  if (saltar(t)) return;
  const primero = await pedidoDeAna();
  const cuerpo = { canal: 'para_llevar', items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 3 }] };
  const otro = await v1(ana).crear(cuerpo);
  assert.strictEqual(otro.status, 409, JSON.stringify(otro.body));
  assert.strictEqual(otro.body.motivo, 'pedido_pendiente');
  assert.strictEqual(otro.body.pedido.id_pedido, primero.id_pedido, 'el que ya tenía (el reintento de la app lo recupera)');
  assert.strictEqual(otro.body.pedido.estado, 'por_pagar');
  const { rows } = await sonda.query("SELECT count(*)::int AS n FROM pedidos WHERE id_cliente = $1::int AND estado = 'por_pagar'", [ana.id]);
  assert.strictEqual(rows[0].n, 1);
  assert.strictEqual((await v1(ana).cancelar(primero.id_pedido)).status, 200);
  assert.strictEqual((await v1(ana).crear(cuerpo)).status, 201);
});

test('un solo por_pagar: uno VENCIDO que el temporizador no canceló no cuenta: se cancela en la misma transacción y se crea el nuevo', async (t) => {
  if (saltar(t)) return;
  const viejo = await pedidoDeAna({ canal: 'para_llevar', plato: conStock.plato });
  await vencer(viejo.id_pedido);
  const res = await v1(ana).crear({ canal: 'para_llevar', items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }] });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(await estado(viejo.id_pedido), 'cancelado');
  const h = await sonda.query(
    "SELECT observaciones FROM historial_estados WHERE id_pedido = $1::int AND estado_nuevo = 'cancelado'",
    [viejo.id_pedido]
  );
  assert.deepStrictEqual(h.rows.map((r) => r.observaciones), ['Pago anticipado no aprobado a tiempo']);
  const libro = await sonda.query(
    `SELECT COALESCE(SUM(m.cantidad), 0)::numeric AS neto FROM movimientos_inventario m
       JOIN detalles_pedido d ON d.id_detalle = m.id_detalle WHERE d.id_pedido = $1::int`,
    [viejo.id_pedido]
  );
  assert.strictEqual(Number(libro.rows[0].neto), 0, 'el stock del vencido volvió');
});

test('CARRERA: dos POST a la vez del mismo cliente -> un 201 y un 409 pedido_pendiente (con ese pedido); uno solo en por_pagar', async (t) => {
  if (saltar(t)) return;
  for (let vuelta = 0; vuelta < 3; vuelta += 1) {
    await sinPendientes(ana);
    const cuerpo = { canal: 'domicilio', id_direccion: ana.direccion, items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }] };
    const [a, b] = await Promise.all([v1(ana).crear(cuerpo), v1(ana).crear(cuerpo)]);
    assert.deepStrictEqual([a.status, b.status].sort(), [201, 409], `${a.status} ${b.status}`);
    const creado = a.status === 201 ? a : b;
    const rechazado = a.status === 201 ? b : a;
    assert.strictEqual(rechazado.body.motivo, 'pedido_pendiente');
    assert.strictEqual(rechazado.body.pedido.id_pedido, creado.body.pedido.id_pedido);
    const { rows } = await sonda.query("SELECT count(*)::int AS n FROM pedidos WHERE id_cliente = $1::int AND estado = 'por_pagar'", [ana.id]);
    assert.strictEqual(rows[0].n, 1);
  }
});

test('teléfono: a domicilio sin teléfono (ni en el cuerpo ni en el perfil) -> 422 telefono_requerido; con telefono_contacto se guarda ese', async (t) => {
  if (saltar(t)) return;
  await sinPendientes(caro);
  const items = [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }];
  const sin = await v1(caro).crear({ canal: 'domicilio', id_direccion: caro.direccion, items });
  assert.deepStrictEqual([sin.status, sin.body.motivo], [422, 'telefono_requerido']);
  const llevar = await v1(caro).crear({ canal: 'para_llevar', items });
  assert.strictEqual(llevar.status, 201, 'para llevar no lo exige');
  await sinPendientes(caro);
  const con = await v1(caro).crear({ canal: 'domicilio', id_direccion: caro.direccion, telefono_contacto: '+573109998877', items });
  assert.strictEqual(con.status, 201, JSON.stringify(con.body));
  const { rows } = await sonda.query('SELECT telefono_contacto FROM pedidos_domicilio WHERE id_pedido = $1::int', [con.body.pedido.id_pedido]);
  assert.strictEqual(rows[0].telefono_contacto, '+573109998877');
  await sinPendientes(caro);
  const mal = await v1(caro).crear({ canal: 'domicilio', id_direccion: caro.direccion, telefono_contacto: '12', items });
  assert.deepStrictEqual([mal.status, mal.body.motivo], [400, 'telefono_invalido']);
});

test('teléfono: el de la app manda sobre el del perfil', async (t) => {
  if (saltar(t)) return;
  await sinPendientes(ana);
  const res = await v1(ana).crear({
    canal: 'domicilio', id_direccion: ana.direccion, telefono_contacto: '3111111111',
    items: [{ id_plato: platoLibre.plato.id_plato, cantidad: 1 }],
  });
  assert.strictEqual(res.status, 201);
  const { rows } = await sonda.query('SELECT telefono_contacto FROM pedidos_domicilio WHERE id_pedido = $1::int', [res.body.pedido.id_pedido]);
  assert.strictEqual(rows[0].telefono_contacto, '3111111111');
});

test('GET /:id: el del cliente con la forma de /mios; el de otro cliente o uno que no existe -> 404', async (t) => {
  if (saltar(t)) return;
  const p = await pedidoDeAna();
  const uno = await request(app).get(`/api/v1/pedidos-domicilio/${p.id_pedido}`).set('Authorization', `Bearer ${ana.jwt}`);
  assert.strictEqual(uno.status, 200, JSON.stringify(uno.body));
  const mios = await v1(ana).mios();
  assert.deepStrictEqual(uno.body.pedido, mios.body.pedidos.find((x) => x.id_pedido === p.id_pedido), 'la misma forma que /mios');
  const ajeno = await request(app).get(`/api/v1/pedidos-domicilio/${p.id_pedido}`).set('Authorization', `Bearer ${beto.jwt}`);
  assert.deepStrictEqual([ajeno.status, ajeno.body.motivo], [404, 'no_encontrado']);
  const nada = await request(app).get('/api/v1/pedidos-domicilio/2147483647').set('Authorization', `Bearer ${ana.jwt}`);
  assert.strictEqual(nada.status, 404);
});
