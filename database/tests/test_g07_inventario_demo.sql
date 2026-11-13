-- ==============================================================================
-- PRUEBA REPRODUCIBLE: G-07 (datos de inventario para la demo)
-- ARCHIVO: database/tests/test_g07_inventario_demo.sql
-- ==============================================================================
-- Requiere haber cargado database/seed_inventario_demo.sql (una o más veces).
-- Corre dentro de BEGIN ... ROLLBACK: no gasta el stock de la demo. La reserva
-- es un trigger DIFERIDO; aquí se fuerza con SET CONSTRAINTS ... IMMEDIATE.
--
-- CASOS:
--  1. Sin duplicados: 34 insumos, 20 recetas de plato, 39 de opción, y UNA
--     sola entrada inicial por insumo (aunque el seed se haya corrido dos veces).
--     Cuenta solo las del seed (motivo 'Carga inicial de la demo (G-07)'): las
--     reposiciones posteriores, como la del E2E de la demo, no son duplicados.
--  2. El libro cuadra: SUM(movimientos.cantidad) = stock_actual en cada insumo.
--  3. Arepa de chócolo sale en v_stock_bajo desde el inicio (2 con mínimo 4).
--  4. Panceta Crujiente del Bowl: apagada a mano ('manual'), no por stock.
--  5. Hamburguesa Smart Angus: los pedidos 1 a 3 pasan y sigue en la carta;
--     el 4.º la agota (stock 0, sale de la carta); el 5.º recibe SD001.
-- ==============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION pg_temp.nuevo_pedido() RETURNS INTEGER AS $$
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    SELECT m.id_mesa, 'G07-' || substr(md5(random()::TEXT), 1, 10), 'recibido', 0
    FROM mesas m WHERE m.activa ORDER BY m.id_mesa LIMIT 1
    RETURNING id_pedido
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.pedir_hamburguesa() RETURNS VOID AS $$
BEGIN
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    SELECT pg_temp.nuevo_pedido(), p.id_plato, 1, p.precio, p.precio
    FROM platos p WHERE p.nombre = 'Hamburguesa Smart Angus';
    SET CONSTRAINTS tr_reservar_inventario IMMEDIATE;
    SET CONSTRAINTS tr_reservar_inventario DEFERRED;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_n INTEGER;
    v_stock NUMERIC;
    v_ok BOOLEAN;
    v_motivo TEXT;
    v_estado TEXT;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA G-07: inventario de la demo ---';

    -- 1. Sin duplicados
    SELECT count(*) INTO v_n FROM insumos;
    IF v_n <> 34 THEN RAISE EXCEPTION 'Caso 1: se esperaban 34 insumos, hay %', v_n; END IF;
    SELECT count(*) INTO v_n FROM recetas_plato;
    IF v_n <> 20 THEN RAISE EXCEPTION 'Caso 1: se esperaban 20 recetas de plato, hay %', v_n; END IF;
    SELECT count(*) INTO v_n FROM recetas_ingrediente;
    IF v_n <> 39 THEN RAISE EXCEPTION 'Caso 1: se esperaban 39 recetas de opción, hay %', v_n; END IF;
    SELECT count(*) INTO v_n FROM (
        -- Solo las entradas DEL SEED: una entrada de reposición posterior (la
        -- del paso 9 de la demo E2E, o la de un admin) es legítima.
        SELECT id_insumo FROM movimientos_inventario
        WHERE tipo = 'entrada' AND motivo = 'Carga inicial de la demo (G-07)'
        GROUP BY id_insumo HAVING count(*) > 1) t;
    IF v_n <> 0 THEN RAISE EXCEPTION 'Caso 1: % insumos tienen más de una entrada inicial', v_n; END IF;
    RAISE NOTICE 'Caso 1 OK: 34 insumos, 20 + 39 recetas, una entrada por insumo';

    -- 2. El libro cuadra
    SELECT count(*) INTO v_n
    FROM insumos s
    WHERE s.stock_actual <> COALESCE((SELECT SUM(m.cantidad) FROM movimientos_inventario m
                                      WHERE m.id_insumo = s.id_insumo), 0);
    IF v_n <> 0 THEN RAISE EXCEPTION 'Caso 2: % insumos no cuadran con su libro', v_n; END IF;
    RAISE NOTICE 'Caso 2 OK: SUM(movimientos) = stock_actual en todos los insumos';

    -- 3. Stock bajo desde el inicio
    IF NOT EXISTS (SELECT 1 FROM v_stock_bajo WHERE nombre = 'Arepa de chócolo' AND NOT agotado) THEN
        RAISE EXCEPTION 'Caso 3: Arepa de chócolo no sale en v_stock_bajo';
    END IF;
    RAISE NOTICE 'Caso 3 OK: Arepa de chócolo en stock bajo (2 con mínimo 4)';

    -- 4. Panceta del Bowl apagada a mano, no por stock
    SELECT v.motivo INTO v_motivo
    FROM v_carta_disponible v
    JOIN ingredientes i ON i.id_ingrediente = v.id AND v.tipo = 'ingrediente'
    JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
    JOIN platos p ON p.id_plato = pc.id_plato
    WHERE i.nombre = 'Panceta Crujiente' AND p.nombre = 'Bowl Personalizado';
    IF v_motivo IS DISTINCT FROM 'manual' THEN
        RAISE EXCEPTION 'Caso 4: la Panceta del Bowl debería estar apagada a mano, motivo = %', v_motivo;
    END IF;
    RAISE NOTICE 'Caso 4 OK: Panceta del Bowl apagada a mano (motivo manual)';

    -- 5. La Hamburguesa se agota en el 4.º pedido
    IF (SELECT stock_actual FROM insumos WHERE nombre = 'Carne Angus 200 g') <> 4 THEN
        RAISE EXCEPTION 'Caso 5: la carne Angus no arranca en 4 (¿ya se pidieron hamburguesas en esta base?)';
    END IF;
    FOR i IN 1..3 LOOP
        PERFORM pg_temp.pedir_hamburguesa();
    END LOOP;
    SELECT s.stock_actual, p.stock_suficiente INTO v_stock, v_ok
    FROM insumos s, platos p WHERE s.nombre = 'Carne Angus 200 g' AND p.nombre = 'Hamburguesa Smart Angus';
    IF v_stock <> 1 OR NOT v_ok THEN
        RAISE EXCEPTION 'Caso 5: tras 3 pedidos se esperaba stock 1 y plato en carta; hay % y %', v_stock, v_ok;
    END IF;

    PERFORM pg_temp.pedir_hamburguesa();
    SELECT s.stock_actual, p.stock_suficiente INTO v_stock, v_ok
    FROM insumos s, platos p WHERE s.nombre = 'Carne Angus 200 g' AND p.nombre = 'Hamburguesa Smart Angus';
    IF v_stock <> 0 OR v_ok THEN
        RAISE EXCEPTION 'Caso 5: tras el 4.º pedido se esperaba stock 0 y plato fuera; hay % y %', v_stock, v_ok;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM v_carta_disponible
                   WHERE tipo = 'plato' AND nombre = 'Hamburguesa Smart Angus' AND motivo = 'stock') THEN
        RAISE EXCEPTION 'Caso 5: la carta no marca la Hamburguesa como agotada por stock';
    END IF;

    BEGIN
        PERFORM pg_temp.pedir_hamburguesa();
        RAISE EXCEPTION 'Caso 5: el 5.º pedido debió fallar con SD001';
    EXCEPTION WHEN SQLSTATE 'SD001' THEN
        GET STACKED DIAGNOSTICS v_estado = RETURNED_SQLSTATE;
    END;
    RAISE NOTICE 'Caso 5 OK: pedidos 1-3 pasan, el 4.º agota la Hamburguesa, el 5.º recibe %', v_estado;

    RAISE NOTICE '=== PRUEBA G-07 PASADA SATISFACTORIAMENTE ===';
END $$;

ROLLBACK;
