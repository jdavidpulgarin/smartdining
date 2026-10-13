-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 20_fix_h02_sesion_mesa_cuenta.sql
-- HALLAZGO: H-02 (ALTO) — La cuenta arrastra la sesión anterior si sesion_iniciada_en es NULL
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- PROBLEMA:
-- En el script 17, si mesas.sesion_iniciada_en era NULL (por ejemplo, tras liberar
-- la mesa y reabrirla antes de que el backend fije el timestamp, o por desincronización),
-- la condición (v_sesion_iniciada_en IS NULL OR creado_en >= v_sesion_iniciada_en)
-- provocaba que la cuenta de la nueva visita sumara todos los pedidos históricos de visitas anteriores.
--
-- SOLUCIÓN:
-- 1. En obtener_cuenta_mesa: si sesion_iniciada_en IS NULL, tratar como "sin consumos"
--    (retornar tabla vacía de inmediato).
-- 2. Si sesion_iniciada_en IS NOT NULL, filtrar estrictamente creado_en >= sesion_iniciada_en.
-- 3. En obtener_cuenta_mesa_json: si sesion_iniciada_en IS NULL, devolver estructura vacía
--    con totales en 0.00, items en 0 y arreglos vacíos de pedidos y comensales.
-- 4. En procesar_pago_comensal_mesa: exigir sesión activa no nula antes de intentar cobrar.

-- ------------------------------------------------------------------------------
-- 1. FUNCIÓN: obtener_cuenta_mesa
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
    -- Validar existencia de la mesa y obtener timestamp de inicio de sesión
    SELECT sesion_iniciada_en
    INTO v_sesion_iniciada_en
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    -- REGLA H-02: Si la mesa no tiene sesión activa iniciada, no hay consumos activos
    IF v_sesion_iniciada_en IS NULL THEN
        RETURN;
    END IF;

    -- Desglose por comensal limitado exclusivamente a la sesión activa actual
    RETURN QUERY
    WITH pedidos_activos AS (
        SELECT id_pedido
        FROM pedidos
        WHERE id_mesa = id_mesa_param
          AND estado != 'cancelado'
          AND creado_en >= v_sesion_iniciada_en
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
              AND creado_en >= v_sesion_iniciada_en
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
-- 2. FUNCIÓN: obtener_cuenta_mesa_json
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

    -- REGLA H-02: Si sesion_iniciada_en IS NULL, devolver cuenta en $0 y listas vacías
    IF v_mesa.sesion_iniciada_en IS NULL THEN
        RETURN json_build_object(
            'id_mesa', v_mesa.id_mesa,
            'numero', v_mesa.numero,
            'estado_mesa', v_mesa.estado,
            'ubicacion', v_mesa.ubicacion,
            'sesion_iniciada_en', NULL,
            'total_mesa', 0.00,
            'pagado_mesa', 0.00,
            'saldo_mesa', 0.00,
            'items_totales', 0,
            'pedidos', '[]'::json,
            'comensales', '[]'::json
        );
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
          AND p.creado_en >= v_mesa.sesion_iniciada_en
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
-- 3. FUNCIÓN: procesar_pago_comensal_mesa
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

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    IF v_sesion_iniciada_en IS NULL THEN
        RAISE EXCEPTION 'La mesa % no tiene una sesión activa iniciada (sesion_iniciada_en es nulo)', id_mesa_param;
    END IF;

    -- Seleccionar el pedido activo de la sesión actual con saldo pendiente
    SELECT p.id_pedido
    INTO v_id_pedido
    FROM pedidos p
    WHERE p.id_mesa = id_mesa_param
      AND p.estado NOT IN ('pagado', 'cancelado')
      AND p.creado_en >= v_sesion_iniciada_en
    ORDER BY p.creado_en ASC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró un pedido activo con saldo pendiente en la sesión actual de la mesa %', id_mesa_param;
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
