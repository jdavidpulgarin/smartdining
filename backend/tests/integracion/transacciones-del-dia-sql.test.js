const test = require('node:test');
const assert = require('node:assert');

/**
 * GET /transacciones?desde=hoy|AAAA-MM-DD contra PostgreSQL real: el cierre de caja.
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
    // OJO con registro_id: para `transacciones` NO es el id_transaccion.
    // fn_tr_auditar_cambios (08_triggers.sql) busca 'id_' || TG_TABLE_NAME
    // ('id_transacciones', que no existe) y cae en su lista de respaldo, que
    // para esta tabla da el id_PEDIDO. Filtrar registro_id por ids de
    // transacción borraba filas ajenas o dejaba las propias. Se identifica la
    // fila por el id_transaccion que lleva dentro el JSON (datos_nuevos en el
    // INSERT, datos_anteriores en el DELETE).
    await sonda.query(
      `DELETE FROM auditoria_cambios
        WHERE tabla_afectada = 'transacciones'
          AND COALESCE(datos_nuevos->>'id_transaccion', datos_anteriores->>'id_transaccion')::int = ANY($1::int[])`,
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

  // 2b. Los que ya no se pueden cancelar (entregados o pagados, de la prueba de
  //     referencia_pago): cerrar su reserva con fn_cerrar_reserva_detalle(id,
  //     false), que DEVUELVE el stock y no hace nada si ya estaba cerrada.
  await sonda.query(
    `SELECT fn_cerrar_reserva_detalle(dp.id_detalle, false)
       FROM detalles_pedido dp JOIN pedidos p ON p.id_pedido = dp.id_pedido
      WHERE p.id_mesa = $1 ORDER BY dp.id_detalle`,
    [idMesa]
  );

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
    // Para el rango desde=<ayer>: el borde inferior exacto (00:00 de ayer, que
    // entra), las 23:30 de ANTEAYER (el día anterior a `desde`, que no entra)
    // y una de hace dos días al mediodía (tampoco). Suma de las completadas:
    // 3.400, que sigue cabiendo en el total del pedido.
    await insertar('ayer_0000', {
      monto: 900, estado: 'completada',
      creadoEn: `(${INICIO_HOY} - interval '1 day') AT TIME ZONE $3::text`,
    });
    await insertar('anteayer_2330', {
      monto: 800, estado: 'completada',
      creadoEn: `(${INICIO_HOY} - interval '1 day' - interval '30 minutes') AT TIME ZONE $3::text`,
    });
    await insertar('hace2_mediodia', {
      monto: 700, estado: 'completada',
      creadoEn: `(${INICIO_HOY} - interval '2 days' + interval '12 hours') AT TIME ZONE $3::text`,
    });
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

// ---------------------------------------------------------------------------
// desde=AAAA-MM-DD: desde las 00:00 de ESE día en Bogotá hasta el final de hoy
// ---------------------------------------------------------------------------

/** Un día de Bogotá relativo a hoy, como texto AAAA-MM-DD, calculado por la base. */
async function diaBogota(desplazamiento) {
  const { rows } = await sonda.query(
    `SELECT to_char((now() AT TIME ZONE $1::text)::date + $2::int, 'YYYY-MM-DD') AS d`,
    [ZONA, desplazamiento]
  );
  return rows[0].d;
}

