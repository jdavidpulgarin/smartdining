const test = require('node:test');
const assert = require('node:assert');

/**
 * GET /transacciones?desde=hoy contra PostgreSQL real: el cierre de caja.
 *
 * Lo que un doble no puede comprobar: que "hoy" es el día calendario de
 * BOGOTÁ calculado por la base, que solo entran las completadas y que el total
 * cuadra con la lista. Y los dos bordes del día:
 *   - una venta a las 20:00 de Bogotá es la 01:00 UTC del día SIGUIENTE, y
 *     cuenta como de HOY;
 *   - una a las 23:30 de Bogotá de AYER (04:30 UTC de hoy) no cuenta.
 *
 * Las transacciones se insertan con `creado_en` fijado en SQL respecto al día
 * de Bogotá, así la prueba no depende de la hora a la que se corra.
 *
 * MESA PROPIA (el criterio de #146): número `MESA_NUMERO_CAJA` (902 por
 * omisión), con una marca en `ubicacion`. El `after` deja la base como estaba
 * aunque una prueba falle: borra las transacciones creadas (y lo que de ellas
 * anotó tr_auditar_transacciones), cancela el pedido por el servicio para que
 * el trigger devuelva el stock, borra el libro de sus detalles, el pedido y la
 * mesa. Una corrida interrumpida se limpia al empezar la siguiente.
 *
 * Otras suites pueden crear transacciones completadas HOY a la vez, así que no
 * se compara el total con un número fijo: se comprueba que salen EXACTAMENTE
 * las nuestras que deben salir, que no sale ninguna de las que no, y que
 * `total` y `cantidad` cuadran con la lista que devuelve la misma consulta.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const pool = require('../../src/config/db');
const pedidosService = require('../../src/services/pedidos.service');
const transaccionesService = require('../../src/services/transacciones.service');

const ZONA = 'America/Bogota';
const MESA_NUMERO = parseInt(process.env.MESA_NUMERO_CAJA || '902', 10);
const MARCA_MESA = 'PRUEBA transacciones-del-dia';

let sonda = null;
let hayBase = false;
let mesa = null;
let pedido = null;
/** id_transaccion por nombre de caso, para las aserciones y la limpieza. */
const creadas = {};

/** Borra lo que esta suite creó en su mesa. Idempotente. */
async function limpiar() {
  const m = await sonda.query('SELECT id_mesa, ubicacion FROM mesas WHERE numero = $1', [MESA_NUMERO]);
  if (m.rows.length === 0) return;
  if (m.rows[0].ubicacion !== MARCA_MESA) {
    throw new Error(`la mesa ${MESA_NUMERO} existe y no es de esta prueba: usa otro MESA_NUMERO_CAJA`);
  }
  const idMesa = m.rows[0].id_mesa;

  // 1. Las transacciones de los pedidos de esta mesa, y su rastro de auditoría
  //    (tr_auditar_transacciones anota el INSERT y también este DELETE).
  const t = await sonda.query(
    `DELETE FROM transacciones
      WHERE id_pedido IN (SELECT id_pedido FROM pedidos WHERE id_mesa = $1)
      RETURNING id_transaccion`,
    [idMesa]
  );
  const ids = t.rows.map((f) => f.id_transaccion);
  if (ids.length) {
    await sonda.query(
      `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'transacciones' AND registro_id = ANY($1::int[])`,
      [ids]
    );
  }

  // 2. Cancelar por el servicio lo que siga en 'recibido': el trigger devuelve
  //    el stock reservado.
  const abiertos = await sonda.query(
    `SELECT id_pedido FROM pedidos WHERE id_mesa = $1 AND estado = 'recibido' ORDER BY id_pedido`,
    [idMesa]
  );
  for (const { id_pedido } of abiertos.rows) {
    await pedidosService.actualizarEstado(id_pedido, 'cancelado', 'limpieza de la prueba de caja', null);
  }

  // 3. El libro de sus detalles (reserva + devolución, ya neteadas), el pedido
  //    (detalles e historial caen en cascada) y la mesa.
  await sonda.query(
    `DELETE FROM movimientos_inventario
      WHERE id_detalle IN (
        SELECT dp.id_detalle FROM detalles_pedido dp
        JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = $1)`,
    [idMesa]
  );
  await sonda.query('DELETE FROM pedidos WHERE id_mesa = $1', [idMesa]);
  await sonda.query('DELETE FROM mesas WHERE id_mesa = $1', [idMesa]);
}

