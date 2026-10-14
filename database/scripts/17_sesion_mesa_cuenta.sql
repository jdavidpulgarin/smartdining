-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 17_sesion_mesa_cuenta.sql
-- MÓDULO: Delimitación de Cuenta por Sesión de Mesa (sesion_iniciada_en)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. AGREGAR COLUMNA sesion_iniciada_en A LA TABLA mesas
-- Delimita el inicio de la visita de los comensales actuales.
-- Nullable e idempotente: si es NULL, las funciones cuentan todos los pedidos no
-- cancelados (comportamiento retrocompatible).
-- ------------------------------------------------------------------------------
ALTER TABLE mesas
    ADD COLUMN IF NOT EXISTS sesion_iniciada_en TIMESTAMPTZ;

COMMENT ON COLUMN mesas.sesion_iniciada_en IS 'Timestamp de inicio de la visita o sesión activa en la mesa. Delimita qué pedidos pertenecen a la cuenta actual.';

-- Índices para optimizar consultas de cuenta de mesa activa
CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_sesion
    ON pedidos(id_mesa, creado_en)
    WHERE estado != 'cancelado';

CREATE INDEX IF NOT EXISTS idx_mesas_sesion_iniciada
    ON mesas(id_mesa, sesion_iniciada_en);

-- ------------------------------------------------------------------------------
-- 2. FUNCIÓN: obtener_cuenta_mesa(id_mesa)
-- Devuelve una tabla con el desglose por comensal (items, subtotal, pagado, saldo)
-- y una fila final con 'TOTAL MESA', restringido a pedidos con creado_en >= sesion_iniciada_en.
-- Si sesion_iniciada_en IS NULL, incluye todos los pedidos no cancelados.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION obtener_cuenta_mesa(id_mesa_param INTEGER)
RETURNS TABLE (
    comensal VARCHAR,
    items_pedidos BIGINT,
    subtotal DECIMAL(10,2),
    pagado DECIMAL(10,2),
    saldo DECIMAL(10,2)
) AS $$
DECLARE
    v_sesion_iniciada_en TIMESTAMPTZ;
    v_total_subtotal DECIMAL(10,2) := 0.00;
    v_total_pagado DECIMAL(10,2) := 0.00;
    v_total_saldo DECIMAL(10,2) := 0.00;
    v_total_items BIGINT := 0;
