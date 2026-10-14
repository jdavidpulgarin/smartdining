-- ==============================================================================
-- PRUEBA REPRODUCIBLE: H-08 (Persistencia de intentos de pago fallidos)
-- ARCHIVO: database/tests/test_h08_intentos_pago_fallidos.sql
-- ==============================================================================
-- ESCENARIO DE FALLA ANTES DEL FIX:
-- El trigger insertaba en intentos_pago_fallidos y luego ejecutaba RAISE EXCEPTION.
-- Dado que PostgreSQL aborta toda la transacción al disparar la excepción, el INSERT
-- se revertía siempre, dejando la tabla intentos_pago_fallidos permanentemente vacía.
--
-- COMPORTAMIENTO ESPERADO DESPUÉS DEL FIX:
-- 1. La función desacoplada registrar_intento_pago_fallido(...) persiste el registro
--    satisfactoriamente en la base de datos sin depender de que la transacción rechazada
--    termine en error.
-- ==============================================================================

DO $$
DECLARE
    v_id_mesa INTEGER;
    v_id_pedido INTEGER;
    v_id_intento INTEGER;
    v_filas_guardadas INTEGER;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA H-08: Registro de intentos fallidos desacoplado ---';

    SELECT id_mesa INTO v_id_mesa FROM mesas LIMIT 1;

    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_id_mesa, 'TEST-H08-' || floor(random() * 10000)::text, 'en_preparacion', 25000.00)
    RETURNING id_pedido INTO v_id_pedido;

    -- Simular la invocación que hará Daniel/Backend desde el bloque catch:
    v_id_intento := registrar_intento_pago_fallido(
        v_id_pedido,
        'tarjeta_credito',
        35000.00,
        'Monto excede el saldo pendiente del pedido'
    );

    IF v_id_intento IS NULL THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-08: registrar_intento_pago_fallido no retornó ID de intento.';
    END IF;

    SELECT COUNT(*) INTO v_filas_guardadas
    FROM intentos_pago_fallidos
    WHERE id_intento = v_id_intento;

    IF v_filas_guardadas != 1 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-08: El intento de pago fallido no quedó persistido.';
    END IF;

    RAISE NOTICE 'Intento fallido ID % persistido correctamente con éxito.', v_id_intento;

    -- Limpieza
    DELETE FROM intentos_pago_fallidos WHERE id_intento = v_id_intento;
    DELETE FROM pedidos WHERE id_pedido = v_id_pedido;

    RAISE NOTICE '=== PRUEBA H-08 PASADA SATISFACTORIAMENTE ===';
END;
$$;