/**
 * Inserta una transacción con `creado_en` = la expresión SQL dada (que puede
 * usar $3 como la zona). Devuelve su id.
 */
async function insertar(nombre, { monto, estado, creadoEn }) {
  // INSERT … SELECT con `$3::text IS NOT NULL`: así $3 se usa siempre y pg
  // conoce su tipo aunque la expresión de la fecha sea un simple now().
  const { rows } = await sonda.query(
    `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en)
     SELECT $1, 'efectivo', $2, $4, ${creadoEn}
      WHERE $3::text IS NOT NULL
     RETURNING id_transaccion`,
    [pedido.id_pedido, monto, ZONA, estado]
  );
  creadas[nombre] = rows[0].id_transaccion;
  return rows[0].id_transaccion;
}

/** Inicio del día de hoy en Bogotá, como expresión SQL (usa $3 = zona). */
const INICIO_HOY = `(date_trunc('day', now() AT TIME ZONE $3::text))`;

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    const p = await sonda.query(
      `SELECT id_plato FROM platos
        WHERE disponible AND stock_suficiente AND NOT personalizable AND precio >= 5000
        ORDER BY id_plato LIMIT 1`
    );
    hayBase = p.rows.length > 0;
    if (!hayBase) return;

    await limpiar();
    const m = await sonda.query(
      'INSERT INTO mesas (numero, capacidad, ubicacion) VALUES ($1, 4, $2) RETURNING id_mesa',
      [MESA_NUMERO, MARCA_MESA]
    );
    mesa = m.rows[0];
    pedido = await pedidosService.crearConDetalles({
      id_mesa: mesa.id_mesa,
      id_usuario: null,
      items: [{ id_plato: p.rows[0].id_plato, cantidad: 1 }],
    });

    // Montos chicos y distintos: la suma de las completadas (1.000) cabe en el
    // total de cualquier plato de >= 5.000, así tr_validar_transaccion_financiera
    // no las rechaza por pagar de más.
    await insertar('hoy_ahora', { monto: 100, estado: 'completada', creadoEn: 'now()' });
    await insertar('hoy_20h', {
      monto: 200, estado: 'completada',
      creadoEn: `(${INICIO_HOY} + interval '20 hours') AT TIME ZONE $3::text`,
    });
    await insertar('ayer_2330', {
      monto: 300, estado: 'completada',
      creadoEn: `(${INICIO_HOY} - interval '30 minutes') AT TIME ZONE $3::text`,
    });
    await insertar('ayer_mediodia', {
      monto: 400, estado: 'completada',
      creadoEn: `(${INICIO_HOY} - interval '12 hours') AT TIME ZONE $3::text`,
    });
    await insertar('hoy_fallida', { monto: 500, estado: 'fallida', creadoEn: 'now()' });
    await insertar('hoy_reembolsada', { monto: 600, estado: 'reembolsada', creadoEn: 'now()' });
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

test('caja: el borde de las 20:00 de Bogota es la 01:00 UTC del dia siguiente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // Comprobación del propio escenario: si esto no se cumple, las demás no
  // estarían probando el borde que dicen probar.
  const { rows } = await sonda.query(
    `SELECT to_char(t.creado_en AT TIME ZONE 'UTC', 'HH24:MI')   AS hora_utc,
            (t.creado_en AT TIME ZONE 'UTC')::date
              - (now() AT TIME ZONE $2::text)::date               AS dias_utc_despues,
            to_char(t.creado_en AT TIME ZONE $2::text, 'HH24:MI') AS hora_bogota
       FROM transacciones t WHERE t.id_transaccion = $1`,
    [creadas.hoy_20h, ZONA]
  );
  assert.strictEqual(rows[0].hora_bogota, '20:00');
  assert.strictEqual(rows[0].hora_utc, '01:00');
  assert.strictEqual(rows[0].dias_utc_despues, 1, 'en UTC ya es el dia siguiente');
});

