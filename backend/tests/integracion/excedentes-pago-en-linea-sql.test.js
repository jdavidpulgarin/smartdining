const test = require('node:test');
const assert = require('node:assert');

/**
 * T4 (socket-server/EVENTS.md §8.4 y §8.7): el pago en línea de una mesa con
 * EXCEDENTE, contra PostgreSQL REAL, por la ruta real
 * (POST /api/transacciones/internal con x-internal-key).
 *
 * Un pago aprobado nunca se rechaza: se aplica lo que se debía y lo que sobra
 * queda en excedentes_pago_en_linea (script 44), en la misma transacción. La
 * Caja lo lista y lo marca devuelto.
 *
 * Casos: cada motivo (excede_saldo_mesa, excede_saldo_comensal, sin_cuenta,
 * otra_visita), la carrera de cancelar un plato entre la intención y el
 * webhook, dos webhooks del mismo pago (en serie y a la vez, también cuando todo
 * es excedente) y las rutas de la Caja.
 *
 * DATOS PROPIOS (patrón #218): catálogo de tests/helpers/plato-prueba.js (plato
 * a 12.000, sin receta: aquí se prueba el pago, no el inventario) y mesas de su
 * rango en tests/helpers/mesa-prueba.js, marcadas en `ubicacion`. Se limpia
 * después de cada caso y en el `after`.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';
// La ruta interna exige la clave; en la prueba se fija una propia.
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || `clave-de-prueba-excedentes-${Date.now()}`;

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');

const MARCA_MESA = 'PRUEBA excedentes-pago-en-linea-sql';
const conNumeroDeMesa = require('../helpers/mesa-prueba').numerosDeMesa('excedentes-pago-en-linea-sql');

let sonda = null;
let hayBase = false;
let catalogo = null;
let admin = null; // { id, jwt }

async function limpiar() {
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
  if (ids.length === 0) return;
  const e = await sonda.query('DELETE FROM excedentes_pago_en_linea WHERE id_mesa = ANY($1::int[]) RETURNING id', [ids]);
  if (e.rows.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'excedentes_pago_en_linea'
         AND COALESCE(datos_nuevos->>'id', datos_anteriores->>'id')::int = ANY($1::int[])`,
      [e.rows.map((r) => r.id)]
    );
  }
  const t = await sonda.query(
    `DELETE FROM transacciones
      WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_mesa = ANY($1::int[]))
      RETURNING id_transaccion`,
    [ids]
  );
  if (t.rows.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'transacciones'
         AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
      [t.rows.map((r) => r.id_transaccion)]
    );
  }
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [ids]);
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  admin = { id: u.rows[0].id_usuario, jwt: tokenStaff(u.rows[0].id_usuario, 'admin') };
  catalogo = await crearCatalogoPrueba(sonda, 'excedentes-pago-en-linea', { precio: 12000 });
  hayBase = true;
  await limpiar();
});

test.afterEach(async () => {
  if (hayBase) await limpiar();
});

test.after(async () => {
  try {
    if (hayBase) await limpiar();
    if (catalogo) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Una mesa ocupada cuya visita empezó hace una hora. */
async function mesaAbierta() {
  const m = await conNumeroDeMesa((numero) =>
    sonda.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
       VALUES ($1::int, 4, $2::text, 'ocupada', now() - interval '1 hour') RETURNING id_mesa`,
      [numero, MARCA_MESA]
    )
  );
  return m.rows[0].id_mesa;
}

/** Un pedido con una línea por comensal (cada una de 12.000), llevado a `estado`. */
async function pedido(idMesa, comensales, estado = 'recibido') {
  const p = await pedidosService.crearConDetalles({
    id_mesa: idMesa,
    id_usuario: admin.id,
    items: comensales.map((c) => ({ id_plato: catalogo.plato.id_plato, cantidad: 1, ...(c ? { comensal: c } : {}) })),
  });
  const camino = { recibido: [], entregado: ['en_preparacion', 'listo', 'entregado'] }[estado];
  for (const e of camino) await pedidosService.actualizarEstado(p.id_pedido, e, null, admin.id);
  const { rows } = await sonda.query(
    'SELECT id_detalle, comensal FROM detalles_pedido WHERE id_pedido = $1::int ORDER BY id_detalle',
    [p.id_pedido]
  );
  return { idPedido: p.id_pedido, lineas: rows };
}

/** El webhook, por la ruta real. */
function webhook(idMesa, { monto, modo = 'total', comensal = null, intencion = 'reciente', referencia } = {}) {
  const cuerpo = {
    referencia_externa: referencia || `PRUEBA-T4-${crypto.randomUUID()}`,
    id_transaccion_pasarela: `tx-${crypto.randomBytes(4).toString('hex')}`,
    pasarela: 'wompi',
    id_mesa: idMesa,
    comensal,
    modo,
    monto_centavos: monto,
    moneda: 'COP',
    metodo_pago: 'online',
  };
  if (intencion === 'reciente') cuerpo.intencion_creada_en = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  else if (intencion) cuerpo.intencion_creada_en = intencion;
  return request(app).post('/api/transacciones/internal').set('x-internal-key', process.env.INTERNAL_API_KEY).send(cuerpo);
}

async function registro(referencia) {
  const t = await sonda.query(
    `SELECT count(*)::int AS filas, COALESCE(SUM(ROUND(monto * 100)), 0)::bigint AS centavos
       FROM transacciones WHERE referencia_externa = $1::text OR referencia_externa LIKE $2::text`,
    [referencia, `${referencia}#%`]
  );
  const e = await sonda.query('SELECT * FROM excedentes_pago_en_linea WHERE referencia_externa = $1::text', [referencia]);
  return { filas: t.rows[0].filas, aplicado: Number(t.rows[0].centavos), excedentes: e.rows };
}