test('caja: desde=<ayer> trae ayer y hoy, y deja fuera anteayer (incluidas sus 23:30)', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const ayer = await diaBogota(-1);
  const hoy = await diaBogota(0);
  const resumen = await transaccionesService.listarDelDia({ desde: ayer });

  assert.strictEqual(resumen.desde, ayer);
  assert.strictEqual(resumen.hasta, hoy, 'hasta es hoy en Bogota, el dia final incluido');

  const ids = new Set(resumen.transacciones.map((x) => x.id_transaccion));
  for (const entra of ['hoy_ahora', 'hoy_20h', 'ayer_2330', 'ayer_mediodia', 'ayer_0000']) {
    assert.ok(ids.has(creadas[entra]), `${entra} entra en el rango`);
  }
  for (const fuera of ['anteayer_2330', 'hace2_mediodia', 'hoy_fallida', 'hoy_reembolsada']) {
    assert.ok(!ids.has(creadas[fuera]), `${fuera} no entra`);
  }

  // total y cantidad cuadran con la lista de la misma consulta.
  assert.strictEqual(resumen.cantidad, resumen.transacciones.length);
  const suma = resumen.transacciones.reduce((acc, x) => acc + x.monto, 0);
  assert.strictEqual(Math.round(resumen.total * 100), Math.round(suma * 100));
  const nuestras = resumen.transacciones.filter((x) => x.id_pedido === pedido.id_pedido);
  assert.strictEqual(nuestras.reduce((acc, x) => acc + x.monto, 0), 1900, '100 + 200 + 300 + 400 + 900');
});

test('caja: desde=hoy y desde=<fecha de hoy> son lo mismo, con desde = hasta', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const hoy = await diaBogota(0);
  const a = await transaccionesService.listarDelDia({ desde: 'hoy' });
  const b = await transaccionesService.listarDelDia({ desde: hoy });

  assert.strictEqual(a.desde, hoy);
  assert.strictEqual(a.hasta, hoy);
  assert.strictEqual(b.desde, hoy);
  assert.strictEqual(b.hasta, hoy);
  const nuestrasA = a.transacciones.filter((x) => x.id_pedido === pedido.id_pedido).map((x) => x.id_transaccion).sort();
  const nuestrasB = b.transacciones.filter((x) => x.id_pedido === pedido.id_pedido).map((x) => x.id_transaccion).sort();
  assert.deepStrictEqual(nuestrasA, nuestrasB);
});

test('caja: con el reloj real, 30 dias atras entra y 31 no; mañana es futura', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const tope = await transaccionesService.listarDelDia({ desde: await diaBogota(-30) });
  assert.ok(!tope.invalido, 'hoy - 30 es el limite y entra (31 dias contando hoy)');

  const pasado = await transaccionesService.listarDelDia({ desde: await diaBogota(-31) });
  assert.strictEqual(pasado.invalido, 'antigua');
  assert.strictEqual(pasado.minimo, await diaBogota(-30), 'informa el limite');

  const manana = await transaccionesService.listarDelDia({ desde: await diaBogota(1) });
  assert.strictEqual(manana.invalido, 'futura');
});

test('caja: a las 20:00 de Bogota (ya mañana en UTC) "hoy" y el tope son los de Bogota', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  // 2026-03-10 20:00 en Bogotá = 2026-03-11 01:00 UTC. Bogotá no tiene horario
  // de verano, así que el desfase es siempre -05:00.
  const ahora = '2026-03-11T01:00:00Z';

  const hoyBogota = await transaccionesService.listarDelDia({ desde: '2026-03-10', ahora });
  assert.ok(!hoyBogota.invalido, 'el 10 es HOY en Bogota, aunque en UTC ya sea el 11');
  assert.strictEqual(hoyBogota.desde, '2026-03-10');
  assert.strictEqual(hoyBogota.hasta, '2026-03-10');

  const conHoy = await transaccionesService.listarDelDia({ desde: 'hoy', ahora });
  assert.strictEqual(conHoy.desde, '2026-03-10', 'desde=hoy tambien usa el dia de Bogota');

  const manana = await transaccionesService.listarDelDia({ desde: '2026-03-11', ahora });
  assert.strictEqual(manana.invalido, 'futura', 'el 11 es futuro en Bogota, aunque sea "hoy" en UTC');
  assert.strictEqual(manana.hoy, '2026-03-10');

  // El tope tambien se cuenta desde el hoy de Bogota: 10/03 - 30 = 08/02. Con
  // el dia de UTC (11/03) el limite seria 09/02 y el 08 se rechazaria.
  const tope = await transaccionesService.listarDelDia({ desde: '2026-02-08', ahora });
  assert.ok(!tope.invalido, '2026-02-08 es exactamente hoy - 30 en Bogota: entra');
  const fuera = await transaccionesService.listarDelDia({ desde: '2026-02-07', ahora });
  assert.strictEqual(fuera.invalido, 'antigua');
  assert.strictEqual(fuera.minimo, '2026-02-08');
});

