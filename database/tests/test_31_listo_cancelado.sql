-- ==============================================================================
-- PRUEBA REPRODUCIBLE: listo → cancelado (script 31)
-- ARCHIVO: database/tests/test_31_listo_cancelado.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada en la base. No depende del
-- seed: crea su propia mesa, su insumo y su plato con receta. La reserva de
-- inventario es un trigger DIFERIDO; se fuerza con SET CONSTRAINTS ... IMMEDIATE
-- como en test_p19_inventario.sql.
--
-- CASOS:
--  1. La fila listo → cancelado existe (una sola vez: el script es idempotente).
--  2. Pedido en 'listo' → 'cancelado' por UPDATE (lo que hace el backend):
--     permitido, y lo cocinado es MERMA (cantidad 0), sin devolución; el stock
--     queda como después de la reserva.
--  3. cancelar_pedido() desde 'listo': permitido, una merma por detalle, ninguna
--     devolución, historial con estado_anterior 'listo'.
--  4. Siguen prohibidos: entregado → cancelado (trigger y cancelar_pedido) y
--     pagado → cancelado.
--  5. cancelar_pedido() desde 'recibido' sigue devolviendo el stock (no se
--     rompió el camino de siempre).
-- ==============================================================================

BEGIN;

CREATE FUNCTION pg_temp.stock(p_insumo INTEGER) RETURNS NUMERIC AS $$
    SELECT stock_actual FROM insumos WHERE id_insumo = p_insumo
$$ LANGUAGE sql;

