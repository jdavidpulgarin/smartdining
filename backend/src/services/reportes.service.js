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
 * CAVEAT de las vistas: `v_ventas_diarias` y `v_tiempos_kds` agrupan por
 * `DATE(columna)`, que usa la zona de la SESIÓN, no una explícita. Aquí se
 * filtran sus filas con fechas ya calculadas en Bogotá, así que el rango es
 * correcto; lo que no se puede garantizar desde el backend es el corte interno
 * de la vista. Arreglarlo es de `database/` (24_vistas_reportes.sql).
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
    SELECT (now() AT TIME ZONE $2)::date - $1::int AS desde,
           (now() AT TIME ZONE $2)::date            AS hasta
  )`;

/** Fecha local de un pedido/transacción, para comparar con los límites. */
const FECHA_LOCAL = (columna) => `(${columna} AT TIME ZONE $2)::date`;

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
    k.fecha::text                          AS fecha,
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
           SUM(t.monto)::float8 AS monto
    FROM transacciones t
    CROSS JOIN limites l
    WHERE t.estado_transaccion = 'completada'
      AND ${FECHA_LOCAL('t.creado_en')} BETWEEN l.desde AND l.hasta
    GROUP BY 1
  )
  SELECT metodo, monto,
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
    SELECT EXTRACT(HOUR FROM (p.creado_en AT TIME ZONE $2))::int AS hora,
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
 * Las ocho consultas van en paralelo: son independientes y ninguna escribe, así
 * que encadenarlas solo sumaría latencias.
 */
async function consultarBase(rango) {
  const params = [DIAS_POR_RANGO[rango], ZONA];

  const [ventas, tiempo, tiempos, platos, ingredientes, metodos, horas, ocupacion, alertas] =
    await Promise.all([
      pool.query(SQL_VENTAS, params),
      pool.query(SQL_TIEMPO_COCINA, params),
      pool.query(SQL_TIEMPOS_KDS, params),
      pool.query(SQL_TOP_PLATOS, params),
      pool.query(SQL_TOP_INGREDIENTES, params),
      pool.query(SQL_METODOS_PAGO, params),
      pool.query(SQL_HORAS_PICO, params),
      pool.query(SQL_OCUPACION, params),
      pool.query(SQL_ALERTAS, params),
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

module.exports = {
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