test('caja: solo salen las completadas de HOY en Bogota, bordes incluidos', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const resumen = await transaccionesService.listarDelDia();
  const ids = new Set(resumen.transacciones.map((x) => x.id_transaccion));

  assert.ok(ids.has(creadas.hoy_ahora), 'la completada de ahora entra');
  assert.ok(ids.has(creadas.hoy_20h), 'la de las 20:00 de Bogota (01:00 UTC de mañana) cuenta como de HOY');
  assert.ok(!ids.has(creadas.ayer_2330), 'la de las 23:30 de Bogota de AYER no');
  assert.ok(!ids.has(creadas.ayer_mediodia), 'la de ayer al mediodia no');
  assert.ok(!ids.has(creadas.hoy_fallida), 'una fallida de hoy no');
  assert.ok(!ids.has(creadas.hoy_reembolsada), 'una reembolsada de hoy no');

  const { rows } = await sonda.query(`SELECT to_char(now() AT TIME ZONE $1::text, 'YYYY-MM-DD') AS hoy`, [ZONA]);
  assert.strictEqual(resumen.desde, rows[0].hoy, 'desde es el dia de Bogota');
});

test('caja: total y cantidad cuadran con la lista, y los numeros son numeros', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const resumen = await transaccionesService.listarDelDia();

  assert.strictEqual(typeof resumen.total, 'number');
  assert.strictEqual(resumen.cantidad, resumen.transacciones.length);
  const suma = resumen.transacciones.reduce((acc, x) => acc + x.monto, 0);
  assert.strictEqual(Math.round(resumen.total * 100), Math.round(suma * 100), 'total = suma de los montos listados');

  const nuestras = resumen.transacciones.filter((x) => x.id_pedido === pedido.id_pedido);
  assert.strictEqual(nuestras.length, 2);
  assert.strictEqual(nuestras.reduce((acc, x) => acc + x.monto, 0), 300, 'las dos de hoy: 100 + 200');

  for (const x of nuestras) {
    assert.strictEqual(typeof x.monto, 'number');
    assert.strictEqual(x.codigo_pedido, pedido.codigo_pedido);
    assert.strictEqual(x.id_mesa, mesa.id_mesa);
    assert.strictEqual(x.numero_mesa, MESA_NUMERO);
    assert.strictEqual(x.metodo_pago, 'efectivo');
    assert.strictEqual(x.comensal, null);
    assert.ok(!Number.isNaN(Date.parse(x.fecha)), 'fecha ISO');
    assert.ok(!('referencia_externa' in x));
  }
});

test('caja: mas reciente primero', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const resumen = await transaccionesService.listarDelDia();
  const fechas = resumen.transacciones.map((x) => Date.parse(x.fecha));
  for (let i = 1; i < fechas.length; i++) {
    assert.ok(fechas[i - 1] >= fechas[i], `orden descendente en la posicion ${i}`);
  }
  // Las nuestras: la de las 20:00 de hoy va antes que la de ahora salvo que
  // ya sean más de las 20:00 en Bogotá, así que se compara por fecha, no por id.
  const a = resumen.transacciones.find((x) => x.id_transaccion === creadas.hoy_20h);
  const b = resumen.transacciones.find((x) => x.id_transaccion === creadas.hoy_ahora);
  const iA = resumen.transacciones.indexOf(a);
  const iB = resumen.transacciones.indexOf(b);
  assert.strictEqual(iA < iB, Date.parse(a.fecha) > Date.parse(b.fecha));
});
