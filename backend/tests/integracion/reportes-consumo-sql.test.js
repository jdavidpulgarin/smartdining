const test = require('node:test');
const assert = require('node:assert');

/**
 * GET /api/reportes/consumo (plan v1.1, D-17 P3) contra PostgreSQL REAL: los
 * signos de cada tipo de movimiento, la merma de cocina (cierre en 0 con
 * id_detalle) y el corte de días en Bogotá los decide la base.
 *
 * DATOS PROPIOS, para no chocar con las suites que corren en paralelo: dos
 * insumos ('PRUEBA consumo A' y 'B'), un plato con receta sobre ellos y una mesa
 * propia desde MESA_NUMERO_CONSUMO (1020 por omisión, rango de 20; no choca con
 * 901-1019 de las demás suites). Las aserciones miran SOLO esos insumos.
 *
 * FECHAS FIJAS: los movimientos se crean de verdad (los triggers de reserva,
 * devolución y merma, y registrar_movimiento_inventario) y después se les pone
 * un creado_en EXPLÍCITO con un UPDATE. Los días salen de "hoy en Bogotá" de la
 * propia base (D = hoy - 3), así que la prueba no depende de la fecha real ni de
 * la zona del servidor. No se usa el reloj inyectado de #158: aquí lo que se fija
 * es la hora de cada movimiento, no la de "ahora".
 *
 * LIMPIEZA TOTAL en el `after` (y al empezar, por si una corrida se cortó): los
 * movimientos de esos insumos, los pedidos de la mesa (detalles en cascada), la
 * mesa, la receta, el plato y su auditoría, y los insumos. La base queda igual.
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const request = require('supertest');
const app = require('../../server');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');

const MESA_NUMERO = parseInt(process.env.MESA_NUMERO_CONSUMO || '1020', 10);
const MARCA = 'PRUEBA consumo';
const ZONA = 'America/Bogota';

let sonda = null;
let hayBase = false;
let admin = null;
// Solo por su CATEGORÍA propia (tests/helpers/plato-prueba.js): el plato de
// esta suite no puede colgar de una categoría del seed. Los insumos A y B y su
// plato siguen siendo los de aquí: el reporte depende de sus movimientos.
let catalogo = null;
const ids = { A: null, B: null, plato: null, mesa: null };
let dia = null; // { D, Dm1, Dp1, desde, hasta } en AAAA-MM-DD

async function limpiar() {
  const ins = await sonda.query('SELECT id_insumo FROM insumos WHERE nombre LIKE $1::text', [`${MARCA} %`]);
  const idsInsumo = ins.rows.map((r) => r.id_insumo);
  const mesas = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA]);
  const idsMesa = mesas.rows.map((r) => r.id_mesa);
  const platos = await sonda.query('SELECT id_plato FROM platos WHERE nombre = $1::text', [`${MARCA} plato`]);
  const idsPlato = platos.rows.map((r) => r.id_plato);

  if (idsInsumo.length) {
    await sonda.query('DELETE FROM movimientos_inventario WHERE id_insumo = ANY($1::int[])', [idsInsumo]);
  }
  if (idsMesa.length) {
    await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [idsMesa]);
    await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [idsMesa]);
  }
  if (idsPlato.length) {
    await sonda.query('DELETE FROM recetas_plato WHERE id_plato = ANY($1::int[])', [idsPlato]);
    await sonda.query('DELETE FROM platos WHERE id_plato = ANY($1::int[])', [idsPlato]);
    await sonda.query(
      `DELETE FROM auditoria_cambios
        WHERE tabla_afectada = 'platos'
          AND COALESCE(datos_nuevos->>'id_plato', datos_anteriores->>'id_plato')::int = ANY($1::int[])`,
      [idsPlato]
    );
  }
  if (idsInsumo.length) {
    await sonda.query('DELETE FROM recetas_plato WHERE id_insumo = ANY($1::int[])', [idsInsumo]);
    await sonda.query('DELETE FROM insumos WHERE id_insumo = ANY($1::int[])', [idsInsumo]);
  }
}

/** Pone a un movimiento la fecha y hora de BOGOTÁ indicadas: (fecha + hora) en ZONA. */
async function fijarFecha(idMovimiento, fecha, hora) {
  await sonda.query(
    `UPDATE movimientos_inventario SET creado_en = ($2::date + $3::time) AT TIME ZONE $4::text
      WHERE id = $1::int`,
    [idMovimiento, fecha, hora, ZONA]
  );
}

