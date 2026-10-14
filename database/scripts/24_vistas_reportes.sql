-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 24_vistas_reportes.sql
-- MÓDULO: Vistas Analíticas para Reportes de Ventas, Ingredientes y Tiempos KDS
-- ACTIVIDAD: P-10 (Reportes con datos reales)
-- AUTOR: Jarrinson Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. VISTA: v_ventas_diarias
-- Consolida los ingresos, volumen de pedidos y ticket promedio por fecha.
-- Excluye pedidos cancelados y considera transacciones exitosas/completadas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT
    DATE(p.creado_en) AS fecha,
    COUNT(DISTINCT p.id_pedido) AS total_pedidos,
    COUNT(DISTINCT CASE WHEN p.estado = 'pagado' OR p.estado_pago = 'pagado' THEN p.id_pedido END) AS pedidos_liquidados,
    COALESCE(SUM(t.monto), 0.00) AS total_recaudado,
    CASE 
        WHEN COUNT(DISTINCT CASE WHEN p.estado = 'pagado' OR p.estado_pago = 'pagado' THEN p.id_pedido END) > 0 
        THEN ROUND(COALESCE(SUM(t.monto), 0.00) / COUNT(DISTINCT CASE WHEN p.estado = 'pagado' OR p.estado_pago = 'pagado' THEN p.id_pedido END), 2)
        ELSE 0.00
    END AS ticket_promedio,
    COALESCE(SUM(items.total_items), 0) AS total_items_vendidos
FROM pedidos p
LEFT JOIN (
    SELECT 
        id_pedido, 
        SUM(monto) AS monto
    FROM transacciones
    WHERE estado_transaccion = 'completada'
    GROUP BY id_pedido
) t ON p.id_pedido = t.id_pedido
LEFT JOIN (
    SELECT 
        dp.id_pedido, 
        SUM(dp.cantidad) AS total_items 
    FROM detalles_pedido dp
    GROUP BY dp.id_pedido
) items ON p.id_pedido = items.id_pedido
WHERE p.estado != 'cancelado'
GROUP BY DATE(p.creado_en)
ORDER BY fecha DESC;

-- ------------------------------------------------------------------------------
-- 2. VISTA: v_ingredientes_top
-- Ranking analítico de ingredientes más solicitados en platos armados del constructor.
-- Mide popularidad, porciones estándar vs extras e ingresos adicionales por recargos.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ingredientes_top AS
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
WHERE p.estado != 'cancelado'
GROUP BY i.id_ingrediente, i.nombre, pc.nombre, pl.id_plato, pl.nombre
ORDER BY veces_solicitado DESC, ingresos_extras_recaudados DESC;

-- ------------------------------------------------------------------------------
-- 3. VISTA: v_platos_top
-- Ranking de platos más demandados en sala y catálogo general.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_platos_top AS
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
WHERE p.estado != 'cancelado'
GROUP BY pl.id_plato, pl.nombre, cat.nombre, pl.precio, pl.personalizable
ORDER BY unidades_totales_vendidas DESC, ingresos_totales_generados DESC;

-- ------------------------------------------------------------------------------
-- 4. VISTA: v_tiempos_kds
-- Resumen operativo de eficiencia en cocina basado en kds_metricas.
-- Compara el tiempo estimado contractual vs el tiempo real de preparación.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tiempos_kds AS
SELECT
    DATE(km.fecha_metrica) AS fecha,
    COUNT(km.id_metrica) AS platos_preparados,
    ROUND(AVG(km.tiempo_preparacion_estimado), 1) AS tiempo_estimado_promedio_min,
    ROUND(AVG(km.tiempo_preparacion_real), 1) AS tiempo_real_promedio_min,
    ROUND(AVG(km.variacion_porcentaje), 2) AS variacion_promedio_porcentaje
FROM kds_metricas km
GROUP BY DATE(km.fecha_metrica)
ORDER BY fecha DESC;
