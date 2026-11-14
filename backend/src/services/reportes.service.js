const pool = require('../config/db');
const cache = require('./cache');

/**
 * Reportes del panel (D-07). Alimenta GET /api/reportes?rango=hoy|semana|mes.
 *
 * TODO SALE EN NÚMEROS, no en texto formateado: el panel ya tiene su formateador
 * (formatoCOP) y es quien sabe en qué moneda y con qué separadores pinta. Un
 * backend que devuelve '$8.940,00' obliga al cliente a parsear su propio texto
 * para cualquier cuenta.
 *
 * ZONA HORARIA EXPLÍCITA. El rango se calcula con
 * `(now() AT TIME ZONE 'America/Bogota')::date`, no con CURRENT_DATE: este
 * servidor tiene la zona de Bogotá por defecto, pero un contenedor que arranque
 * con TZ=UTC correría "hoy" cinco horas y el corte de caja saldría mal sin que
 * nadie se diera cuenta.
 *
 * NADA DEPENDE DE LA ZONA DE LA SESIÓN (T6). Todas las columnas de fecha son
 * TIMESTAMPTZ, así que `(columna AT TIME ZONE 'America/Bogota')::date` es el día
 * de Bogotá sea cual sea el `timezone` de la conexión. Las vistas
 * `v_ventas_diarias` y `v_tiempos_kds` ya agrupan así desde el script 42 (#241;
 * antes usaban DATE(columna), que sí dependía de la sesión). Las fechas salen
 * con to_char(..., 'YYYY-MM-DD'), no con ::text, que depende de DateStyle.
 * tests/integracion/reportes-dia-sql.test.js corre el reporte en sesión UTC y
 * en sesión Bogotá y exige el mismo resultado.
 */

/** Zona del restaurante. Una sola constante para no repetirla en cada query. */
const ZONA = 'America/Bogota';

/**
 * Días hacia atrás por rango, contando hoy. 'semana' son 7 días (hoy y los 6
 * anteriores) y 'mes' son 30. El valor NUNCA se interpola en el SQL: entra como
 * parámetro, y antes pasa por este mapa, así que un `rango` inventado no llega
 * a la base.
 */
const DIAS_POR_RANGO = { hoy: 0, semana: 6, mes: 29 };

/** Rangos aceptados. Lo usa el controller para su enum de zod. */
const RANGOS = Object.keys(DIAS_POR_RANGO);

const TTL_SEGUNDOS = 60;
const claveCache = (rango) => `cache:reportes:${rango}`;

/** Topes de las listas. El panel pinta 5 platos, 6 ingredientes y 7 días. */
const TOPE_PLATOS = 5;
const TOPE_INGREDIENTES = 6;
const TOPE_DIAS_KDS = 30;
const TOPE_HORAS = 24;

/**
 * Etiquetas de método de pago para el panel.
 *
 * La base tiene cinco (CHECK de transacciones) y el panel muestra menos:
 * `tarjeta_debito` y `tarjeta_credito` se juntan en "Tarjeta", porque al
 * dueño le interesa cuánto entró por datáfono y no de qué tipo era el plástico.
 * El resto se traduce al español tal cual.
 */
const ETIQUETA_METODO = `
  CASE t.metodo_pago
    WHEN 'tarjeta_debito'  THEN 'Tarjeta'
    WHEN 'tarjeta_credito' THEN 'Tarjeta'
    WHEN 'efectivo'        THEN 'Efectivo'
    WHEN 'transferencia'   THEN 'Transferencia'
    WHEN 'online'          THEN 'Online'
    ELSE initcap(t.metodo_pago)
  END`;

/**
 * Límites del rango, en fechas de Bogotá. Va al principio de cada consulta
 * como CTE para que el filtro y la agrupación usen lo mismo.
 */
const CTE_LIMITES = `
  WITH limites AS (
    SELECT (now() AT TIME ZONE $2::text)::date - $1::int AS desde,
           (now() AT TIME ZONE $2::text)::date            AS hasta
  )`;

/** Fecha local de un pedido/transacción, para comparar con los límites. */
const FECHA_LOCAL = (columna) => `(${columna} AT TIME ZONE $2::text)::date`;

