-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 42_reportes_hora_bogota.sql
-- MÓDULO: Vistas de reportes · T6 del plan de correcciones (prueba integral)
-- ==============================================================================
-- HALLAZGO (T6): «el reporte por día no registra lo vendido» y la suma por
-- métodos de pago no cuadra con «Recaudado hoy» de la Caja.
--
-- CAUSAS (script 24):
--   1. v_ventas_diarias y v_tiempos_kds agrupan con DATE(columna), que usa la
--      zona de la SESIÓN de PostgreSQL (UTC en Docker). Una venta de las 7 p. m.
--      en adelante (hora de Bogotá, UTC-5) caía en el día SIGUIENTE, y el
--      reporte de «hoy» (que filtra con la fecha de Bogotá) no la veía.
--   2. v_ventas_diarias.total_recaudado sumaba los pagos de los pedidos CREADOS
--      ese día, no los pagos HECHOS ese día. «Recaudado hoy» (GET
--      /transacciones?desde=hoy) y la gráfica de métodos cuentan por la fecha de
--      la transacción, así que las tres cifras no cuadraban (un pedido de ayer
--      pagado hoy, o un pedido cancelado después de un pago).
--   3. Las líneas canceladas (estado_item = 'cancelado', D-13 y J-14) contaban
--      en los ítems vendidos, en v_platos_top y en v_ingredientes_top (mismo
--      problema que la cuenta, script 41).
--
-- SOLUCIÓN: las mismas vistas, con las mismas columnas:
--   - Fechas en hora de Bogotá: (columna AT TIME ZONE 'America/Bogota')::date,
--     la misma zona que usa el backend (reportes.service.js y
--     transacciones.service.js: ZONA). Ya no dependen de la zona de la sesión.
--   - v_ventas_diarias.total_recaudado = transacciones 'completada' por la
--     FECHA DE LA TRANSACCIÓN (igual que «Recaudado hoy» y que los métodos de
--     pago). Los pedidos (total, liquidados, ítems) siguen por la fecha del
--     pedido y sin los cancelados. Un día con pagos y sin pedidos nuevos
--     también sale.
--   - Ítems, platos top e ingredientes top sin las líneas canceladas.
-- Se borran y se vuelven a crear (DROP + CREATE): nadie depende de ellas en la
-- base (las lee el backend). Sin datos que tocar; se puede correr dos veces.
-- ==============================================================================

DROP VIEW IF EXISTS v_ventas_diarias;
CREATE VIEW v_ventas_diarias AS
WITH pedidos_dia AS (
    SELECT (p.creado_en AT TIME ZONE 'America/Bogota')::date AS fecha,
           COUNT(*) AS total_pedidos,
           COUNT(*) FILTER (WHERE p.estado = 'pagado' OR p.estado_pago = 'pagado') AS pedidos_liquidados
    FROM pedidos p
    WHERE p.estado <> 'cancelado'
    GROUP BY 1
),
items_dia AS (
    SELECT (p.creado_en AT TIME ZONE 'America/Bogota')::date AS fecha,
           SUM(dp.cantidad) AS total_items
    FROM detalles_pedido dp
    JOIN pedidos p ON p.id_pedido = dp.id_pedido
    WHERE p.estado <> 'cancelado'
      AND dp.estado_item <> 'cancelado'
    GROUP BY 1
),
cobros_dia AS (
    SELECT (t.creado_en AT TIME ZONE 'America/Bogota')::date AS fecha,
           SUM(t.monto) AS total
    FROM transacciones t
    WHERE t.estado_transaccion = 'completada'
    GROUP BY 1
),
dias AS (
    SELECT fecha FROM pedidos_dia
    UNION
    SELECT fecha FROM cobros_dia
)
SELECT
    d.fecha,
    COALESCE(pd.total_pedidos, 0)::bigint AS total_pedidos,
    COALESCE(pd.pedidos_liquidados, 0)::bigint AS pedidos_liquidados,
    COALESCE(c.total, 0.00)::numeric AS total_recaudado,
    CASE
        WHEN COALESCE(pd.pedidos_liquidados, 0) > 0
        THEN ROUND(COALESCE(c.total, 0.00) / pd.pedidos_liquidados, 2)
        ELSE 0.00
    END AS ticket_promedio,
    COALESCE(i.total_items, 0)::numeric AS total_items_vendidos
