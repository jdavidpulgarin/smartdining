const test = require('node:test');
const assert = require('node:assert');

/**
 * T6: el reporte por día de Bogotá, contra PostgreSQL REAL, con los bordes de
 * medianoche, y el MISMO resultado en una sesión UTC y en una de Bogotá.
 *
 * CIFRAS EXACTAS CON SUITES EN PARALELO. Los totales del reporte son de toda
 * la base, y otras suites crean pedidos y pagos al mismo tiempo. Por eso todo
 * pasa en UNA transacción REPEATABLE READ con su propio cliente:
 *   1. una foto del reporte ANTES (fija el snapshot: lo que otras suites
 *      confirmen después no se ve);
 *   2. los datos de esta prueba (dentro de la misma transacción);
 *   3. el reporte DESPUÉS, en sesión UTC y en sesión Bogotá;
 *   4. ROLLBACK: no queda nada que limpiar.
 * La diferencia DESPUÉS - ANTES es exactamente lo de esta prueba.
 *
 * Los datos (días y horas de BOGOTÁ, relativos a hoy):
 *   P1  ayer 23:40  plato A x1 (4.000); pagado ayer 23:50 en efectivo
 *       -> en UTC ya es HOY 04:40: con DATE() en sesión UTC caía en hoy.
 *   P2  ayer 18:00  plato A x2 (8.000); pagado HOY 00:10 con tarjeta
 *       -> el pedido cuenta ayer, la plata cuenta hoy (fecha del pago).
 *   P3  hoy 20:30   A x20 + C x20 CANCELADA (80.000); pagado hoy 20:40 por
 *       transferencia -> en UTC es MAÑANA 01:40.
 *   P4  hoy 12:00   A x20 + A x20 + C x10 CANCELADA (160.000), sin pagar.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const crypto = require('node:crypto');
const { abrirSonda } = require('../helpers/base-prueba');
const reportesService = require('../../src/services/reportes.service');
const conNumeroDeMesa = require('../helpers/mesa-prueba').numerosDeMesa('reportes-dia-sql');

const ZONA = 'America/Bogota';
const MARCA = `prueba-reportes-dia-${crypto.randomBytes(4).toString('hex')}`;

let sonda = null;
let hayBase = false;

test.before(async () => {
  sonda = await abrirSonda();
  hayBase = sonda !== null;
});

test.after(async () => {
  if (sonda) await sonda.end();
});

const centavos = (n) => Math.round(n * 100);

/** El reporte de los dos rangos, con la zona de sesión dada, por ESTE cliente. */
async function reportes(cliente, zonaSesion) {
  await cliente.query('SELECT set_config($1::text, $2::text, true)', ['timezone', zonaSesion]);
  const { rows } = await cliente.query('SHOW timezone');
  assert.strictEqual(rows[0].TimeZone, zonaSesion, 'la sesión quedó en esa zona');
  return {
    hoy: await reportesService.consultarBase('hoy', cliente),
    semana: await reportesService.consultarBase('semana', cliente),
  };
}

/** Un instante de Bogotá: hoy + `dias`, a las `hora` (HH:MM). */
const instante = (dias, hora) =>
  `(((now() AT TIME ZONE '${ZONA}')::date + ${Number(dias)}) + '${hora}'::time) AT TIME ZONE '${ZONA}'`;

async function pedido(cliente, idMesa, dias, hora, lineas) {
  const p = await cliente.query(
    `INSERT INTO pedidos (id_mesa, codigo_pedido, creado_en)
     VALUES ($1::int, $2::text, ${instante(dias, hora)}) RETURNING id_pedido`,
    [idMesa, `T6-${crypto.randomBytes(5).toString('hex').toUpperCase()}`]
  );
  const idPedido = p.rows[0].id_pedido;
  for (const l of lineas) {
    const d = await cliente.query(
      `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
       VALUES ($1::int, $2::int, $3::int, $4::numeric) RETURNING id_detalle`,
      [idPedido, l.plato.id, l.cantidad, l.plato.precio]
    );
    if (l.cancelada) {
      await cliente.query(
        "UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = $1::int",
        [d.rows[0].id_detalle]
      );
    }
  }
  return idPedido;
}

async function pagar(cliente, idPedido, monto, metodo, dias, hora) {
  await cliente.query(
    `INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, creado_en)
     VALUES ($1::int, $2::text, $3::numeric, 'completada', ${instante(dias, hora)})`,
    [idPedido, metodo, monto]
  );
}