/**
 * Totales de venta. Salen de v_ventas_diarias, que ya excluye cancelados y solo
 * suma transacciones 'completada'.
 *
 * `ticket_promedio` NO se promedia desde la vista: hacerlo sería un promedio de
 * promedios (cada día pesaría igual, tenga 2 pedidos o 80). Se recalcula sobre
 * el total del rango.
 */
const SQL_VENTAS = `
  ${CTE_LIMITES}
  SELECT
    COALESCE(SUM(v.total_recaudado), 0)::float8   AS total_ventas,
    COALESCE(SUM(v.total_pedidos), 0)::int        AS total_pedidos,
    COALESCE(SUM(v.pedidos_liquidados), 0)::int   AS pedidos_liquidados
  FROM limites l
  LEFT JOIN v_ventas_diarias v ON v.fecha BETWEEN l.desde AND l.hasta`;

/**
 * T6: ventas por día del rango, UN día por cada día de Bogotá entre `desde` y
 * `hasta` (los días sin ventas en 0), en orden. La MISMA fuente que SQL_VENTAS
 * (v_ventas_diarias): `total` es lo recaudado ese día por la fecha del pago
 * (como los métodos de pago y «Recaudado hoy») y `pedidos` los pedidos no
 * cancelados creados ese día. Así la suma de los días es totalVentas, que es la
 * suma de los métodos.
 *
 * Los días salen de desde + 0..$1 (enteros), no de generate_series sobre
 * fechas: ese convierte a timestamptz con la zona de la sesión.
 */
const SQL_VENTAS_POR_DIA = `
  ${CTE_LIMITES}
  , dias AS (
    SELECT l.desde + g.n AS fecha
    FROM limites l, generate_series(0, $1::int) AS g(n)
  )
  SELECT to_char(d.fecha, 'YYYY-MM-DD')               AS fecha,
         COALESCE(v.total_recaudado, 0)::float8       AS total,
         COALESCE(v.total_pedidos, 0)::int            AS pedidos
  FROM dias d
  LEFT JOIN v_ventas_diarias v ON v.fecha = d.fecha
  ORDER BY d.fecha`;

/**
 * Tiempo real promedio de cocina, PONDERADO por comandas.
 *
 * Un día con 2 comandas no puede pesar lo mismo que uno con 80: sin ponderar,
 * un día flojo y raro mueve el indicador del mes entero.
 */
const SQL_TIEMPO_COCINA = `
  ${CTE_LIMITES}
  SELECT
    CASE WHEN COALESCE(SUM(k.platos_preparados), 0) > 0
      THEN ROUND(
        SUM(k.tiempo_real_promedio_min * k.platos_preparados)
        / SUM(k.platos_preparados), 1)::float8
      ELSE NULL
    END AS tiempo_cocina_promedio
  FROM limites l
  LEFT JOIN v_tiempos_kds k ON k.fecha BETWEEN l.desde AND l.hasta`;

/** Detalle por día para la tabla de tiempos del panel. */
const SQL_TIEMPOS_KDS = `
  ${CTE_LIMITES}
  SELECT
    to_char(k.fecha, 'YYYY-MM-DD')          AS fecha,
    k.platos_preparados::int               AS platos_preparados,
    k.tiempo_estimado_promedio_min::float8  AS tiempo_estimado_promedio_min,
    k.tiempo_real_promedio_min::float8      AS tiempo_real_promedio_min,
    k.variacion_promedio_porcentaje::float8 AS variacion_promedio_porcentaje
  FROM v_tiempos_kds k, limites l
  WHERE k.fecha BETWEEN l.desde AND l.hasta
  ORDER BY k.fecha DESC
  LIMIT ${TOPE_DIAS_KDS}`;

/**
 * Platos más vendidos del RANGO. Consulta propia y no v_platos_top: esa vista
 * no tiene columna de fecha —agrupa todo el histórico— así que con ella los
 * tres rangos devolverían lo mismo y el selector del panel mentiría.
 *
 * `percentage` es relativo al primero (barra proporcional), no un porcentaje
 * del total: es lo que el panel pinta como ancho de barra.
 *
 * T6: sin las líneas canceladas (estado_item = 'cancelado', D-13 y J-14): un
 * plato que se quitó del pedido no se vendió. Mismo criterio que v_platos_top
 * desde el script 42.
 */