-- Dispara ahora las reservas pendientes, como lo haría el COMMIT.
CREATE FUNCTION pg_temp.confirmar() RETURNS VOID AS $$
BEGIN
    SET CONSTRAINTS tr_reservar_inventario IMMEDIATE;
    SET CONSTRAINTS tr_reservar_inventario DEFERRED;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_mesa INTEGER;
    v_cat INTEGER;
    v_plato INTEGER;
    v_insumo INTEGER;
    v_ped INTEGER;
    v_det INTEGER;
    v_fallo BOOLEAN;
    v_msg TEXT;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA 31: listo → cancelado ---';

    -- ---------------------------------------------------------------- datos
    INSERT INTO mesas (numero, capacidad, ubicacion, estado)
    VALUES (9931, 2, 'T31 prueba', 'disponible') RETURNING id_mesa INTO v_mesa;
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion)
    VALUES ('T31 Prueba', 'prueba', 99) RETURNING id_categoria INTO v_cat;
    INSERT INTO platos (id_categoria, nombre, precio)
    VALUES (v_cat, 'T31 Arepa', 10000) RETURNING id_plato INTO v_plato;
    INSERT INTO insumos (nombre, unidad, stock_minimo)
    VALUES ('T31 Masa', 'porcion', 0) RETURNING id_insumo INTO v_insumo;
    PERFORM registrar_movimiento_inventario(v_insumo, 'entrada', 10, 'carga T31');
    INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES (v_plato, v_insumo, 1);

    -- ---------------------------------------------------------------- 1
    IF (SELECT count(*) FROM transiciones_validas WHERE estado_desde = 'listo' AND estado_hacia = 'cancelado') <> 1 THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 1: falta la transición listo → cancelado (¿se aplicó el script 31?)';
    END IF;
    RAISE NOTICE 'Caso 1 OK: existe listo → cancelado';

    -- ---------------------------------------------------------------- 2
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T31-A', 'recibido', 0) RETURNING id_pedido INTO v_ped;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_ped, v_plato, 2, 10000, 20000) RETURNING id_detalle INTO v_det;
    PERFORM pg_temp.confirmar();
    IF pg_temp.stock(v_insumo) <> 8 THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 2: la reserva no descontó (stock %)', pg_temp.stock(v_insumo);
    END IF;
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'listo' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = v_ped;
    IF (SELECT estado FROM pedidos WHERE id_pedido = v_ped) <> 'cancelado'
       OR pg_temp.stock(v_insumo) <> 8
       OR (SELECT count(*) FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'merma' AND cantidad = 0) <> 1
       OR EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'devolucion') THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 2: listo → cancelado debía quedar cancelado, como merma y sin devolver (stock %)', pg_temp.stock(v_insumo);
    END IF;
    RAISE NOTICE 'Caso 2 OK: UPDATE listo → cancelado permitido; lo cocinado es merma';

    -- ---------------------------------------------------------------- 3
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T31-B', 'recibido', 0) RETURNING id_pedido INTO v_ped;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_ped, v_plato, 1, 10000, 10000) RETURNING id_detalle INTO v_det;
    PERFORM pg_temp.confirmar();
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'listo' WHERE id_pedido = v_ped;
    PERFORM cancelar_pedido(v_ped, 'el cliente se fue');
    IF (SELECT estado FROM pedidos WHERE id_pedido = v_ped) <> 'cancelado'
       OR pg_temp.stock(v_insumo) <> 7
       OR (SELECT count(*) FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'merma') <> 1
       OR EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'devolucion')
       OR NOT EXISTS (SELECT 1 FROM historial_estados WHERE id_pedido = v_ped AND estado_anterior = 'listo'
                       AND estado_nuevo = 'cancelado' AND observaciones LIKE '%el cliente se fue%') THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 3: cancelar_pedido desde listo (stock %)', pg_temp.stock(v_insumo);
    END IF;
    RAISE NOTICE 'Caso 3 OK: cancelar_pedido() desde listo, una merma y su historial';

    -- ---------------------------------------------------------------- 4
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T31-C', 'recibido', 0) RETURNING id_pedido INTO v_ped;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_ped, v_plato, 1, 10000, 10000);
    PERFORM pg_temp.confirmar();
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'listo' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = v_ped;

    v_fallo := FALSE;
    BEGIN
        UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = v_ped;
    EXCEPTION WHEN OTHERS THEN
        v_fallo := TRUE; v_msg := SQLERRM;
    END;
    IF NOT v_fallo OR v_msg NOT LIKE '%no autorizada%' THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 4: entregado → cancelado tenía que seguir prohibido (%)', v_msg;
    END IF;

    v_fallo := FALSE;
    BEGIN
        PERFORM cancelar_pedido(v_ped, 'no debe poder');
    EXCEPTION WHEN OTHERS THEN
        v_fallo := TRUE; v_msg := SQLERRM;
    END;
    IF NOT v_fallo OR v_msg NOT LIKE '%estado "entregado"%' OR v_msg NOT LIKE '%listo%' THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 4: cancelar_pedido desde entregado tenía que fallar y nombrar los estados permitidos (%)', v_msg;
    END IF;

    UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = v_ped;
    v_fallo := FALSE;
    BEGIN
        UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = v_ped;
    EXCEPTION WHEN OTHERS THEN
        v_fallo := TRUE;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 4: pagado → cancelado tenía que seguir prohibido';
    END IF;
    RAISE NOTICE 'Caso 4 OK: entregado y pagado siguen sin poder cancelarse';

    -- ---------------------------------------------------------------- 5
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T31-D', 'recibido', 0) RETURNING id_pedido INTO v_ped;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_ped, v_plato, 1, 10000, 10000) RETURNING id_detalle INTO v_det;
    PERFORM pg_temp.confirmar();
    PERFORM cancelar_pedido(v_ped, 'desde recibido');
    IF NOT EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'devolucion')
       OR pg_temp.stock(v_insumo) <> 6 THEN
        RAISE EXCEPTION 'FALLÓ 31 caso 5: cancelar_pedido desde recibido debía devolver (stock %)', pg_temp.stock(v_insumo);
    END IF;
    RAISE NOTICE 'Caso 5 OK: desde recibido sigue devolviendo';

    RAISE NOTICE 'test_31_listo_cancelado: OK (5 casos)';
END $$;

ROLLBACK;