/** Mueve a esa fecha y hora TODOS los movimientos de un detalle de cierto tipo. */
async function fijarFechaDetalle(idDetalle, tipo, fecha, hora) {
  const { rows } = await sonda.query(
    'SELECT id FROM movimientos_inventario WHERE id_detalle = $1::int AND tipo = $2::text', [idDetalle, tipo]
  );
  assert.ok(rows.length > 0, `hay movimientos ${tipo} del detalle ${idDetalle}`);
  for (const { id } of rows) await fijarFecha(id, fecha, hora);
}

async function movimientoManual(idInsumo, tipo, cantidad, fecha, hora) {
  const { rows } = await sonda.query(
    'SELECT (registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)).id AS id',
    [idInsumo, tipo, cantidad, `${MARCA} ${tipo}`]
  );
  await fijarFecha(rows[0].id, fecha, hora);
}

async function lineaDe(cantidad) {
  const pedido = await pedidosService.crearConDetalles({
    id_mesa: ids.mesa, id_usuario: null, items: [{ id_plato: ids.plato, cantidad }],
  });
  const { rows } = await sonda.query('SELECT id_detalle FROM detalles_pedido WHERE id_pedido = $1::int', [pedido.id_pedido]);
  return rows[0].id_detalle;
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  if (!u.rows[0]) return;
  admin = tokenStaff(u.rows[0].id_usuario, 'admin');
  // Primero los restos de una corrida cortada (su plato colgaba de la
  // categoría vieja) y después la categoría nueva.
  await limpiar();
  catalogo = await crearCatalogoPrueba(sonda, 'reportes-consumo');

  // Los días, de la base: D = hoy en Bogotá - 3.
  const d = await sonda.query(
    `WITH h AS (SELECT (now() AT TIME ZONE $1::text)::date - 3 AS d)
     SELECT to_char(d, 'YYYY-MM-DD') AS "D", to_char(d - 1, 'YYYY-MM-DD') AS "Dm1",
            to_char(d + 1, 'YYYY-MM-DD') AS "Dp1", to_char(d - 5, 'YYYY-MM-DD') AS desde,
            to_char(d + 1, 'YYYY-MM-DD') AS hasta, to_char(d - 20, 'YYYY-MM-DD') AS antes
       FROM h`,
    [ZONA]
  );
  dia = d.rows[0];

  // Insumos, plato con receta (A 100 g y B 1 unidad por plato) y mesa propios.
  const a = await sonda.query(`INSERT INTO insumos (nombre, unidad) VALUES ($1::text, 'g') RETURNING id_insumo`, [`${MARCA} A`]);
  const b = await sonda.query(`INSERT INTO insumos (nombre, unidad) VALUES ($1::text, 'unidad') RETURNING id_insumo`, [`${MARCA} B`]);
  ids.A = a.rows[0].id_insumo;
  ids.B = b.rows[0].id_insumo;
  // Stock inicial por entradas FUERA del rango (D - 20): no ensucian el reporte.
  await movimientoManual(ids.A, 'entrada', 10000, dia.antes, '09:00');
  await movimientoManual(ids.B, 'entrada', 100, dia.antes, '09:00');

  const p = await sonda.query(
    `INSERT INTO platos (id_categoria, nombre, precio, disponible) VALUES ($1::int, $2::text, 10000, TRUE) RETURNING id_plato`,
    [catalogo.idCategoria, `${MARCA} plato`]
  );
  ids.plato = p.rows[0].id_plato;
  await sonda.query(
    `INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES ($1::int, $2::int, 100), ($1::int, $3::int, 1)`,
    [ids.plato, ids.A, ids.B]
  );
  const m = await sonda.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado) VALUES ($1::int, 4, $2::text, 'ocupada') RETURNING id_mesa`,
    [MESA_NUMERO, MARCA]
  );
  ids.mesa = m.rows[0].id_mesa;

  // a. Vendido: 2 platos el día D -> reserva A -200, B -2.
  const vendida = await lineaDe(2);
  await fijarFechaDetalle(vendida, 'reserva', dia.D, '12:00');

  // b. Quitado antes de cocina: reserva y DEVOLUCIÓN el día D.
  const devuelta = await lineaDe(1);
  await sonda.query(`UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = $1::int`, [devuelta]);
  await fijarFechaDetalle(devuelta, 'reserva', dia.D, '12:00');
  await fijarFechaDetalle(devuelta, 'devolucion', dia.D, '12:30');

  // c. Cancelado EN COCINA: reserva el día D, merma (en 0) el día D + 1.
  const enCocina = await lineaDe(1);
  await sonda.query(`UPDATE detalles_pedido SET estado_item = 'cocinando' WHERE id_detalle = $1::int`, [enCocina]);
  await sonda.query(`UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = $1::int`, [enCocina]);
  await fijarFechaDetalle(enCocina, 'reserva', dia.D, '12:00');
  await fijarFechaDetalle(enCocina, 'merma', dia.Dp1, '10:00');

  // d. Merma manual, entrada y ajuste negativo de A, el día D.
  await movimientoManual(ids.A, 'merma', 30, dia.D, '15:00');
  await movimientoManual(ids.A, 'entrada', 500, dia.D, '16:00');
  await movimientoManual(ids.A, 'ajuste', -40, dia.D, '17:00');

  // e. Borde del día: entrada de B a las 20:00 de D (en UTC ya es D + 1) y otra
  // a las 23:30 del día anterior (D - 1).
  await movimientoManual(ids.B, 'entrada', 7, dia.D, '20:00');
  await movimientoManual(ids.B, 'entrada', 9, dia.Dm1, '23:30');

  hayBase = true;
});

test.after(async () => {
  try {
    if (sonda) await limpiar();
    // Después de limpiar(): su plato cuelga de esta categoría.
    if (catalogo) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

const consumo = (query) => request(app).get('/api/reportes/consumo').query(query).set('Authorization', `Bearer ${admin}`);

/** El reporte del rango completo, solo con los insumos de esta prueba. */
async function reporte(query = {}) {
  const res = await consumo({ desde: dia.desde, hasta: dia.hasta, ...query });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const propios = res.body.insumos.filter((i) => i.id_insumo === ids.A || i.id_insumo === ids.B);
  return { body: res.body, A: propios.find((i) => i.id_insumo === ids.A), B: propios.find((i) => i.id_insumo === ids.B) };
}

const delDia = (insumo, fecha) => insumo.dias.find((x) => x.fecha === fecha);

test('a. un pedido vendido: su reserva sale como CONSUMO del día de la reserva', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { A, B: insB } = await reporte();
  assert.strictEqual(A.unidad, 'g');
  assert.strictEqual(insB.unidad, 'unidad');
  assert.strictEqual(delDia(A, dia.D).consumo, 200, '2 platos x 100 g');
  assert.strictEqual(delDia(insB, dia.D).consumo, 2);
});

test('b. un plato quitado antes de cocina (devolución): NO cuenta como consumo', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { A } = await reporte();
  // Si contara, el día D tendría 300 (o 400 con la línea de cocina).
  assert.strictEqual(delDia(A, dia.D).consumo, 200);
  assert.strictEqual(A.total.consumo, 200);
});

test('c. un plato cancelado en cocina (merma en 0): sale como MERMA por lo reservado, el día de la cancelación, y NO como consumo', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { A, B: insB } = await reporte();
  assert.deepStrictEqual(delDia(A, dia.Dp1), { fecha: dia.Dp1, consumo: 0, merma: 100, entradas: 0, ajustes: 0 });
  assert.deepStrictEqual(delDia(insB, dia.Dp1), { fecha: dia.Dp1, consumo: 0, merma: 1, entradas: 0, ajustes: 0 });
});

test('d. merma manual, entrada y ajuste negativo, cada uno en su columna', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { A } = await reporte();
  assert.deepStrictEqual(delDia(A, dia.D), { fecha: dia.D, consumo: 200, merma: 30, entradas: 500, ajustes: -40 });
});

test('e. borde del día: las 20:00 de Bogotá caen en ESE día; las 23:30 del día anterior, no', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { B: insB } = await reporte();
  assert.strictEqual(delDia(insB, dia.D).entradas, 7, 'las 20:00 de D son D (en UTC ya sería D + 1)');
  assert.strictEqual(delDia(insB, dia.Dm1).entradas, 9, 'las 23:30 de D - 1 son D - 1');

  // Con el rango empezando en D, el movimiento de las 23:30 del día anterior no entra.
  const soloDesdeD = await reporte({ desde: dia.D });
  assert.strictEqual(delDia(soloDesdeD.B, dia.Dm1), undefined);
  assert.strictEqual(soloDesdeD.B.total.entradas, 7);
  // Y con el rango terminando en D - 1, la de las 20:00 de D tampoco.
  const hastaAyer = await consumo({ desde: dia.desde, hasta: dia.Dm1, id_insumo: String(ids.B) });
  assert.strictEqual(hastaAyer.status, 200);
  assert.deepStrictEqual(hastaAyer.body.insumos[0].dias.map((x) => [x.fecha, x.entradas]), [[dia.Dm1, 9]]);
});

test('f. filtro id_insumo: solo ese insumo', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const res = await consumo({ desde: dia.desde, hasta: dia.hasta, id_insumo: String(ids.B) });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.insumos.map((i) => i.id_insumo), [ids.B]);
  assert.deepStrictEqual(res.body.insumos[0].total, { consumo: 2, merma: 1, entradas: 16, ajustes: 0 });
  assert.deepStrictEqual(res.body.insumos[0].dias.map((x) => x.fecha), [dia.Dm1, dia.D, dia.Dp1], 'días ordenados');
});

test('g. los totales cuadran con la suma de los días (y los valores esperados)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const { body, A, B: insB } = await reporte();
  assert.deepStrictEqual(A.total, { consumo: 200, merma: 130, entradas: 500, ajustes: -40 });
  assert.deepStrictEqual(insB.total, { consumo: 2, merma: 1, entradas: 16, ajustes: 0 });
  for (const ins of body.insumos) {
    for (const col of ['consumo', 'merma', 'entradas', 'ajustes']) {
      const suma = ins.dias.reduce((s, x) => s + x[col], 0);
      assert.ok(Math.abs(suma - ins.total[col]) < 1e-9, `${ins.nombre} ${col}: ${suma} vs ${ins.total[col]}`);
    }
    const fechas = ins.dias.map((x) => x.fecha);
    assert.deepStrictEqual(fechas, [...fechas].sort(), `${ins.nombre}: días ordenados`);
  }
  const nombres = body.insumos.map((i) => i.nombre);
  assert.deepStrictEqual(nombres, [...nombres].sort((x, y) => x.localeCompare(y, 'es')), 'insumos por nombre');
});

test('h. id_insumo sin movimientos en el rango: sale con totales en 0 y dias vacío; uno que no existe, 404', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  // Un día sin nada para A: el primero del rango (D - 5).
  const vacio = await consumo({ desde: dia.desde, hasta: dia.desde, id_insumo: String(ids.A) });
  assert.strictEqual(vacio.status, 200);
  assert.deepStrictEqual(vacio.body.insumos, [
    { id_insumo: ids.A, nombre: `${MARCA} A`, unidad: 'g', total: { consumo: 0, merma: 0, entradas: 0, ajustes: 0 }, dias: [] },
  ]);
  const noExiste = await consumo({ desde: dia.desde, hasta: dia.hasta, id_insumo: '2147483000' });
  assert.strictEqual(noExiste.status, 404);
});