FROM dias d
LEFT JOIN pedidos_dia pd ON pd.fecha = d.fecha
LEFT JOIN items_dia i ON i.fecha = d.fecha
LEFT JOIN cobros_dia c ON c.fecha = d.fecha
ORDER BY d.fecha DESC;

COMMENT ON VIEW v_ventas_diarias IS
    'Ventas por día de Bogotá: pedidos por su fecha (sin cancelados ni líneas canceladas); total_recaudado = transacciones completadas por la fecha del pago. Scripts 24 y 42.';

DROP VIEW IF EXISTS v_ingredientes_top;
CREATE VIEW v_ingredientes_top AS
SELECT
    i.id_ingrediente,
    i.nombre AS nombre_ingrediente,
    pc.nombre AS nombre_paso,
    pl.id_plato,
    pl.nombre AS nombre_plato,
    COUNT(di.id_detalle) AS veces_solicitado,
    COUNT(CASE WHEN di.porcion = 'extra' THEN 1 END) AS porciones_extra,
    COUNT(CASE WHEN di.porcion = 'normal' THEN 1 END) AS porciones_normal,
    COUNT(CASE WHEN di.porcion = 'ligera' THEN 1 END) AS porciones_ligera,
    COALESCE(SUM(di.precio_aplicado), 0.00) AS ingresos_extras_recaudados
FROM detalles_ingredientes di
JOIN ingredientes i ON di.id_ingrediente = i.id_ingrediente
JOIN pasos_constructor pc ON i.id_paso = pc.id_paso
JOIN platos pl ON pc.id_plato = pl.id_plato
JOIN detalles_pedido dp ON di.id_detalle = dp.id_detalle
JOIN pedidos p ON dp.id_pedido = p.id_pedido
WHERE p.estado <> 'cancelado'
  AND dp.estado_item <> 'cancelado'
GROUP BY i.id_ingrediente, i.nombre, pc.nombre, pl.id_plato, pl.nombre
ORDER BY veces_solicitado DESC, ingresos_extras_recaudados DESC;

DROP VIEW IF EXISTS v_platos_top;
CREATE VIEW v_platos_top AS
SELECT
    pl.id_plato,
    pl.nombre AS nombre_plato,
    cat.nombre AS categoria,
    pl.precio AS precio_base,
    pl.personalizable,
    COUNT(DISTINCT dp.id_pedido) AS veces_ordenado,
    SUM(dp.cantidad) AS unidades_totales_vendidas,
    SUM(dp.subtotal) AS ingresos_totales_generados
FROM detalles_pedido dp
JOIN platos pl ON dp.id_plato = pl.id_plato
JOIN categorias cat ON pl.id_categoria = cat.id_categoria
JOIN pedidos p ON dp.id_pedido = p.id_pedido
WHERE p.estado <> 'cancelado'
  AND dp.estado_item <> 'cancelado'
GROUP BY pl.id_plato, pl.nombre, cat.nombre, pl.precio, pl.personalizable
ORDER BY unidades_totales_vendidas DESC, ingresos_totales_generados DESC;

DROP VIEW IF EXISTS v_tiempos_kds;
CREATE VIEW v_tiempos_kds AS
SELECT
    (km.fecha_metrica AT TIME ZONE 'America/Bogota')::date AS fecha,
    COUNT(km.id_metrica) AS platos_preparados,
    ROUND(AVG(km.tiempo_preparacion_estimado), 1) AS tiempo_estimado_promedio_min,
    ROUND(AVG(km.tiempo_preparacion_real), 1) AS tiempo_real_promedio_min,
    ROUND(AVG(km.variacion_porcentaje), 2) AS variacion_promedio_porcentaje
FROM kds_metricas km
GROUP BY 1
ORDER BY fecha DESC;
