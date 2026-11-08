const test = require('node:test');
const assert = require('node:assert');

/**
 * D-07: que las NUEVE consultas del reporte se ejecuten de verdad.
 *
 * Esta prueba existe por un fallo concreto. Las 49 pruebas de
 * tests/reportes.test.js usan fake-db, que devuelve filas sin mirar el SQL: por
 * construcción no pueden detectar que una consulta no compile. Y una no
 * compilaba — `ROUND(double precision, integer)` no existe en PostgreSQL, solo
 * `ROUND(numeric, integer)` — así que el endpoint daba 500 con la suite entera
 * en verde.
 *
 * Aquí no se comprueba QUÉ devuelven (eso depende de los datos de cada base),
 * sino que PostgreSQL las acepta y que los tipos del contrato se respetan. Es
 * lo que el doble nunca va a poder cubrir.
 *
 * Se SALTA sola si no hay base, igual que el resto de tests/integracion/:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const reportesService = require('../../src/services/reportes.service');

let sonda = null;
let hayBase = false;
let hayVistas = false;

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    hayBase = true;

    const { rows } = await sonda.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name IN ('v_ventas_diarias', 'v_tiempos_kds')`
    );
    hayVistas = rows[0].n === 2;
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  if (sonda) await sonda.end();
});

for (const rango of ['hoy', 'semana', 'mes']) {
  test(`rango=${rango}: las nueve consultas se ejecutan contra PostgreSQL`, async (t) => {
    if (!hayBase) return t.skip('sin base de datos');
    if (!hayVistas) {
      return t.skip('faltan las vistas de 24_vistas_reportes.sql: ejecuta ese script');
    }

    // Si alguna consulta no compila, consultarBase lanza y la prueba falla con
    // el SQLSTATE de PostgreSQL, que es justo lo que se quiere leer.
    const reporte = await reportesService.consultarBase(rango);

    assert.strictEqual(reporte.rango, rango);

    for (const campo of [
      'totalVentas', 'totalPedidos', 'pedidosLiquidados',
      'ticketPromedio', 'ocupacionMesas', 'kdsAlertsCount',
    ]) {
      assert.strictEqual(typeof reporte[campo], 'number', `${campo} debe ser number`);
      assert.ok(Number.isFinite(reporte[campo]), `${campo} no puede ser NaN ni Infinity`);
    }

    // null es válido (sin comandas en el rango); string no lo es nunca.
    assert.ok(
      reporte.tiempoCocinaPromedio === null || typeof reporte.tiempoCocinaPromedio === 'number',
      'tiempoCocinaPromedio: number o null'
    );

    for (const lista of ['topPlatos', 'metodosPago', 'horasPico', 'topIngredientes', 'tiemposKds']) {
      assert.ok(Array.isArray(reporte[lista]), `${lista} debe ser un arreglo`);
    }
  });
}

test('los topes de las listas se respetan contra la base real', async (t) => {
  if (!hayBase || !hayVistas) return t.skip('sin base o sin vistas');

  const reporte = await reportesService.consultarBase('mes');

  assert.ok(reporte.topPlatos.length <= reportesService.TOPE_PLATOS);
  assert.ok(reporte.topIngredientes.length <= reportesService.TOPE_INGREDIENTES);
  assert.ok(reporte.tiemposKds.length <= reportesService.TOPE_DIAS_KDS);
  assert.ok(reporte.horasPico.length <= 24, 'no hay más de 24 horas en un día');
});

test('los porcentajes que salen de la base están en su rango', async (t) => {
  if (!hayBase || !hayVistas) return t.skip('sin base o sin vistas');

  const reporte = await reportesService.consultarBase('mes');

  // volumen alimenta la altura de una barra en el panel.
  for (const h of reporte.horasPico) {
    assert.ok(h.volumen >= 0 && h.volumen <= 100, `volumen fuera de rango: ${h.volumen}`);
    assert.ok(Number.isInteger(h.pedidos) && h.pedidos > 0);
  }
  for (const p of reporte.topPlatos) {
    assert.ok(p.porcentaje >= 0 && p.porcentaje <= 100, `porcentaje: ${p.porcentaje}`);
  }
  // El reparto por método suma 100 (salvo redondeo) cuando hubo cobros.
  if (reporte.metodosPago.length > 0) {
    const suma = reporte.metodosPago.reduce((t2, m) => t2 + m.porcentaje, 0);
    assert.ok(Math.abs(suma - 100) <= 0.5, `los métodos suman ${suma}, no ~100`);
  }
});

test('las etiquetas de método de pago salen agrupadas y en español', async (t) => {
  if (!hayBase || !hayVistas) return t.skip('sin base o sin vistas');

  const reporte = await reportesService.consultarBase('mes');
  const permitidas = ['Tarjeta', 'Efectivo', 'Transferencia', 'Online'];

  for (const m of reporte.metodosPago) {
    assert.ok(permitidas.includes(m.metodo), `etiqueta inesperada: ${m.metodo}`);
  }
  // Y nunca el valor crudo de la columna.
  const etiquetas = reporte.metodosPago.map((m) => m.metodo);
  assert.ok(!etiquetas.includes('tarjeta_debito'));
  assert.ok(!etiquetas.includes('tarjeta_credito'));
});

test('el reporte no trae ningún dato de cliente', async (t) => {
  if (!hayBase || !hayVistas) return t.skip('sin base o sin vistas');

  const crudo = JSON.stringify(await reportesService.consultarBase('mes')).toLowerCase();
  for (const fuga of ['comensal', 'referencia_externa', 'id_transaccion', 'token']) {
    assert.ok(!crudo.includes(fuga), `no debe aparecer "${fuga}"`);
  }
});
