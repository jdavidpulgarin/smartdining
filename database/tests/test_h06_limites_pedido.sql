-- ==============================================================================
-- PRUEBA REPRODUCIBLE: H-06 (Límites de cantidad y tope de ítems en pedidos)
-- ARCHIVO: database/tests/test_h06_limites_pedido.sql
-- ==============================================================================
-- ESCENARIO DE FALLA ANTES DEL FIX:
-- detalles_pedido permitía cantidad = 500 o cantidad = 100000000 sin restricción superior.
--
-- COMPORTAMIENTO ESPERADO DESPUÉS DEL FIX:
-- 1. cantidad < 1 o cantidad > 20 debe disparar violación de CHECK o excepción del trigger.
-- 2. La suma de cantidades en un mismo pedido no puede exceder 50 ítems totales.
-- ==============================================================================

DO $$
DECLARE
    v_id_mesa INTEGER;
    v_id_plato INTEGER;
    v_id_pedido INTEGER;
    v_error_cantidad_baja BOOLEAN := FALSE;
    v_error_cantidad_alta BOOLEAN := FALSE;
    v_error_tope_pedido BOOLEAN := FALSE;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA H-06: Restricciones de cantidad e items por pedido ---';

    SELECT id_mesa INTO v_id_mesa FROM mesas LIMIT 1;
    SELECT id_plato INTO v_id_plato FROM platos LIMIT 1;

    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_id_mesa, 'TEST-H06-' || floor(random() * 10000)::text, 'recibido', 0.00)
    RETURNING id_pedido INTO v_id_pedido;

    -- CASO 1: Intentar cantidad 0 (debe fallar)
    BEGIN
        INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
        VALUES (v_id_pedido, v_id_plato, 0, 10000.00, 0.00);
    EXCEPTION WHEN OTHERS THEN
        v_error_cantidad_baja := TRUE;
        RAISE NOTICE 'Cantidad 0 rechazada correctamente: %', SQLERRM;
    END;

    IF NOT v_error_cantidad_baja THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-06: Se permitió insertar cantidad = 0.';
    END IF;

    -- CASO 2: Intentar cantidad 21 (debe fallar por exceder el máximo de 20 por ítem)
    BEGIN
        INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
        VALUES (v_id_pedido, v_id_plato, 21, 10000.00, 210000.00);
    EXCEPTION WHEN OTHERS THEN
        v_error_cantidad_alta := TRUE;
        RAISE NOTICE 'Cantidad 21 rechazada correctamente: %', SQLERRM;
    END IF;

    IF NOT v_error_cantidad_alta THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-06: Se permitió insertar cantidad = 21.';
    END IF;

    -- CASO 3: Insertar ítems válidos hasta superar 50 ítems acumulados
    -- Fila 1: 20 ítems (acumulado: 20) -> Válido
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_id_pedido, v_id_plato, 20, 1000.00, 20000.00);

    -- Fila 2: 20 ítems (acumulado: 40) -> Válido
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_id_pedido, v_id_plato, 20, 1000.00, 20000.00);

    -- Fila 3: 15 ítems (acumulado: 40 + 15 = 55 > 50) -> Debe fallar por trigger de 50 ítems
    BEGIN
        INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
        VALUES (v_id_pedido, v_id_plato, 15, 1000.00, 15000.00);
    EXCEPTION WHEN OTHERS THEN
        v_error_tope_pedido := TRUE;
        RAISE NOTICE 'Tope acumulado de 50 ítems protegido correctamente: %', SQLERRM;
    END;

    IF NOT v_error_tope_pedido THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-06: Se permitió un pedido con más de 50 ítems.';
    END IF;

    -- Limpieza
    DELETE FROM detalles_pedido WHERE id_pedido = v_id_pedido;
    DELETE FROM pedidos WHERE id_pedido = v_id_pedido;

    RAISE NOTICE '=== PRUEBA H-06 PASADA SATISFACTORIAMENTE ===';
END;
$$;