const SQL_TOP_PLATOS = `
  ${CTE_LIMITES}
  , vendidos AS (
    SELECT pl.id_plato,
           pl.nombre            AS nombre,
           c.nombre             AS categoria,
           SUM(dp.cantidad)::int     AS unidades,
           SUM(dp.subtotal)::float8  AS total
    FROM detalles_pedido dp
    JOIN pedidos p   ON p.id_pedido = dp.id_pedido
    JOIN platos pl   ON pl.id_plato = dp.id_plato
    JOIN categorias c ON c.id_categoria = pl.id_categoria
    CROSS JOIN limites l
    WHERE p.estado <> 'cancelado'
      AND dp.estado_item <> 'cancelado'
      AND ${FECHA_LOCAL('p.creado_en')} BETWEEN l.desde AND l.hasta
    GROUP BY pl.id_plato, pl.nombre, c.nombre
  )
  SELECT id_plato, nombre, categoria, unidades, total,
         ROUND(100.0 * unidades / MAX(unidades) OVER (), 0)::int AS porcentaje
  FROM vendidos
  ORDER BY unidades DESC, total DESC
  LIMIT ${TOPE_PLATOS}`;

/**
 * Ingredientes más solicitados del RANGO. Mismo motivo que arriba para no usar
 * v_ingredientes_top.
 *
 * Va por id_ingrediente: en la carta hay nombres repetidos a propósito (la
 * misma "Panceta Crujiente" existe en dos platos y son ingredientes distintos),
 * así que agrupar por nombre fusionaría cosas que no son la misma.
 *
 * T6: sin las líneas canceladas (estado_item = 'cancelado'), igual que
 * SQL_TOP_PLATOS y que v_ingredientes_top desde el script 42: lo elegido en un
 * plato que se quitó del pedido no se pidió.
 */
const SQL_TOP_INGREDIENTES = `
  ${CTE_LIMITES}
  SELECT
    i.id_ingrediente,
    i.nombre  AS nombre_ingrediente,
    pc.nombre AS nombre_paso,
    pl.nombre AS nombre_plato,
    COUNT(*)::int AS veces_solicitado,
    COUNT(*) FILTER (WHERE di.porcion = 'extra')::int  AS porciones_extra,
    COUNT(*) FILTER (WHERE di.porcion = 'normal')::int AS porciones_normal,
    COALESCE(SUM(di.precio_aplicado), 0)::float8       AS ingresos_extras
  FROM detalles_ingredientes di
  JOIN ingredientes i        ON i.id_ingrediente = di.id_ingrediente
  JOIN pasos_constructor pc  ON pc.id_paso = i.id_paso
  JOIN platos pl             ON pl.id_plato = pc.id_plato
  JOIN detalles_pedido dp    ON dp.id_detalle = di.id_detalle
  JOIN pedidos p             ON p.id_pedido = dp.id_pedido
  CROSS JOIN limites l
  WHERE p.estado <> 'cancelado'
    AND dp.estado_item <> 'cancelado'
    AND ${FECHA_LOCAL('p.creado_en')} BETWEEN l.desde AND l.hasta
  GROUP BY i.id_ingrediente, i.nombre, pc.nombre, pl.nombre
  ORDER BY veces_solicitado DESC, ingresos_extras DESC
  LIMIT ${TOPE_INGREDIENTES}`;

/**
 * Reparto por método de pago, con las etiquetas ya agrupadas.
 *
 * El porcentaje es sobre el total cobrado del rango, no sobre el número de
 * transacciones: lo que se compara en el panel son montos.
 */
const SQL_METODOS_PAGO = `
  ${CTE_LIMITES}
  , cobros AS (
    SELECT ${ETIQUETA_METODO} AS metodo,
           -- Se queda en NUMERIC a propósito: PostgreSQL solo tiene
           -- round(numeric, int), no round(double precision, int), así que
           -- castear a float8 aquí haría fallar el ROUND de abajo con un
           -- 42883. El cast a float8 va en el SELECT final, ya redondeado.
           SUM(t.monto) AS monto
    FROM transacciones t
    CROSS JOIN limites l
    WHERE t.estado_transaccion = 'completada'
      AND ${FECHA_LOCAL('t.creado_en')} BETWEEN l.desde AND l.hasta
    GROUP BY 1
  )
  SELECT metodo,
         monto::float8 AS monto,
         ROUND(100.0 * monto / SUM(monto) OVER (), 1)::float8 AS porcentaje
  FROM cobros
  ORDER BY monto DESC`;

