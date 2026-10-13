-- ==============================================================================
-- PRUEBA REPRODUCIBLE: H-02 (Aislamiento de cuenta por sesión de mesa)
-- ARCHIVO: database/tests/test_h02_sesion_mesa_cuenta.sql
-- ==============================================================================
-- ESCENARIO DE FALLA ANTES DEL FIX:
-- Si una mesa tenía pedidos de una visita anterior y sesion_iniciada_en = NULL,
-- obtener_cuenta_mesa() y obtener_cuenta_mesa_json() devolvían los $34.500 del cliente
-- anterior en lugar de una cuenta vacía ($0).
--
-- COMPORTAMIENTO ESPERADO DESPUÉS DEL FIX:
-- 1. Mesa con pedidos antiguos y sesion_iniciada_en = NULL -> total $0 y 0 comensales.
-- 2. Mesa con sesion_iniciada_en = NOW() -> solo cuenta pedidos creados a partir de NOW().
-- ==============================================================================

DO $$
DECLARE
    v_id_mesa INTEGER;
    v_id_plato INTEGER;
    v_id_pedido_antiguo INTEGER;
    v_id_pedido_nuevo INTEGER;
    v_cuenta_json JSON;
    v_total_nulo DECIMAL(10,2);
    v_total_nuevo DECIMAL(10,2);
    v_cant_filas INTEGER;
    v_t_corte TIMESTAMPTZ;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA H-02: Sesion de mesa y cuenta aislada ---';

    -- 1. Obtener plato de referencia
    SELECT id_plato INTO v_id_plato FROM platos LIMIT 1;

    -- 2. Crear mesa de prueba aislada
    INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
    VALUES (999, 4, 'terraza', 'disponible', NULL)
    RETURNING id_mesa INTO v_id_mesa;

    -- 3. Crear pedido "antiguo" en esa mesa
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, creado_en)
    VALUES (v_id_mesa, 'TEST-OLD-01', 'entregado', 34500.00, NOW() - INTERVAL '1 hour')
    RETURNING id_pedido INTO v_id_pedido_antiguo;

    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (v_id_pedido_antiguo, v_id_plato, 1, 34500.00, 34500.00, 'Cliente Anterior');

    -- CASO A: sesion_iniciada_en IS NULL -> Debe dar total $0 y ninguna fila en obtener_cuenta_mesa
    SELECT COUNT(*) INTO v_cant_filas FROM obtener_cuenta_mesa(v_id_mesa);
    v_cuenta_json := obtener_cuenta_mesa_json(v_id_mesa);
    v_total_nulo := (v_cuenta_json->>'total_mesa')::DECIMAL(10,2);

    IF v_cant_filas != 0 OR v_total_nulo != 0.00 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-02 (Caso NULL): Se arrastraron consumos previos cuando sesion_iniciada_en era NULL. Filas: %, Total: %', v_cant_filas, v_total_nulo;
    END IF;
    RAISE NOTICE 'Caso A verificado: sesion_iniciada_en = NULL produce cuenta $0 y lista vacía.';

    -- CASO B: Abrir nueva sesión en la mesa (sesion_iniciada_en = NOW())
    v_t_corte := NOW();
    UPDATE mesas SET sesion_iniciada_en = v_t_corte, estado = 'ocupada' WHERE id_mesa = v_id_mesa;

    -- Todavía sin pedidos nuevos: debe seguir dando $0
    v_cuenta_json := obtener_cuenta_mesa_json(v_id_mesa);
    IF (v_cuenta_json->>'total_mesa')::DECIMAL(10,2) != 0.00 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-02 (Caso inicio de sesión): La cuenta no arrancó en 0 tras abrir sesión.';
    END IF;

    -- Crear pedido nuevo de la nueva sesión por $15.000
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, creado_en)
    VALUES (v_id_mesa, 'TEST-NEW-01', 'recibido', 15000.00, NOW() + INTERVAL '1 second')
    RETURNING id_pedido INTO v_id_pedido_nuevo;

    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (v_id_pedido_nuevo, v_id_plato, 1, 15000.00, 15000.00, 'Nuevo Cliente');

    -- Consultar cuenta de la sesión activa: solo debe reflejar los $15.000 nuevos, no los $34.500 antiguos
    v_cuenta_json := obtener_cuenta_mesa_json(v_id_mesa);
    v_total_nuevo := (v_cuenta_json->>'total_mesa')::DECIMAL(10,2);

    IF v_total_nuevo != 15000.00 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA H-02 (Caso consumos nuevos): Se esperaba total $15000.00, pero dio %', v_total_nuevo;
    END IF;
    RAISE NOTICE 'Caso B verificado: sesion_iniciada_en = NOW() aisló únicamente el nuevo consumo de $15.000.';

    -- Limpieza
    DELETE FROM detalles_pedido WHERE id_pedido IN (v_id_pedido_antiguo, v_id_pedido_nuevo);
    DELETE FROM pedidos WHERE id_pedido IN (v_id_pedido_antiguo, v_id_pedido_nuevo);
    DELETE FROM mesas WHERE id_mesa = v_id_mesa;

    RAISE NOTICE '=== PRUEBA H-02 PASADA SATISFACTORIAMENTE ===';
END;
$$;
