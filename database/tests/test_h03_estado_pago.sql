-- ==============================================================================
-- PRUEBA REPRODUCIBLE: H-03 (Desacople de estado de cocina y estado_pago)
-- ARCHIVO: database/tests/test_h03_estado_pago.sql
-- ==============================================================================
-- ESCENARIO DE FALLA ANTES DEL FIX:
-- Cuando un pedido estaba en estado de cocina 'en_preparacion' y se insertaba un pago
-- completo, el sistema intentaba forzar pedidos.estado = 'pagado', lo cual lanzaba
-- excepción 409 "Transición de estado no autorizada: de 'en_preparacion' hacia 'pagado'".
--
-- COMPORTAMIENTO ESPERADO DESPUÉS DEL FIX:
-- 1. Insertar el pago total de un pedido 'en_preparacion' se acepta sin errores.
-- 2. pedidos.estado_pago pasa automáticamente a 'pagado'.
-- 3. pedidos.estado de cocina permanece intacto en 'en_preparacion'.
-- ==============================================================================

DO $$
DECLARE
    v_id_mesa INTEGER;
    v_id_pedido INTEGER;
    v_estado_cocina VARCHAR(20);
    v_estado_pago VARCHAR(20);
    v_id_transaccion INTEGER;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA H-03: Pago total de pedido en_preparacion ---';

    SELECT id_mesa INTO v_id_mesa FROM mesas LIMIT 1;

    -- 1. Crear un pedido en estado de cocina 'en_preparacion' por $50.000
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_id_mesa, 'TEST-H03-' || floor(random() * 10000)::text, 'en_preparacion', 50000.00)
    RETURNING id_pedido INTO v_id_pedido;

    -- Verificar estado inicial
    SELECT estado, estado_pago INTO v_estado_cocina, v_estado_pago
    FROM pedidos
    WHERE id_pedido = v_id_pedido;

    IF v_estado_cocina != 'en_preparacion' OR v_estado_pago != 'pendiente' THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-03: Estado inicial incorrecto (cocina: %, pago: %)', v_estado_cocina, v_estado_pago;
    END IF;

    -- 2. Procesar abono parcial de $20.000
    v_id_transaccion := procesar_pago(v_id_pedido, 'efectivo', 20000.00, 'ABONO-PARCIAL', 'Comensal 1');

    SELECT estado, estado_pago INTO v_estado_cocina, v_estado_pago
    FROM pedidos
    WHERE id_pedido = v_id_pedido;

    IF v_estado_cocina != 'en_preparacion' OR v_estado_pago != 'parcial' THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-03 (Abono parcial): Estado inesperado (cocina: %, pago: %)', v_estado_cocina, v_estado_pago;
    END IF;
    RAISE NOTICE 'Abono parcial verificado: cocina = %, estado_pago = %', v_estado_cocina, v_estado_pago;

    -- 3. Procesar pago restante de $30.000 (Liquidación total)
    v_id_transaccion := procesar_pago(v_id_pedido, 'tarjeta_debito', 30000.00, 'PAGO-TOTAL', 'Comensal 2');

    SELECT estado, estado_pago INTO v_estado_cocina, v_estado_pago
    FROM pedidos
    WHERE id_pedido = v_id_pedido;

    -- Verificar que el pago se liquidó pero la cocina continúa en 'en_preparacion'
    IF v_estado_pago != 'pagado' THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-03: estado_pago debió ser ''pagado'', pero fue ''%''', v_estado_pago;
    END IF;

    IF v_estado_cocina != 'en_preparacion' THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-03: El estado de cocina cambió a ''%'', debiendo seguir en ''en_preparacion''', v_estado_cocina;
    END IF;

    RAISE NOTICE 'Liquidación total verificada exitosamente: cocina = %, estado_pago = %', v_estado_cocina, v_estado_pago;

    -- 4. Limpieza
    DELETE FROM transacciones WHERE id_pedido = v_id_pedido;
    DELETE FROM pedidos WHERE id_pedido = v_id_pedido;

    RAISE NOTICE '=== PRUEBA H-03 PASADA SATISFACTORIAMENTE ===';
END;
$$;
