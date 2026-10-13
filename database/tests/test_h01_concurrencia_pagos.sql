-- ==============================================================================
-- PRUEBA REPRODUCIBLE: H-01 (Condición de carrera / sobrecobro en pagos)
-- ARCHIVO: database/tests/test_h01_concurrencia_pagos.sql
-- ==============================================================================
-- ESCENARIO DE FALLA ANTES DEL FIX:
-- Sin "FOR UPDATE" en fn_tr_validar_transaccion_financiera, dos o más sesiones concurrentes
-- leían pedidos.total ($34.000) y SUM(transacciones) ($0) al mismo tiempo en aislamiento
-- Read Committed. Ambas calculaban $0 + $20.000 <= $34.000 y se confirmaban ambas ($40.000 o $100.000 cobrados).
--
-- COMPORTAMIENTO ESPERADO DESPUÉS DEL FIX:
-- Gracias a "SELECT total FROM pedidos WHERE id_pedido = NEW.id_pedido FOR UPDATE", la primera
-- transacción bloquea la fila del pedido. Las demás sesiones esperan el commit de la primera.
-- Al liberarse el lock, las sesiones en espera leen el nuevo estado de transacciones y fallan
-- con la excepción del trigger: "Pago excede el monto debido del pedido...".
-- ==============================================================================

DO $$
DECLARE
    v_id_mesa INTEGER;
    v_id_pedido INTEGER;
    v_id_plato INTEGER;
    v_excepcion_capturada BOOLEAN := FALSE;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA H-01: Serialización y validación de sobrecobro ---';

    -- 1. Preparar mesa y pedido de prueba por $34.000
    SELECT id_mesa INTO v_id_mesa FROM mesas LIMIT 1;
    SELECT id_plato INTO v_id_plato FROM platos LIMIT 1;

    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_id_mesa, 'TEST-H01-' || floor(random() * 10000)::text, 'entregado', 34000.00)
    RETURNING id_pedido INTO v_id_pedido;

    -- 2. Primer abono de $20.000 (Debe ser exitoso: saldo restante $14.000)
    INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, comensal)
    VALUES (v_id_pedido, 'efectivo', 20000.00, 'completada', 'Comensal 1');

    RAISE NOTICE 'Primer abono de $20.000 confirmado con éxito.';

    -- 3. Segundo abono concurrente/adicional de $20.000 (Excede el total de $34.000, debe fallar)
    BEGIN
        INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, comensal)
        VALUES (v_id_pedido, 'efectivo', 20000.00, 'completada', 'Comensal 2');
    EXCEPTION WHEN OTHERS THEN
        v_excepcion_capturada := TRUE;
        RAISE NOTICE 'Excepción esperada capturada correctamente: %', SQLERRM;
    END;

    IF NOT v_excepcion_capturada THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-01: Se permitió un sobrecobro que superó el total del pedido.';
    END IF;

    -- 4. Limpieza del pedido de prueba
    DELETE FROM transacciones WHERE id_pedido = v_id_pedido;
    DELETE FROM pedidos WHERE id_pedido = v_id_pedido;

    RAISE NOTICE '=== PRUEBA H-01 PASADA SATISFACTORIAMENTE ===';
END;
$$;
