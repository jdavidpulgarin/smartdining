-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 41_cuenta_sin_lineas_canceladas.sql
-- MÓDULO: Cuenta de la mesa · T4 del plan de correcciones (prueba integral)
-- ==============================================================================
-- HALLAZGO (T4): al quitar uno o varios platos de un pedido (D-13 del personal o
-- J-14 del comensal), la Caja no bajaba el saldo de la mesa.
--
-- CAUSA: obtener_cuenta_mesa() (versión del script 20) suma dp.subtotal y
-- dp.cantidad de TODAS las líneas de los pedidos activos, también las que
-- tienen estado_item = 'cancelado'. El total del pedido sí las excluye
-- (fn_tr_actualizar_total_pedido, script 08), así que el pedido bajaba y la
-- cuenta no. Recargar no lo arreglaba: la cuenta salía mal desde la base.
-- Cancelar el pedido entero sí funcionaba porque pedidos_activos ya excluye
-- los pedidos cancelados.
--
-- La misma función alimenta obtener_cuenta_mesa_json(), que usan la Caja
-- (GET /mesas/:id/cuenta), la PWA y el cobro en línea (cuentaInterna del
-- backend → socket-server → Wompi): sin este script, Wompi cobraría los
-- platos quitados.
--
-- SOLUCIÓN: la misma función del script 20, con un solo cambio en los DOS
-- lugares donde suma las líneas (el desglose por comensal y el total de la
-- mesa): `AND dp.estado_item <> 'cancelado'`. Nada más cambia: la firma, el
-- orden, la regla H-02 (sin sesión no hay consumo) y los pagos son los mismos.
-- obtener_cuenta_mesa_json() no se toca: lee de esta función, y su lista de
-- pedidos usa pedidos.total, que ya estaba bien.
--
-- Un comensal al que le quitaron todo y no pagó nada deja de aparecer en el
-- desglose (no consume ni debe). Si ya había pagado, sigue con su pago
-- (FULL OUTER JOIN), como antes.
--
-- No toca datos y se puede correr dos veces.
-- ==============================================================================

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
    SELECT sesion_iniciada_en
    INTO v_sesion_iniciada_en
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    -- REGLA H-02: sin sesión activa iniciada no hay consumos activos.
    IF v_sesion_iniciada_en IS NULL THEN
        RETURN;
    END IF;

    -- Desglose por comensal de la sesión activa, sin las líneas canceladas.
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
        WHERE dp.estado_item <> 'cancelado'
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

    -- Total de la mesa, con el mismo filtro de líneas.
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
            WHERE dp.estado_item <> 'cancelado'
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

COMMENT ON FUNCTION obtener_cuenta_mesa(INTEGER) IS
    'Cuenta de la sesión activa de la mesa por comensal más la fila TOTAL MESA; sin pedidos ni líneas canceladas. Scripts 20 y 41.';