const saltar = (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Cada motivo
// ---------------------------------------------------------------------------

test('excede_saldo_mesa: la mesa debe 12.000 y se pagan 15.000 -> aplica 12.000, sobran 3.000, la mesa se libera', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  await pedido(idMesa, ['Ana'], 'entregado');
  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;

  const res = await webhook(idMesa, { monto: 1500000, referencia: ref });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.aplicado_centavos, 1200000);
  assert.strictEqual(res.body.excedente_centavos, 300000);
  assert.strictEqual(res.body.motivo_excedente, 'excede_saldo_mesa');
  assert.strictEqual(res.body.saldo_restante_centavos, 0);
  assert.strictEqual(res.body.mesa_liberada, true, 'como hoy: el pago cerró el último pedido');
  assert.ok(Number.isInteger(res.body.id_transaccion));

  const r = await registro(ref);
  assert.strictEqual(r.aplicado, 1200000);
  assert.strictEqual(r.excedentes.length, 1);
  const [e] = r.excedentes;
  assert.deepStrictEqual(
    [Number(e.monto_centavos), Number(e.aplicado_centavos), Number(e.excedente_centavos), e.motivo, e.estado, e.id_transaccion],
    [1500000, 1200000, 300000, 'excede_saldo_mesa', 'pendiente', res.body.id_transaccion]
  );
});

test('sin_cuenta: la mesa no debe nada -> todo es excedente, ninguna transacción', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
  const res = await webhook(idMesa, { monto: 1200000, referencia: ref });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.deepStrictEqual(
    [res.body.aplicado_centavos, res.body.excedente_centavos, res.body.motivo_excedente, res.body.id_transaccion],
    [0, 1200000, 'sin_cuenta', null]
  );
  const r = await registro(ref);
  assert.strictEqual(r.filas, 0);
  assert.strictEqual(r.excedentes[0].id_transaccion, null);
});

test('otra_visita: la intención es de antes de que se sentara este grupo -> no cubre nada del grupo nuevo', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta(); // la visita empezó hace 1 h
  const { idPedido } = await pedido(idMesa, ['Beto']);
  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
  const res = await webhook(idMesa, {
    monto: 1200000, referencia: ref, intencion: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.deepStrictEqual(
    [res.body.aplicado_centavos, res.body.excedente_centavos, res.body.motivo_excedente],
    [0, 1200000, 'otra_visita']
  );
  assert.strictEqual(res.body.saldo_restante_centavos, 1200000, 'el grupo nuevo sigue debiendo lo suyo');
  const { rows } = await sonda.query('SELECT obtener_saldo_pendiente($1::int)::numeric AS s', [idPedido]);
  assert.strictEqual(Number(rows[0].s), 12000);
});

test('excede_saldo_comensal y la CARRERA: el mesero cancela el plato de Ana entre la intención y el webhook', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  const { idPedido, lineas } = await pedido(idMesa, ['Ana', 'Beto']);
  const deAna = lineas.find((l) => l.comensal === 'Ana');
  // Ana crea su intención «lo mío» por 12.000 (hace 10 min)...
  // ...y antes de que llegue el webhook, el mesero le cancela el plato.
  const c = await pedidosService.cancelarItemPersonal(idPedido, deAna.id_detalle, { idUsuario: admin.id, motivo: 'carrera T4' });
  assert.ok(c.pedido, JSON.stringify(c));

  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
  const res = await webhook(idMesa, { monto: 1200000, modo: 'propio', comensal: 'ana', referencia: ref });
  assert.strictEqual(res.status, 201, 'el pago aprobado no se rechaza');
  assert.deepStrictEqual(
    [res.body.aplicado_centavos, res.body.excedente_centavos, res.body.motivo_excedente, res.body.id_transaccion],
    [0, 1200000, 'excede_saldo_comensal', null]
  );
  assert.strictEqual(res.body.saldo_restante_centavos, 1200000, 'lo de Beto no se cubre con la plata de Ana');
  assert.strictEqual((await registro(ref)).filas, 0);
});