// ---------------------------------------------------------------------------
// referencia_pago: las filas de un mismo pago repartido se agrupan
// ---------------------------------------------------------------------------

test('referencia_pago: un pago en linea repartido en 3 pedidos sale con la misma referencia; un cobro por pedido, null', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const crypto = require('node:crypto');
  const { rows: pl } = await sonda.query(
    `SELECT id_plato FROM platos
      WHERE disponible AND stock_suficiente AND NOT personalizable AND precio >= 5000
      ORDER BY id_plato LIMIT 1`
  );
  const { rows: us } = await sonda.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1');
  const idUsuario = us[0].id_usuario;

  // Dos pedidos más, entregados, y un cuarto en 'recibido' (el más nuevo).
  const nuevos = [];
  for (let i = 0; i < 3; i++) {
    const p = await pedidosService.crearConDetalles({
      id_mesa: mesa.id_mesa, id_usuario: idUsuario, items: [{ id_plato: pl[0].id_plato, cantidad: 1 }],
    });
    if (i < 2) {
      for (const e of ['en_preparacion', 'listo', 'entregado']) {
        await pedidosService.actualizarEstado(p.id_pedido, e, null, idUsuario);
      }
    }
    nuevos.push(p.id_pedido);
  }

  // Cobro POR PEDIDO, sin referencia, sobre el cuarto: abono de 100.
  const porPedido = await transaccionesService.registrarPago({
    id_pedido: nuevos[2], metodo_pago: 'efectivo', monto: 100, id_usuario: idUsuario,
  });
  const idPorPedido = porPedido.transaccion.id_transaccion;

  // Pago EN LÍNEA por el saldo exacto de los 3 pedidos más viejos de la mesa
  // (el principal de la suite y los dos nuevos entregados): 3 filas, 'ref',
  // 'ref#2', 'ref#3'. La referencia lleva un '#' en medio a propósito.
  const ref = `PRUEBA-9#A-${crypto.randomUUID()}`;
  const ids = [pedido.id_pedido, nuevos[0], nuevos[1]];
  const { rows: s } = await sonda.query(
    `SELECT SUM(ROUND(obtener_saldo_pendiente(id_pedido) * 100))::bigint AS c
       FROM pedidos WHERE id_pedido = ANY($1::int[])`,
    [ids]
  );
  const interno = await transaccionesService.registrarPagoInterno({
    referencia_externa: ref, id_mesa: mesa.id_mesa, comensal: null,
    monto_centavos: Number(s[0].c), metodo_pago: 'online',
  });
  assert.strictEqual(interno.duplicado, false);

  const { rows: guardadas } = await sonda.query(
    `SELECT id_pedido, referencia_externa FROM transacciones
      WHERE referencia_externa LIKE $1::text ORDER BY referencia_externa`,
    [`${ref}%`]
  );
  assert.deepStrictEqual(
    guardadas.map((g) => g.referencia_externa),
    [ref, `${ref}#2`, `${ref}#3`],
    'en la base: la referencia y sus sufijos'
  );

  const resumen = await transaccionesService.listarDelDia({ desde: 'hoy' });
  const delPago = resumen.transacciones.filter((x) => guardadas.some((g) => g.id_pedido === x.id_pedido && x.metodo_pago === 'online'));
  assert.strictEqual(delPago.length, 3, 'las 3 filas del pago repartido');
  assert.deepStrictEqual(delPago.map((x) => x.referencia_pago), [ref, ref, ref], 'la misma referencia, sin #n, con su # de en medio');
  assert.deepStrictEqual(delPago.map((x) => x.id_pedido).sort((a, b) => a - b), [...ids].sort((a, b) => a - b));

  const caja = resumen.transacciones.find((x) => x.id_transaccion === idPorPedido);
  assert.ok(caja, 'el cobro por pedido sale');
  assert.strictEqual(caja.referencia_pago, null);

  for (const x of resumen.transacciones) {
    assert.ok(!('referencia_externa' in x), 'la referencia en crudo no sale');
  }

  // Agrupar por referencia_pago da UN pago de 3 filas.
  const grupos = new Map();
  for (const x of delPago) grupos.set(x.referencia_pago, (grupos.get(x.referencia_pago) || 0) + x.monto);
  assert.strictEqual(grupos.size, 1);
  assert.strictEqual(Math.round(grupos.get(ref) * 100), Number(s[0].c));
});