BEGIN
    -- Validar existencia de la mesa y obtener timestamp de inicio de sesión si está activo
    SELECT sesion_iniciada_en
    INTO v_sesion_iniciada_en
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    -- CTE temporal para agrupar consumos y pagos por comensal de la sesión activa
    RETURN QUERY
    WITH pedidos_activos AS (
        SELECT id_pedido
        FROM pedidos
        WHERE id_mesa = id_mesa_param
          AND estado != 'cancelado'
          AND (v_sesion_iniciada_en IS NULL OR creado_en >= v_sesion_iniciada_en)
    ),
    consumo_comensales AS (
        SELECT
            COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')::VARCHAR AS nombre_comensal,
            SUM(dp.cantidad)::BIGINT AS cant_items,
            SUM(dp.subtotal)::DECIMAL(10,2) AS consumo_total
        FROM detalles_pedido dp
        JOIN pedidos_activos pa ON dp.id_pedido = pa.id_pedido
        GROUP BY COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')
    ),
    pagos_comensales AS (
        SELECT
            COALESCE(NULLIF(btrim(t.comensal), ''), 'General')::VARCHAR AS nombre_comensal,
            SUM(t.monto)::DECIMAL(10,2) AS monto_pagado
        FROM transacciones t
        JOIN pedidos_activos pa ON t.id_pedido = pa.id_pedido
        WHERE t.estado_transaccion = 'completada'
        GROUP BY COALESCE(NULLIF(btrim(t.comensal), ''), 'General')
    ),
    cuenta_unificada AS (
        SELECT
            COALESCE(c.nombre_comensal, p.nombre_comensal) AS comensal_nombre,
            COALESCE(c.cant_items, 0::BIGINT) AS total_items,
            COALESCE(c.consumo_total, 0.00) AS subtotal_comensal,
            COALESCE(p.monto_pagado, 0.00) AS pagado_comensal,
            GREATEST(0.00, COALESCE(c.consumo_total, 0.00) - COALESCE(p.monto_pagado, 0.00)) AS saldo_comensal
        FROM consumo_comensales c
        FULL OUTER JOIN pagos_comensales p ON c.nombre_comensal = p.nombre_comensal
    )
    SELECT
        cu.comensal_nombre,
        cu.total_items,
        cu.subtotal_comensal,
        cu.pagado_comensal,
        cu.saldo_comensal
    FROM cuenta_unificada cu
    ORDER BY
        CASE WHEN cu.comensal_nombre = 'General' THEN 1 ELSE 0 END,
        cu.comensal_nombre ASC;

    -- Calcular acumulados de la mesa para la sesión activa
    SELECT
        COALESCE(SUM(cu.total_items), 0),
        COALESCE(SUM(cu.subtotal_comensal), 0.00),
        COALESCE(SUM(cu.pagado_comensal), 0.00),
        GREATEST(0.00, COALESCE(SUM(cu.subtotal_comensal), 0.00) - COALESCE(SUM(cu.pagado_comensal), 0.00))
    INTO
        v_total_items,
        v_total_subtotal,
        v_total_pagado,
        v_total_saldo
    FROM (
        WITH pedidos_activos AS (
            SELECT id_pedido
            FROM pedidos
            WHERE id_mesa = id_mesa_param
              AND estado != 'cancelado'
              AND (v_sesion_iniciada_en IS NULL OR creado_en >= v_sesion_iniciada_en)
        ),
        consumo_comensales AS (
            SELECT
                COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')::VARCHAR AS nombre_comensal,
                SUM(dp.cantidad)::BIGINT AS cant_items,
                SUM(dp.subtotal)::DECIMAL(10,2) AS consumo_total
            FROM detalles_pedido dp
            JOIN pedidos_activos pa ON dp.id_pedido = pa.id_pedido
            GROUP BY COALESCE(NULLIF(btrim(dp.comensal), ''), 'General')
        ),
        pagos_comensales AS (
            SELECT
                COALESCE(NULLIF(btrim(t.comensal), ''), 'General')::VARCHAR AS nombre_comensal,
                SUM(t.monto)::DECIMAL(10,2) AS monto_pagado
            FROM transacciones t
            JOIN pedidos_activos pa ON t.id_pedido = pa.id_pedido
            WHERE t.estado_transaccion = 'completada'
            GROUP BY COALESCE(NULLIF(btrim(t.comensal), ''), 'General')
        )
        SELECT
            COALESCE(c.cant_items, 0::BIGINT) AS total_items,
            COALESCE(c.consumo_total, 0.00) AS subtotal_comensal,
            COALESCE(p.monto_pagado, 0.00) AS pagado_comensal
        FROM consumo_comensales c
        FULL OUTER JOIN pagos_comensales p ON c.nombre_comensal = p.nombre_comensal
    ) cu;

    -- Emitir la fila de total general de la mesa si hay consumos o pagos registrados
    IF v_total_subtotal > 0 OR v_total_pagado > 0 THEN
        comensal := 'TOTAL MESA'::VARCHAR;
        items_pedidos := v_total_items;
        subtotal := v_total_subtotal;
        pagado := v_total_pagado;
        saldo := v_total_saldo;
        RETURN NEXT;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- 3. FUNCIÓN: obtener_cuenta_mesa_json(id_mesa)