/**
 * Pedidos por hora del día.
 *
 * `volumen` va NORMALIZADO de 0 a 100 contra la hora pico, porque el panel lo
 * usa como altura de barra (`height: ${volumen}%`): con el conteo crudo, una
 * hora de 3 pedidos se pintaría como una barra del 3 %. El conteo real va
 * aparte, en `pedidos`, para quien quiera el número.
 */
const SQL_HORAS_PICO = `
  ${CTE_LIMITES}
  , por_hora AS (
    SELECT EXTRACT(HOUR FROM (p.creado_en AT TIME ZONE $2::text))::int AS hora,
           COUNT(*)::int AS pedidos
    FROM pedidos p
    CROSS JOIN limites l
    WHERE p.estado <> 'cancelado'
      AND ${FECHA_LOCAL('p.creado_en')} BETWEEN l.desde AND l.hasta
    GROUP BY 1
  )
  SELECT
    lpad(hora::text, 2, '0') || ':00 - ' || lpad(((hora + 1) % 24)::text, 2, '0') || ':00' AS hora,
    pedidos,
    ROUND(100.0 * pedidos / MAX(pedidos) OVER (), 0)::int AS volumen
  FROM por_hora
  ORDER BY hora
  LIMIT ${TOPE_HORAS}`;

/**
 * Ocupación de mesas: cuántas mesas distintas se usaron en el rango.
 *
 * No es la foto de este segundo (eso no respetaría el rango) ni ocupación por
 * tiempo (haría falta un histórico de sesiones que la base no guarda: en
 * `mesas.sesion_iniciada_en` solo está la sesión actual).
 */
const SQL_OCUPACION = `
  ${CTE_LIMITES}
  SELECT
    CASE WHEN (SELECT COUNT(*) FROM mesas) > 0
      THEN ROUND(
        100.0 * (
          SELECT COUNT(DISTINCT p.id_mesa)
          FROM pedidos p, limites l2
          WHERE p.estado <> 'cancelado'
            AND ${FECHA_LOCAL('p.creado_en')} BETWEEN l2.desde AND l2.hasta
        ) / (SELECT COUNT(*) FROM mesas), 1)::float8
      ELSE 0::float8
    END AS ocupacion_mesas
  FROM limites l`;

/** Alertas de demora que registró el KDS en el rango. */
const SQL_ALERTAS = `
  ${CTE_LIMITES}
  SELECT COUNT(*)::int AS kds_alerts_count
  FROM kds_alertas a, limites l
  WHERE ${FECHA_LOCAL('a.fecha_alerta')} BETWEEN l.desde AND l.hasta`;

/** Number() defensivo: si algo llega como string de pg, no sale como string. */
const num = (valor, porDefecto = 0) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};