test('excede_saldo_comensal: Ana debe 12.000 y paga 15.000 «lo mío» -> aplica sus 12.000 y nada de lo de Beto', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  await pedido(idMesa, ['Ana', 'Beto']);
  const res = await webhook(idMesa, { monto: 1500000, modo: 'propio', comensal: 'Ana' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.deepStrictEqual(
    [res.body.aplicado_centavos, res.body.excedente_centavos, res.body.motivo_excedente],
    [1200000, 300000, 'excede_saldo_comensal']
  );
  assert.strictEqual(res.body.saldo_restante_centavos, 1200000, 'queda lo de Beto');
});

// ---------------------------------------------------------------------------
// Duplicados: el mismo pago dos veces
// ---------------------------------------------------------------------------

test('duplicado en serie: el mismo webhook dos veces -> 200 con el MISMO resultado, sin registrar dos veces', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  await pedido(idMesa, ['Ana']);
  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
  const primero = await webhook(idMesa, { monto: 1500000, referencia: ref });
  const segundo = await webhook(idMesa, { monto: 1500000, referencia: ref });
  assert.strictEqual(primero.status, 201);
  assert.strictEqual(segundo.status, 200);
  assert.strictEqual(segundo.body.duplicado, true);
  for (const k of ['aplicado_centavos', 'excedente_centavos', 'motivo_excedente', 'id_transaccion']) {
    assert.deepStrictEqual(segundo.body[k], primero.body[k], k);
  }
  const r = await registro(ref);
  assert.deepStrictEqual([r.filas, r.excedentes.length], [1, 1]);
});

for (const [caso, conPedido] of [['con algo aplicado', true], ['todo excedente (sin cuenta)', false]]) {
  test(`duplicado A LA VEZ (${caso}): dos webhooks del mismo pago -> uno registra, el otro es duplicado con lo mismo`, async (t) => {
    if (saltar(t)) return;
    const idMesa = await mesaAbierta();
    if (conPedido) await pedido(idMesa, ['Ana']);
    const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
    const [a, b] = await Promise.all([
      webhook(idMesa, { monto: 1500000, referencia: ref }),
      webhook(idMesa, { monto: 1500000, referencia: ref }),
    ]);
    assert.deepStrictEqual([a.status, b.status].sort(), [200, 201], `${a.status} ${b.status}`);
    for (const k of ['aplicado_centavos', 'excedente_centavos', 'motivo_excedente', 'id_transaccion']) {
      assert.deepStrictEqual(a.body[k], b.body[k], k);
    }
    const r = await registro(ref);
    assert.deepStrictEqual([r.filas, r.excedentes.length], [conPedido ? 1 : 0, 1], 'nunca dos veces');
  });
}

// ---------------------------------------------------------------------------
// La Caja
// ---------------------------------------------------------------------------

test('Caja: lista el excedente pendiente, lo marca devuelto (quién y cuándo) y la segunda vez 409 ya_devuelto', async (t) => {
  if (saltar(t)) return;
  const idMesa = await mesaAbierta();
  const ref = `PRUEBA-T4-${crypto.randomUUID()}`;
  assert.strictEqual((await webhook(idMesa, { monto: 500000, referencia: ref })).status, 201);

  const lista = await request(app).get('/api/excedentes-pago-en-linea?estado=pendiente').set('Authorization', `Bearer ${admin.jwt}`);
  assert.strictEqual(lista.status, 200);
  const mio = lista.body.excedentes.find((x) => x.referencia_externa === ref);
  assert.ok(mio, 'aparece en los pendientes');
  assert.strictEqual(mio.excedente_centavos, 500000);

  const marcar = () => request(app).patch(`/api/excedentes-pago-en-linea/${mio.id}/devuelto`).set('Authorization', `Bearer ${admin.jwt}`);
  const [r1, r2] = await Promise.all([marcar(), marcar()]);
  assert.deepStrictEqual([r1.status, r2.status].sort(), [200, 409], 'dos cajeros a la vez: uno lo marca');
  const ok = r1.status === 200 ? r1 : r2;
  const otro = r1.status === 200 ? r2 : r1;
  assert.strictEqual(ok.body.excedente.estado, 'devuelto');
  assert.strictEqual(ok.body.excedente.devuelto_por, admin.id);
  assert.ok(ok.body.excedente.devuelto_en);
  assert.strictEqual(otro.body.motivo, 'ya_devuelto');

  const pendientes = await request(app).get('/api/excedentes-pago-en-linea').set('Authorization', `Bearer ${admin.jwt}`);
  assert.ok(!pendientes.body.excedentes.some((x) => x.referencia_externa === ref), 'ya no está pendiente');
});
