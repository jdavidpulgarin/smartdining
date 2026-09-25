-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 10_vistas.sql
-- MÓDULO: Vistas Analíticas y Operativas del Sistema
-- ==============================================================================

-- 1. VISTA: PEDIDOS CON BALANCE DE PAGOS Y SALDOS
-- Resuelve el balance financiero en tiempo real sin producto cartesiano.
CREATE OR REPLACE VIEW v_pedidos_con_pagos AS
SELECT 
    p.id_pedido,
    p.codigo_pedido,
    p.estado,
    p.total,
    COALESCE(pagos.total_pagado, 0.00) AS total_pagado,
    (p.total - COALESCE(pagos.total_pagado, 0.00)) AS saldo_pendiente,
    COALESCE(items.cantidad_items, 0) AS cantidad_items,
    p.creado_en AS fecha_pedido
FROM pedidos p
LEFT JOIN (
    SELECT id_pedido, SUM(monto) AS total_pagado
    FROM transacciones
    WHERE estado_transaccion = 'completada'
    GROUP BY id_pedido
) pagos ON p.id_pedido = pagos.id_pedido
LEFT JOIN (
    SELECT id_pedido, COUNT(id_detalle) AS cantidad_items
    FROM detalles_pedido
    GROUP BY id_pedido
) items ON p.id_pedido = items.id_pedido;

-- 2. VISTA: DETALLES COMPLETOS DE COMANDAS Y PLATOS
-- Consolida los detalles del pedido junto con la información comercial de catálogo.
CREATE OR REPLACE VIEW v_detalles_completos AS
SELECT 
    dp.id_detalle,
    dp.id_pedido,
    pl.id_plato,
    pl.nombre AS plato_nombre,
    cat.nombre AS categoria_nombre,
    dp.cantidad,
    dp.precio_unitario,
    (dp.cantidad * dp.precio_unitario) AS subtotal,
    dp.estado_item,
    dp.notas_especiales,
    pl.tiempo_preparacion_estimado,
    pl.disponible,
    dp.creado_en
FROM detalles_pedido dp
JOIN platos pl ON dp.id_plato = pl.id_plato
JOIN categorias cat ON pl.id_categoria = cat.id_categoria;

-- 3. VISTA: ESTADO DE SALA Y MESAS CON PEDIDOS ACTIVOS
-- Tablero para host y meseros con alertas de tiempo de espera y consumo acumulado.
CREATE OR REPLACE VIEW v_mesas_con_pedidos AS
SELECT 
    m.id_mesa,
    m.numero,
    m.estado,
    m.capacidad,
    m.ubicacion,
    m.token_qr,
    COUNT(CASE WHEN p.estado IN ('recibido', 'en_preparacion', 'listo') THEN 1 END) AS pedidos_activos,
    MIN(CASE WHEN p.estado IN ('recibido', 'en_preparacion', 'listo') THEN p.creado_en END) AS pedido_mas_antiguo,
    COALESCE(SUM(CASE WHEN p.estado IN ('recibido', 'en_preparacion', 'listo') THEN p.total ELSE 0 END), 0.00) AS monto_activo
FROM mesas m
LEFT JOIN pedidos p ON m.id_mesa = p.id_mesa
GROUP BY m.id_mesa, m.numero, m.estado, m.capacidad, m.ubicacion, m.token_qr;