const montoDe = (reporte, metodo) => (reporte.metodosPago.find((m) => m.metodo === metodo) || { monto: 0 }).monto;
const diaDe = (reporte, fecha) => reporte.ventasPorDia.find((d) => d.fecha === fecha);

test('T6: bordes de medianoche, platos sin cancelados y ventas por día; igual en sesión UTC y en Bogotá', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const cliente = await sonda.connect();
  try {
    await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    const antesUtc = await reportes(cliente, 'UTC');
    const antesBog = await reportes(cliente, ZONA);
    assert.deepStrictEqual(antesUtc, antesBog, 'ANTES: el mismo reporte en las dos zonas de sesión');

    const { rows: [f] } = await cliente.query(
      `SELECT to_char((now() AT TIME ZONE $1::text)::date, 'YYYY-MM-DD')     AS hoy,
              to_char((now() AT TIME ZONE $1::text)::date - 1, 'YYYY-MM-DD') AS ayer`,
      [ZONA]
    );

    // --- Datos propios (todo se deshace con el ROLLBACK) ----------------------
    const c = await cliente.query(
      'INSERT INTO categorias (nombre, descripcion) VALUES ($1::text, $2::text) RETURNING id_categoria',
      [MARCA, 'T6']
    );
    const crearPlato = async (nombre, precio) => {
      const r = await cliente.query(
        `INSERT INTO platos (id_categoria, nombre, precio, disponible)
         VALUES ($1::int, $2::text, $3::numeric, TRUE) RETURNING id_plato`,
        [c.rows[0].id_categoria, `${MARCA} ${nombre}`, precio]
      );
      return { id: r.rows[0].id_plato, precio, nombre: `${MARCA} ${nombre}` };
    };
    const A = await crearPlato('A', 4000);
    const C = await crearPlato('C cancelado', 1000);
    const m = await conNumeroDeMesa(async (numero) => {
      // Dentro de la transacción: un 23505 no puede abortarla entera.
      await cliente.query('SAVEPOINT mesa');
      try {
        const r = await cliente.query(
          `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
           VALUES ($1::int, 4, $2::text, 'ocupada', now() - interval '2 days') RETURNING id_mesa`,
          [numero, MARCA]
        );
        await cliente.query('RELEASE SAVEPOINT mesa');
        return r;
      } catch (err) {
        await cliente.query('ROLLBACK TO SAVEPOINT mesa');
        throw err;
      }
    });
    const idMesa = m.rows[0].id_mesa;

    const p1 = await pedido(cliente, idMesa, -1, '23:40', [{ plato: A, cantidad: 1 }]);
    await pagar(cliente, p1, 4000, 'efectivo', -1, '23:50');
    const p2 = await pedido(cliente, idMesa, -1, '18:00', [{ plato: A, cantidad: 2 }]);
    await pagar(cliente, p2, 8000, 'tarjeta_debito', 0, '00:10');
    const p3 = await pedido(cliente, idMesa, 0, '20:30', [
      { plato: A, cantidad: 20 },
      { plato: C, cantidad: 20, cancelada: true },
    ]);
    await pagar(cliente, p3, 80000, 'transferencia', 0, '20:40');
    await pedido(cliente, idMesa, 0, '12:00', [
      { plato: A, cantidad: 20 },
      { plato: A, cantidad: 20 },
      { plato: C, cantidad: 10, cancelada: true },
    ]);

    // --- Después, en las dos zonas de sesión ---------------------------------
    const utc = await reportes(cliente, 'UTC');
    const bog = await reportes(cliente, ZONA);
    assert.deepStrictEqual(utc, bog, 'DESPUÉS: el mismo reporte en sesión UTC y en sesión Bogotá');

    const { hoy, semana } = utc;
    const d = (campo, rango) => centavos(utc[rango][campo]) - centavos(antesUtc[rango][campo]);

    // Recaudado por la FECHA DEL PAGO en Bogotá: hoy = P2 (pagado 00:10) + P3
    // (pagado 20:40, que en UTC es mañana). P1 se pagó ayer 23:50.
    assert.strictEqual(d('totalVentas', 'hoy'), centavos(88000), 'hoy: 8.000 + 80.000');
    assert.strictEqual(d('totalVentas', 'semana'), centavos(92000), 'semana: + los 4.000 de ayer');
    // Pedidos por la FECHA DEL PEDIDO: hoy P3 y P4; ayer P1 (23:40) y P2.
    assert.strictEqual(hoy.totalPedidos - antesUtc.hoy.totalPedidos, 2);
    assert.strictEqual(semana.totalPedidos - antesUtc.semana.totalPedidos, 4);

    // Métodos de pago de hoy: tarjeta (P2) y transferencia (P3); el efectivo de P1 es de ayer.
    const dm = (metodo) => centavos(montoDe(hoy, metodo)) - centavos(montoDe(antesUtc.hoy, metodo));
    assert.strictEqual(dm('Tarjeta'), centavos(8000));
    assert.strictEqual(dm('Transferencia'), centavos(80000));
    assert.strictEqual(dm('Efectivo'), 0, 'el pago de ayer 23:50 no es de hoy');

    // ventasPorDia: un día por cada día del rango, ordenado y terminando hoy.
    assert.deepStrictEqual(hoy.ventasPorDia.map((x) => x.fecha), [f.hoy]);
    assert.strictEqual(semana.ventasPorDia.length, 7);
    const fechas = semana.ventasPorDia.map((x) => x.fecha);
    assert.deepStrictEqual(fechas, [...fechas].sort(), 'ordenado');
    assert.strictEqual(fechas[6], f.hoy);
    assert.strictEqual(fechas[5], f.ayer);
    for (let i = 1; i < 7; i += 1) {
      const dif = (Date.parse(`${fechas[i]}T00:00:00Z`) - Date.parse(`${fechas[i - 1]}T00:00:00Z`)) / 86400000;
      assert.strictEqual(dif, 1, `días seguidos: ${fechas[i - 1]} -> ${fechas[i]}`);
    }
    const dDia = (fecha, campo) => {
      const antes = diaDe(antesUtc.semana, fecha);
      return centavos(diaDe(semana, fecha)[campo]) - centavos(antes ? antes[campo] : 0);
    };
    assert.strictEqual(dDia(f.ayer, 'total'), centavos(4000), 'ayer: el pago de las 23:50');
    assert.strictEqual(dDia(f.ayer, 'pedidos'), centavos(2), 'ayer: P1 (23:40) y P2');
    assert.strictEqual(dDia(f.hoy, 'total'), centavos(88000));
    assert.strictEqual(dDia(f.hoy, 'pedidos'), centavos(2));

    // La suma de ventasPorDia = totalVentas = suma de métodos (en las dos fotos).
    for (const foto of [antesUtc, utc]) {
      for (const rango of ['hoy', 'semana']) {
        const r = foto[rango];
        const porDia = r.ventasPorDia.reduce((s, x) => s + centavos(x.total), 0);
        const porMetodo = r.metodosPago.reduce((s, x) => s + centavos(x.monto), 0);
        assert.strictEqual(porDia, centavos(r.totalVentas), `${rango}: suma de días = totalVentas`);
        assert.strictEqual(porMetodo, centavos(r.totalVentas), `${rango}: suma de métodos = totalVentas`);
      }
    }

    // Platos más pedidos de hoy: A con sus 60 unidades vivas (P3 y P4), y C
    // (solo líneas canceladas, 30 unidades) NO aparece.
    const deA = hoy.topPlatos.find((x) => x.id_plato === A.id);
    assert.ok(deA, `el plato A está en los más pedidos: ${JSON.stringify(hoy.topPlatos)}`);
    assert.strictEqual(deA.unidades, 60);
    assert.strictEqual(centavos(deA.total), centavos(240000));
    assert.strictEqual(hoy.topPlatos.find((x) => x.id_plato === C.id), undefined, 'una línea cancelada no es una venta');
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
});