/** Igual, pero conservando null (un promedio sin datos no es 0). */
const numONull = (valor) => {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * Arma el reporte completo del rango leyendo de la base.
 *
 * Las consultas van en paralelo: son independientes y ninguna escribe, así
 * que encadenarlas solo sumaría latencias.
 *
 * `db` es el pool por omisión. Una prueba puede pasar UN cliente (en una
 * transacción): pg pone en fila las consultas de un mismo cliente, así que
 * Promise.all sigue funcionando, en serie.
 */
async function consultarBase(rango, db = pool) {
  const params = [DIAS_POR_RANGO[rango], ZONA];

  const [ventas, tiempo, tiempos, platos, ingredientes, metodos, horas, ocupacion, alertas, porDia] =
    await Promise.all([
      db.query(SQL_VENTAS, params),
      db.query(SQL_TIEMPO_COCINA, params),
      db.query(SQL_TIEMPOS_KDS, params),
      db.query(SQL_TOP_PLATOS, params),
      db.query(SQL_TOP_INGREDIENTES, params),
      db.query(SQL_METODOS_PAGO, params),
      db.query(SQL_HORAS_PICO, params),
      db.query(SQL_OCUPACION, params),
      db.query(SQL_ALERTAS, params),
      db.query(SQL_VENTAS_POR_DIA, params),
    ]);

  const v = ventas.rows[0] || {};
  const totalVentas = num(v.total_ventas);
  const pedidosLiquidados = num(v.pedidos_liquidados);

  return {
    rango,
    totalVentas,
    totalPedidos: num(v.total_pedidos),
    pedidosLiquidados,
    // Sobre los pedidos LIQUIDADOS, no sobre todos: un pedido abierto todavía
    // no es una venta. Y sin liquidados, 0 y no una división por cero.
    ticketPromedio:
      pedidosLiquidados > 0 ? Math.round((totalVentas / pedidosLiquidados) * 100) / 100 : 0,
    tiempoCocinaPromedio: numONull((tiempo.rows[0] || {}).tiempo_cocina_promedio),
    ocupacionMesas: num((ocupacion.rows[0] || {}).ocupacion_mesas),
    kdsAlertsCount: num((alertas.rows[0] || {}).kds_alerts_count),

    topPlatos: platos.rows.map((p) => ({
      id_plato: num(p.id_plato),
      nombre: p.nombre,
      categoria: p.categoria,
      unidades: num(p.unidades),
      total: num(p.total),
      porcentaje: num(p.porcentaje),
    })),

    metodosPago: metodos.rows.map((m) => ({
      metodo: m.metodo,
      monto: num(m.monto),
      porcentaje: num(m.porcentaje),
    })),

    horasPico: horas.rows.map((h) => ({
      hora: h.hora,
      volumen: num(h.volumen),
      pedidos: num(h.pedidos),
    })),

    topIngredientes: ingredientes.rows.map((i) => ({
      id_ingrediente: num(i.id_ingrediente),
      nombre_ingrediente: i.nombre_ingrediente,
      nombre_paso: i.nombre_paso,
      nombre_plato: i.nombre_plato,
      veces_solicitado: num(i.veces_solicitado),
      porciones_extra: num(i.porciones_extra),
      porciones_normal: num(i.porciones_normal),
      ingresos_extras: num(i.ingresos_extras),
    })),

    tiemposKds: tiempos.rows.map((t) => ({
      fecha: t.fecha,
      platos_preparados: num(t.platos_preparados),
      tiempo_estimado_promedio_min: num(t.tiempo_estimado_promedio_min),
      tiempo_real_promedio_min: num(t.tiempo_real_promedio_min),
      variacion_promedio_porcentaje: num(t.variacion_promedio_porcentaje),
    })),

    // T6: un día por cada día del rango (Bogotá), en orden; misma fuente que
    // totalVentas.
    ventasPorDia: (porDia ? porDia.rows : []).map((d) => ({
      fecha: d.fecha,
      total: num(d.total),
      pedidos: num(d.pedidos),
    })),
  };
}

/**
 * Reporte con cache-aside de 60 s, igual que el menú.
 *
 * Un reporte con un minuto de antigüedad es perfectamente útil para decidir, y
 * a cambio una pestaña que se deje recargando no castiga la base. Si Redis está
 * caído, el cache se salta en silencio (services/cache.js nunca lanza) y la
 * respuesta sale igual desde la base.
 */
async function obtenerReporte(rango) {
  const clave = claveCache(rango);

  const enCache = await cache.leerJson(clave);
  if (enCache) return { reporte: enCache, desdeCache: true };

  const reporte = await consultarBase(rango);
  await cache.guardarJson(clave, reporte, TTL_SEGUNDOS);
  return { reporte, desdeCache: false };
}

/* -------------------------------------------------------------------------- *
 * Consumo de inventario (plan v1.1, D-17 P3): GET /api/reportes/consumo
 * -------------------------------------------------------------------------- */

/** Rango máximo, contando los dos extremos: del 1 al 31 de un mes cabe. */
const DIAS_MAXIMOS_CONSUMO = 31;

/**
 * SIGNOS de movimientos_inventario (comprobados en 27_inventario.sql, no
 * supuestos):
 *   reserva     -X  con id_detalle   (fn_tr_reservar_inventario)
 *   devolucion  +X  con id_detalle   (fn_cerrar_reserva_detalle: EXACTAMENTE lo reservado)
 *   merma        0  con id_detalle   (fn_cerrar_reserva_detalle en una cancelación en
 *                                     cocina: la reserva NO vuelve)
 *   merma       -X  sin id_detalle   (registrar_movimiento_inventario: merma manual)
 *   entrada     +X                   (registrar_movimiento_inventario)
 *   ajuste      ±X                   (registrar_movimiento_inventario, con su signo)
 * Los índices únicos uq_movimiento_reserva y uq_movimiento_cierre garantizan UNA
 * reserva y UN cierre (devolución o merma) por (id_detalle, id_insumo).
 *
 * Cómo sale cada columna, en positivo y en la unidad del insumo:
 *   - consumo: lo reservado por las reservas del día cuya línea NO tiene cierre.
 *     Es "reservas menos devoluciones" sin días negativos: una devolución vuelve
 *     exactamente su reserva, así que esa reserva no se cuenta. Y tampoco las de
 *     líneas cerradas con MERMA (canceladas en cocina): eso no se vendió.
 *     Día: el de la reserva.
 *   - merma: las mermas manuales (-X) más lo reservado de las líneas canceladas
 *     en cocina (la merma de cierre va en 0; la cantidad se toma de su reserva,
 *     misma id_detalle e id_insumo). Día: el de la merma.
 *   - entradas: +X. ajustes: ±X (puede ser negativo).
 *
 * Los días son de Bogotá y los calcula la base, como GET /transacciones (#158):
 * desde_ts = 00:00 de `desde` y hasta_ts = 00:00 del día siguiente a `hasta`,
 * en `zona`, y el filtro es `creado_en >= desde_ts AND creado_en < hasta_ts`,
 * sin funciones sobre la columna (así sirven idx_movimientos_fecha e
 * idx_movimientos_insumo_fecha).
 *
 * Todo en UNA transacción de solo lectura (REPEATABLE READ, así las dos
 * consultas ven la misma foto): la validación contra "hoy" e id_insumo, y los
 * datos. Los totales salen de la base (SUM ... OVER), no de sumar en
 * JavaScript, para no arrastrar errores de coma flotante.
 *
 * @param {{desde: string, hasta: string, idInsumo?: number|null, zona?: string, ahora?: Date|string|null}} opciones
 *   `desde` y `hasta` AAAA-MM-DD ya validados (existen, hasta >= desde, rango
 *   <= DIAS_MAXIMOS_CONSUMO). `ahora` solo lo fijan las pruebas.
 * @returns {Promise<{invalido: 'futura', hoy: string} | {insumoNoExiste: true}
 *   | {desde: string, hasta: string, insumos: object[]}>}
 */
async function consumoInventario({ desde, hasta, idInsumo = null, zona = ZONA, ahora = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const v = await client.query(
      `SELECT to_char((COALESCE($2::timestamptz, now()) AT TIME ZONE $1::text)::date, 'YYYY-MM-DD') AS hoy,
              $3::text::date > (COALESCE($2::timestamptz, now()) AT TIME ZONE $1::text)::date AS futura,
              ($4::int IS NULL OR EXISTS (SELECT 1 FROM insumos WHERE id_insumo = $4::int)) AS insumo_existe`,
      [zona, ahora, hasta, idInsumo]
    );
    const validez = v.rows[0];
    if (validez.futura) {
      await client.query('ROLLBACK');
      return { invalido: 'futura', hoy: validez.hoy };
    }
    if (!validez.insumo_existe) {
      await client.query('ROLLBACK');
      return { insumoNoExiste: true };
    }

    const { rows } = await client.query(
      `WITH lim AS (
         SELECT $2::text::date::timestamp AT TIME ZONE $1::text       AS desde_ts,
                ($3::text::date + 1)::timestamp AT TIME ZONE $1::text AS hasta_ts
       ),
       mov AS (
         SELECT m.* FROM movimientos_inventario m, lim l
          WHERE m.creado_en >= l.desde_ts AND m.creado_en < l.hasta_ts
            AND ($4::int IS NULL OR m.id_insumo = $4::int)
       ),
       partes AS (
         -- consumo: reservas del rango sin cierre (ni devolución ni merma)
         SELECT r.id_insumo, (r.creado_en AT TIME ZONE $1::text)::date AS dia,
                -r.cantidad AS consumo, 0::numeric AS merma, 0::numeric AS entradas, 0::numeric AS ajustes
           FROM mov r
          WHERE r.tipo = 'reserva'
            AND NOT EXISTS (SELECT 1 FROM movimientos_inventario c
                             WHERE c.tipo IN ('devolucion', 'merma')
                               AND c.id_detalle = r.id_detalle AND c.id_insumo = r.id_insumo)
         UNION ALL
         -- merma de cocina: el cierre va en 0; lo perdido es lo que se reservó
         SELECT m.id_insumo, (m.creado_en AT TIME ZONE $1::text)::date, 0, -r.cantidad, 0, 0
           FROM mov m
           JOIN movimientos_inventario r
             ON r.tipo = 'reserva' AND r.id_detalle = m.id_detalle AND r.id_insumo = m.id_insumo
          WHERE m.tipo = 'merma' AND m.id_detalle IS NOT NULL
         UNION ALL
         -- merma manual (sin línea): cantidad negativa
         SELECT m.id_insumo, (m.creado_en AT TIME ZONE $1::text)::date, 0, -m.cantidad, 0, 0
           FROM mov m WHERE m.tipo = 'merma' AND m.id_detalle IS NULL
         UNION ALL
         SELECT m.id_insumo, (m.creado_en AT TIME ZONE $1::text)::date, 0, 0, m.cantidad, 0
           FROM mov m WHERE m.tipo = 'entrada'
         UNION ALL
         SELECT m.id_insumo, (m.creado_en AT TIME ZONE $1::text)::date, 0, 0, 0, m.cantidad
           FROM mov m WHERE m.tipo = 'ajuste'
       ),
       dias AS (
         SELECT id_insumo, dia, SUM(consumo) AS consumo, SUM(merma) AS merma,
                SUM(entradas) AS entradas, SUM(ajustes) AS ajustes
           FROM partes GROUP BY id_insumo, dia
       ),
       elegidos AS (
         SELECT id_insumo FROM dias
         UNION
         SELECT $4::int WHERE $4::int IS NOT NULL
       )
       SELECT i.id_insumo, i.nombre, i.unidad,
              to_char(d.dia, 'YYYY-MM-DD') AS fecha,
              d.consumo, d.merma, d.entradas, d.ajustes,
              COALESCE(SUM(d.consumo)  OVER w, 0) AS total_consumo,
              COALESCE(SUM(d.merma)    OVER w, 0) AS total_merma,
              COALESCE(SUM(d.entradas) OVER w, 0) AS total_entradas,
              COALESCE(SUM(d.ajustes)  OVER w, 0) AS total_ajustes
         FROM elegidos e
         JOIN insumos i ON i.id_insumo = e.id_insumo
         LEFT JOIN dias d ON d.id_insumo = i.id_insumo
       WINDOW w AS (PARTITION BY i.id_insumo)
        ORDER BY i.nombre, i.id_insumo, d.dia`,
      [zona, desde, hasta, idInsumo]
    );

    await client.query('COMMIT');
    return { desde, hasta, insumos: agruparConsumo(rows) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Filas (insumo x día, ya ordenadas) -> la forma de la respuesta. Sin sumar nada. */
function agruparConsumo(rows) {
  const insumos = [];
  let actual = null;
  for (const f of rows) {
    if (!actual || actual.id_insumo !== f.id_insumo) {
      actual = {
        id_insumo: f.id_insumo,
        nombre: f.nombre,
        unidad: f.unidad,
        total: {
          consumo: Number(f.total_consumo),
          merma: Number(f.total_merma),
          entradas: Number(f.total_entradas),
          ajustes: Number(f.total_ajustes),
        },
        dias: [],
      };
      insumos.push(actual);
    }
    if (f.fecha) {
      actual.dias.push({
        fecha: f.fecha,
        consumo: Number(f.consumo),
        merma: Number(f.merma),
        entradas: Number(f.entradas),
        ajustes: Number(f.ajustes),
      });
    }
  }
  return insumos;
}

module.exports = {
  consumoInventario,
  agruparConsumo,
  DIAS_MAXIMOS_CONSUMO,
  obtenerReporte,
  consultarBase,
  RANGOS,
  DIAS_POR_RANGO,
  ZONA,
  TTL_SEGUNDOS,
  claveCache,
  TOPE_PLATOS,
  TOPE_INGREDIENTES,
  TOPE_DIAS_KDS,
};