-- Devuelve un objeto JSON completo estructurado para endpoints REST y WebSockets,
-- incluyendo sesion_iniciada_en y restringiendo la lista de pedidos a la sesión activa.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION obtener_cuenta_mesa_json(id_mesa_param INTEGER)
RETURNS JSON AS $$
DECLARE
    v_resultado JSON;
    v_mesa RECORD;
BEGIN
    SELECT id_mesa, numero, estado, capacidad, ubicacion, sesion_iniciada_en
    INTO v_mesa
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    WITH cuenta_datos AS (
        SELECT *
        FROM obtener_cuenta_mesa(id_mesa_param)
        WHERE comensal != 'TOTAL MESA'
    ),
    totales_datos AS (
        SELECT subtotal, pagado, saldo, items_pedidos
        FROM obtener_cuenta_mesa(id_mesa_param)
        WHERE comensal = 'TOTAL MESA'
    ),
    pedidos_lista AS (
        SELECT json_agg(json_build_object(
            'id_pedido', p.id_pedido,
            'codigo_pedido', p.codigo_pedido,
            'estado', p.estado,
            'total', p.total,
            'creado_en', p.creado_en
        )) AS lista
        FROM pedidos p
        WHERE p.id_mesa = id_mesa_param
          AND p.estado != 'cancelado'
          AND (v_mesa.sesion_iniciada_en IS NULL OR p.creado_en >= v_mesa.sesion_iniciada_en)
    )
    SELECT json_build_object(
        'id_mesa', v_mesa.id_mesa,
        'numero', v_mesa.numero,
        'estado_mesa', v_mesa.estado,
        'ubicacion', v_mesa.ubicacion,
        'sesion_iniciada_en', v_mesa.sesion_iniciada_en,
        'total_mesa', COALESCE((SELECT subtotal FROM totales_datos), 0.00),
        'pagado_mesa', COALESCE((SELECT pagado FROM totales_datos), 0.00),
        'saldo_mesa', COALESCE((SELECT saldo FROM totales_datos), 0.00),
        'items_totales', COALESCE((SELECT items_pedidos FROM totales_datos), 0),
        'pedidos', COALESCE((SELECT lista FROM pedidos_lista), '[]'::json),
        'comensales', COALESCE((
            SELECT json_agg(json_build_object(
                'comensal', cd.comensal,
                'items_pedidos', cd.items_pedidos,
                'subtotal', cd.subtotal,
                'pagado', cd.pagado,
                'saldo', cd.saldo
            ))
            FROM cuenta_datos cd
        ), '[]'::json)
    ) INTO v_resultado;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- 4. FUNCIÓN: procesar_pago_comensal_mesa
-- Permite registrar un cobro por comensal a nivel de mesa directamente,
-- respetando sesion_iniciada_en al buscar pedidos con saldo pendiente.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION procesar_pago_comensal_mesa(
    id_mesa_param INTEGER,
    comensal_param VARCHAR,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    referencia_param VARCHAR DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id_pedido INTEGER;
    v_id_transaccion INTEGER;
    v_sesion_iniciada_en TIMESTAMPTZ;
BEGIN
    SELECT sesion_iniciada_en INTO v_sesion_iniciada_en
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    -- Seleccionar el pedido activo de la sesión actual con saldo pendiente
    SELECT p.id_pedido
    INTO v_id_pedido
    FROM pedidos p
    WHERE p.id_mesa = id_mesa_param
      AND p.estado NOT IN ('pagado', 'cancelado')
      AND (v_sesion_iniciada_en IS NULL OR p.creado_en >= v_sesion_iniciada_en)
    ORDER BY p.creado_en ASC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró un pedido activo con saldo pendiente en la mesa %', id_mesa_param;
    END IF;

    v_id_transaccion := procesar_pago(
        v_id_pedido,
        metodo_pago_param,
        monto_param,
        referencia_param,
        comensal_param
    );

    RETURN v_id_transaccion;
END;
$$ LANGUAGE plpgsql;