test('T6: ventasPorDia del mes contra la base: 30 días con fecha AAAA-MM-DD, total y pedidos', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const reporte = await reportesService.consultarBase('mes', sonda);
  assert.strictEqual(reporte.ventasPorDia.length, reportesService.DIAS_POR_RANGO.mes + 1);
  for (const dia of reporte.ventasPorDia) {
    assert.deepStrictEqual(Object.keys(dia), ['fecha', 'total', 'pedidos']);
    assert.match(dia.fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(typeof dia.total, 'number');
    assert.ok(Number.isInteger(dia.pedidos) && dia.pedidos >= 0);
  }
  for (const k of reporte.tiemposKds) assert.match(k.fecha, /^\d{4}-\d{2}-\d{2}$/);
});

test('T6: ingredientes más solicitados sin las líneas canceladas: uno que solo está en líneas canceladas no aparece', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const cliente = await sonda.connect();
  try {
    // Misma técnica que arriba: todo en una transacción y ROLLBACK al final.
    await cliente.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    const c = await cliente.query(
      'INSERT INTO categorias (nombre, descripcion) VALUES ($1::text, $2::text) RETURNING id_categoria',
      [`${MARCA} ing`, 'T6']
    );
    const armable = await cliente.query(
      `INSERT INTO platos (id_categoria, nombre, precio, disponible, personalizable)
       VALUES ($1::int, $2::text, 5000, TRUE, TRUE) RETURNING id_plato`,
      [c.rows[0].id_categoria, `${MARCA} armable`]
    );
    const idPlato = armable.rows[0].id_plato;
    const paso = await cliente.query(
      `INSERT INTO pasos_constructor (id_plato, nombre, orden, min_sel, max_sel, obligatorio)
       VALUES ($1::int, 'base', 1, 1, 1, TRUE) RETURNING id_paso`,
      [idPlato]
    );
    const ingrediente = async (nombre) => (await cliente.query(
      `INSERT INTO ingredientes (id_paso, nombre, precio_extra) VALUES ($1::int, $2::text, 0)
       RETURNING id_ingrediente`,
      [paso.rows[0].id_paso, `${MARCA} ${nombre}`]
    )).rows[0].id_ingrediente;
    const vivo = await ingrediente('vivo');
    const soloCancelado = await ingrediente('solo cancelado');

    const m = await conNumeroDeMesa(async (numero) => {
      await cliente.query('SAVEPOINT mesa');
      try {
        const r = await cliente.query(
          `INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
           VALUES ($1::int, 4, $2::text, 'ocupada', now()) RETURNING id_mesa`,
          [numero, MARCA]
        );
        await cliente.query('RELEASE SAVEPOINT mesa');
        return r;
      } catch (err) {
        await cliente.query('ROLLBACK TO SAVEPOINT mesa');
        throw err;
      }
    });

    // Un pedido de hoy con 40 líneas de 1 (el tope es 50 ítems): 20 con el
    // ingrediente vivo y 20 con el otro, que después se cancelan. Con 20
    // pedidos, si se contaran las canceladas ese ingrediente entraría seguro
    // en el top 6.
    const p = await cliente.query(
      `INSERT INTO pedidos (id_mesa, codigo_pedido, creado_en)
       VALUES ($1::int, $2::text, ${instante(0, '12:00')}) RETURNING id_pedido`,
      [m.rows[0].id_mesa, `T6-${crypto.randomBytes(5).toString('hex').toUpperCase()}`]
    );
    for (const [idIngrediente, cancelar] of [[vivo, false], [soloCancelado, true]]) {
      for (let i = 0; i < 20; i += 1) {
        const d = await cliente.query(
          `INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario)
           VALUES ($1::int, $2::int, 1, 5000) RETURNING id_detalle`,
          [p.rows[0].id_pedido, idPlato]
        );
        await cliente.query(
          `INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion)
           VALUES ($1::int, $2::int, 'normal')`,
          [d.rows[0].id_detalle, idIngrediente]
        );
        if (cancelar) {
          await cliente.query(
            "UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = $1::int",
            [d.rows[0].id_detalle]
          );
        }
      }
    }

    const { hoy, semana } = await reportes(cliente, ZONA);
    const bogUtc = await reportes(cliente, 'UTC');
    assert.deepStrictEqual(bogUtc, { hoy, semana }, 'el mismo resultado en sesión UTC');

    for (const [rango, r] of [['hoy', hoy], ['semana', semana]]) {
      const delVivo = r.topIngredientes.find((x) => x.id_ingrediente === vivo);
      assert.ok(delVivo, `${rango}: el ingrediente vivo está: ${JSON.stringify(r.topIngredientes)}`);
      assert.strictEqual(delVivo.veces_solicitado, 20, `${rango}: solo sus 20 líneas vivas`);
      assert.strictEqual(
        r.topIngredientes.find((x) => x.id_ingrediente === soloCancelado),
        undefined,
        `${rango}: lo elegido en una línea cancelada no se pidió`
      );
    }
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
});