test('referencia_pago: un cobro de mesa en caja repartido sale con "caja:<id_cobro>" en todas sus filas', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const crypto = require('node:crypto');
  const { rows: pl } = await sonda.query(
    `SELECT id_plato FROM platos
      WHERE disponible AND stock_suficiente AND NOT personalizable AND precio >= 5000
      ORDER BY id_plato LIMIT 1`
  );
  const { rows: us } = await sonda.query('SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1');
  const idUsuario = us[0].id_usuario;

  // Dos pedidos entregados más en la mesa propia, para que el cobro se reparta
  // seguro entre varios (también entre los que hayan quedado con saldo de las
  // pruebas anteriores de esta suite).
  for (let i = 0; i < 2; i++) {
    const p = await pedidosService.crearConDetalles({
      id_mesa: mesa.id_mesa, id_usuario: idUsuario, items: [{ id_plato: pl[0].id_plato, cantidad: 1 }],
    });
    for (const e of ['en_preparacion', 'listo', 'entregado']) {
      await pedidosService.actualizarEstado(p.id_pedido, e, null, idUsuario);
    }
  }

  // La caja cobra TODO el saldo de la mesa: una fila por pedido con saldo.
  const { rows: s } = await sonda.query(
    `SELECT count(*)::int AS con_saldo,
            COALESCE(SUM(ROUND(obtener_saldo_pendiente(id_pedido) * 100)), 0)::bigint AS centavos
       FROM pedidos
      WHERE id_mesa = $1::int AND estado <> 'cancelado'
        AND obtener_saldo_pendiente(id_pedido) > 0`,
    [mesa.id_mesa]
  );
  const conSaldo = s[0].con_saldo;
  const montoCentavos = Number(s[0].centavos);
  assert.ok(conSaldo >= 2, `el cobro se reparte entre varios pedidos (${conSaldo})`);

  const idCobro = crypto.randomUUID();
  const cobro = await transaccionesService.cobrarMesaEnCaja({
    id_mesa: mesa.id_mesa, monto_centavos: montoCentavos, metodo_pago: 'efectivo',
    id_cobro: idCobro, id_usuario: idUsuario,
  });
  assert.strictEqual(cobro.duplicado, false);
  assert.strictEqual(cobro.transacciones.length, conSaldo, 'una fila por pedido con saldo');

  const resumen = await transaccionesService.listarDelDia({ desde: 'hoy' });
  const idsDelCobro = new Set(cobro.transacciones.map((x) => x.id_transaccion));
  const filas = resumen.transacciones.filter((x) => idsDelCobro.has(x.id_transaccion));

  assert.strictEqual(filas.length, conSaldo, 'todas las filas del cobro salen en GET /transacciones');
  assert.deepStrictEqual(
    [...new Set(filas.map((x) => x.referencia_pago))],
    [`caja:${idCobro}`],
    'todas con el mismo referencia_pago, sin el sufijo #n'
  );
  assert.ok(filas.every((x) => !('referencia_externa' in x)), 'la referencia en crudo no sale');

  // El total cuadra: las filas del cobro suman el monto cobrado, y el total de
  // la respuesta es la suma de todo lo listado.
  const sumaCobro = filas.reduce((acc, x) => acc + Math.round(x.monto * 100), 0);
  assert.strictEqual(sumaCobro, montoCentavos);
  const sumaTodo = resumen.transacciones.reduce((acc, x) => acc + Math.round(x.monto * 100), 0);
  assert.strictEqual(Math.round(resumen.total * 100), sumaTodo);
  assert.strictEqual(resumen.cantidad, resumen.transacciones.length);
});
