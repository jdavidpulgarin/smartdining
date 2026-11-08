-- ==============================================================================
-- PRUEBA REPRODUCIBLE: P-19 (inventario real)
-- ARCHIVO: database/tests/test_p19_inventario.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada en la base. La reserva es un
-- trigger DIFERIDO (corre al COMMIT); aquí se fuerza con SET CONSTRAINTS ...
-- IMMEDIATE para probarla sin confirmar. La concurrencia y pg_notify, que sí
-- necesitan COMMIT, están en test_p19_concurrencia.sh.
--
-- CASOS:
--  1. Consumo de un detalle: receta × cantidad, y opciones × factor de porción.
--  2. Reserva: descuenta y deja una fila "reserva" por detalle e insumo.
--  3. Sin stock: SD001 con faltantes en JSON y se revierte el pedido ENTERO.
--  4. Plato sin receta: no controla inventario.
--  5. Cancelar un ítem pendiente devuelve; cerrar dos veces no devuelve dos.
--  6. Cancelar un pedido en preparación: merma (cantidad 0), no devuelve.
--  7. cancelar_pedido (dispara LOS DOS triggers) desde recibido: UNA devolución.
--  8. cancelar_pedido desde en_preparacion: UNA merma, ninguna devolución.
--  9. stock_suficiente: se apaga solo, SD001 al pedir, menú lo oculta, vuelve.
-- 10. Paso obligatorio sin opciones con stock: el plato queda sin stock.
-- 11. Interruptor manual con stock: error de siempre, no SD001.
-- 12. Stock negativo: SD002 con el stock actual en el DETAIL.
-- 13. v_stock_bajo y el libro: SUM(movimientos) = stock_actual.
-- ==============================================================================

BEGIN;

CREATE FUNCTION pg_temp.stock(p_nombre TEXT) RETURNS NUMERIC AS $$
    SELECT stock_actual FROM insumos WHERE nombre = p_nombre
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.id_insumo(p_nombre TEXT) RETURNS INTEGER AS $$
    SELECT id_insumo FROM insumos WHERE nombre = p_nombre
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.id_plato(p_nombre TEXT) RETURNS INTEGER AS $$
    SELECT id_plato FROM platos WHERE nombre = p_nombre
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.id_ing(p_nombre TEXT) RETURNS INTEGER AS $$
    SELECT id_ingrediente FROM ingredientes WHERE nombre = p_nombre
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.nuevo_pedido() RETURNS INTEGER AS $$
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    SELECT m.id_mesa, 'P19-' || substr(md5(random()::TEXT), 1, 10), 'recibido', 0
    FROM mesas m WHERE m.activa ORDER BY m.id_mesa LIMIT 1
    RETURNING id_pedido
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.agregar(p_pedido INTEGER, p_plato INTEGER, p_cantidad INTEGER) RETURNS INTEGER AS $$
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    SELECT p_pedido, p.id_plato, p_cantidad, p.precio, p.precio * p_cantidad
    FROM platos p WHERE p.id_plato = p_plato
    RETURNING id_detalle
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
    v_cat INTEGER;
    v_arepa INTEGER;
    v_jugo INTEGER;
    v_bowl INTEGER;
    v_paso INTEGER;
    v_ped INTEGER;
    v_det INTEGER;
    v_det2 INTEGER;
    v_n INTEGER;
    v_fallo BOOLEAN;
    v_estado TEXT;
    v_detalle TEXT;
    v_json JSONB;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA P-19: inventario real ---';

    -- ---------------------------------------------------------------- datos
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion) VALUES ('P19 Prueba', 'prueba', 99)
    RETURNING id_categoria INTO v_cat;
    INSERT INTO platos (id_categoria, nombre, precio) VALUES (v_cat, 'P19 Arepa', 10000) RETURNING id_plato INTO v_arepa;
    INSERT INTO platos (id_categoria, nombre, precio) VALUES (v_cat, 'P19 Jugo', 5000) RETURNING id_plato INTO v_jugo;
    INSERT INTO platos (id_categoria, nombre, precio, personalizable) VALUES (v_cat, 'P19 Bowl', 20000, TRUE) RETURNING id_plato INTO v_bowl;
    INSERT INTO pasos_constructor (id_plato, nombre, orden, min_sel, max_sel, obligatorio)
    VALUES (v_bowl, 'P19 Base', 1, 1, 1, TRUE) RETURNING id_paso INTO v_paso;
    INSERT INTO ingredientes (id_paso, nombre, precio_extra) VALUES (v_paso, 'P19 Arroz', 2000), (v_paso, 'P19 Quinoa', 3000);

    INSERT INTO insumos (nombre, unidad, stock_minimo) VALUES
        ('P19 Masa', 'porcion', 0), ('P19 Queso', 'g', 100), ('P19 Arroz g', 'g', 0), ('P19 Quinoa g', 'g', 0);
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Masa'), 'entrada', 10, 'carga inicial');
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Queso'), 'entrada', 500, 'carga inicial');
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Arroz g'), 'entrada', 300, 'carga inicial');
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Quinoa g'), 'entrada', 80, 'carga inicial');

    INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES
        (v_arepa, pg_temp.id_insumo('P19 Masa'), 1), (v_arepa, pg_temp.id_insumo('P19 Queso'), 50);
    INSERT INTO recetas_ingrediente (id_ingrediente, id_insumo, cantidad) VALUES
        (pg_temp.id_ing('P19 Arroz'), pg_temp.id_insumo('P19 Arroz g'), 100),
        (pg_temp.id_ing('P19 Quinoa'), pg_temp.id_insumo('P19 Quinoa g'), 80);

    -- ---------------------------------------------------------------- 1 y 2
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_arepa, 2);
    IF (SELECT cantidad FROM fn_consumo_detalle(v_det) WHERE id_insumo = pg_temp.id_insumo('P19 Queso')) <> 100 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 1: 2 arepas deberían consumir 100 g de queso';
    END IF;
    v_det2 := pg_temp.agregar(v_ped, v_bowl, 1);
    INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion) VALUES (v_det2, pg_temp.id_ing('P19 Arroz'), 'extra');
    IF (SELECT cantidad FROM fn_consumo_detalle(v_det2)) <> 150 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 1: arroz en porción extra (100 × 1.5) debería ser 150';
    END IF;
    RAISE NOTICE 'Caso 1 OK: consumo con receta y factor de porción';

    PERFORM pg_temp.confirmar();
    IF pg_temp.stock('P19 Masa') <> 8 OR pg_temp.stock('P19 Queso') <> 400 OR pg_temp.stock('P19 Arroz g') <> 150 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 2: stock tras reservar (masa %, queso %, arroz %)',
            pg_temp.stock('P19 Masa'), pg_temp.stock('P19 Queso'), pg_temp.stock('P19 Arroz g');
    END IF;
    SELECT count(*) INTO v_n FROM movimientos_inventario WHERE id_detalle IN (v_det, v_det2) AND tipo = 'reserva';
    IF v_n <> 3 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 2: se esperaban 3 filas de reserva, hay %', v_n;
    END IF;
    RAISE NOTICE 'Caso 2 OK: reserva del pedido entero (masa 8, queso 400, arroz 150)';

    -- ---------------------------------------------------------------- 3
    v_fallo := FALSE;
    BEGIN
        v_ped := pg_temp.nuevo_pedido();
        PERFORM pg_temp.agregar(v_ped, v_arepa, 1);
        v_det2 := pg_temp.agregar(v_ped, v_bowl, 1);
        -- 80 × 1.5 = 120 g de quinoa y hay 80: falta.
        INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion) VALUES (v_det2, pg_temp.id_ing('P19 Quinoa'), 'extra');
        PERFORM pg_temp.confirmar();
    EXCEPTION WHEN SQLSTATE 'SD001' THEN
        v_fallo := TRUE;
        GET STACKED DIAGNOSTICS v_detalle = PG_EXCEPTION_DETAIL;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 3: el pedido sin quinoa suficiente no dio SD001';
    END IF;
    v_json := v_detalle::JSONB;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_json->'faltantes') f
                   WHERE f->>'tipo' = 'ingrediente' AND f->>'nombre' = 'P19 Quinoa'
                     AND (f->>'necesita')::NUMERIC = 120 AND (f->>'hay')::NUMERIC = 80) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 3: faltantes inesperados: %', v_detalle;
    END IF;
    IF pg_temp.stock('P19 Masa') <> 8 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 3: la arepa del pedido rechazado sí descontó masa';
    END IF;
    RAISE NOTICE 'Caso 3 OK: SD001 con faltantes % y pedido revertido entero', v_json->'faltantes';

    -- ---------------------------------------------------------------- 4
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_jugo, 3);
    PERFORM pg_temp.confirmar();
    IF EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 4: un plato sin receta generó movimientos';
    END IF;
    RAISE NOTICE 'Caso 4 OK: plato sin receta no controla inventario';

    -- ---------------------------------------------------------------- 5
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_arepa, 1);
    PERFORM pg_temp.confirmar();
    UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = v_det;
    IF pg_temp.stock('P19 Masa') <> 8 OR pg_temp.stock('P19 Queso') <> 400 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 5: cancelar un ítem pendiente no devolvió';
    END IF;
    IF fn_cerrar_reserva_detalle(v_det, FALSE) <> 0 OR pg_temp.stock('P19 Masa') <> 8 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 5: cerrar dos veces devolvió dos veces';
    END IF;
    RAISE NOTICE 'Caso 5 OK: ítem pendiente cancelado devuelve, una sola vez';

    -- ---------------------------------------------------------------- 6
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_arepa, 1);
    PERFORM pg_temp.confirmar();
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v_ped;
    UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = v_ped;
    IF pg_temp.stock('P19 Masa') <> 7
       OR (SELECT count(*) FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'merma' AND cantidad = 0) <> 2
       OR EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'devolucion') THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 6: pedido en preparación cancelado debía ser merma sin devolver';
    END IF;
    RAISE NOTICE 'Caso 6 OK: pedido en preparación cancelado = merma (cantidad 0), sin devolver';

    -- ---------------------------------------------------------------- 7
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_arepa, 2);
    PERFORM pg_temp.confirmar();
    PERFORM cancelar_pedido(v_ped, 'prueba P-19');
    IF pg_temp.stock('P19 Masa') <> 7 OR pg_temp.stock('P19 Queso') <> 350 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 7: cancelar_pedido desde recibido (masa %, queso %)',
            pg_temp.stock('P19 Masa'), pg_temp.stock('P19 Queso');
    END IF;
    SELECT count(*) INTO v_n FROM movimientos_inventario WHERE id_detalle = v_det AND tipo IN ('devolucion', 'merma');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 7: con los dos triggers debía haber 2 cierres (uno por insumo), hay %', v_n;
    END IF;
    RAISE NOTICE 'Caso 7 OK: cancelar_pedido (dos triggers) devuelve una sola vez';

    -- ---------------------------------------------------------------- 8
    v_ped := pg_temp.nuevo_pedido();
    v_det := pg_temp.agregar(v_ped, v_arepa, 1);
    PERFORM pg_temp.confirmar();
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v_ped;
    PERFORM cancelar_pedido(v_ped, 'prueba P-19');
    IF pg_temp.stock('P19 Masa') <> 6
       OR EXISTS (SELECT 1 FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'devolucion')
       OR (SELECT count(*) FROM movimientos_inventario WHERE id_detalle = v_det AND tipo = 'merma') <> 2 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 8: cancelar_pedido en preparación debía ser una merma por insumo';
    END IF;
    RAISE NOTICE 'Caso 8 OK: cancelar_pedido en preparación = merma, sin devolver (el ítem seguía "pendiente")';

    -- ---------------------------------------------------------------- 9
    -- Queso 300 (350 del caso 7 menos la arepa del caso 8, cocinada) -> merma
    -- 260 -> 40, menos que los 50 de una arepa.
    IF pg_temp.stock('P19 Queso') <> 300 THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: se esperaban 300 g de queso, hay %', pg_temp.stock('P19 Queso');
    END IF;
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Queso'), 'merma', 260, 'prueba');
    IF (SELECT stock_suficiente FROM platos WHERE id_plato = v_arepa) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: la arepa debía quedar sin stock';
    END IF;
    IF (SELECT motivo FROM v_carta_disponible WHERE tipo = 'plato' AND id = v_arepa) <> 'stock' THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: motivo debía ser "stock"';
    END IF;
    IF obtener_menu_completo()::TEXT LIKE '%P19 Arepa%' THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: el menú del comensal muestra una arepa sin stock';
    END IF;
    v_fallo := FALSE;
    BEGIN
        v_ped := pg_temp.nuevo_pedido();
        PERFORM pg_temp.agregar(v_ped, v_arepa, 1);
    EXCEPTION WHEN SQLSTATE 'SD001' THEN
        v_fallo := TRUE;
        GET STACKED DIAGNOSTICS v_detalle = PG_EXCEPTION_DETAIL;
    END;
    IF NOT v_fallo OR (v_detalle::JSONB->'faltantes'->0->>'insumo') <> 'P19 Queso' THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: pedir sin stock debía dar SD001 al insertar (detalle %)', v_detalle;
    END IF;
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Queso'), 'entrada', 200, 'reposición');
    IF NOT (SELECT stock_suficiente FROM platos WHERE id_plato = v_arepa) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 9: con la entrada la arepa debía volver';
    END IF;
    RAISE NOTICE 'Caso 9 OK: stock_suficiente se apaga y se enciende solo; SD001 al insertar';

    -- ---------------------------------------------------------------- 10
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Arroz g'), 'ajuste', -pg_temp.stock('P19 Arroz g'), 'prueba');
    IF NOT (SELECT stock_suficiente FROM platos WHERE id_plato = v_bowl) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 10: con quinoa todavía, el bowl tiene opciones';
    END IF;
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Quinoa g'), 'merma', 1, 'prueba');
    IF (SELECT stock_suficiente FROM platos WHERE id_plato = v_bowl) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 10: sin opciones en el paso obligatorio el bowl debía quedar sin stock';
    END IF;
    RAISE NOTICE 'Caso 10 OK: paso obligatorio sin opciones deja el plato sin stock';

    -- ---------------------------------------------------------------- 11
    UPDATE platos SET disponible = FALSE WHERE id_plato = v_arepa;
    v_estado := NULL;
    BEGIN
        v_ped := pg_temp.nuevo_pedido();
        PERFORM pg_temp.agregar(v_ped, v_arepa, 1);
    EXCEPTION WHEN OTHERS THEN
        v_estado := SQLSTATE;
    END;
    IF v_estado IS NULL OR v_estado = 'SD001' THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 11: apagado a mano debía dar el error de siempre (dio %)', v_estado;
    END IF;
    UPDATE platos SET disponible = TRUE WHERE id_plato = v_arepa;
    RAISE NOTICE 'Caso 11 OK: interruptor manual con stock da su error de siempre (SQLSTATE %)', v_estado;

    -- ---------------------------------------------------------------- 12
    v_fallo := FALSE;
    BEGIN
        PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Masa'), 'merma', 1000, 'prueba');
    EXCEPTION WHEN SQLSTATE 'SD002' THEN
        v_fallo := TRUE;
        GET STACKED DIAGNOSTICS v_detalle = PG_EXCEPTION_DETAIL;
    END;
    IF NOT v_fallo OR (v_detalle::JSONB->>'stock_actual')::NUMERIC <> pg_temp.stock('P19 Masa') THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 12: dejar el stock negativo debía dar SD002 con el stock actual (%)', v_detalle;
    END IF;
    RAISE NOTICE 'Caso 12 OK: SD002 con DETAIL %', v_detalle;

    -- ---------------------------------------------------------------- 13
    PERFORM registrar_movimiento_inventario(pg_temp.id_insumo('P19 Queso'), 'merma', pg_temp.stock('P19 Queso') - 90, 'prueba');
    IF NOT EXISTS (SELECT 1 FROM v_stock_bajo WHERE nombre = 'P19 Queso') THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 13: el queso bajo el mínimo no aparece en v_stock_bajo';
    END IF;
    IF EXISTS (
        SELECT 1 FROM insumos s
        WHERE s.nombre LIKE 'P19 %'
          AND s.stock_actual <> (SELECT COALESCE(SUM(m.cantidad), 0) FROM movimientos_inventario m WHERE m.id_insumo = s.id_insumo)
    ) THEN
        RAISE EXCEPTION 'FALLÓ P-19 caso 13: el libro no cuadra (SUM(movimientos) <> stock_actual)';
    END IF;
    RAISE NOTICE 'Caso 13 OK: v_stock_bajo y libro cuadrado';

    RAISE NOTICE '=== PRUEBA P-19 PASADA SATISFACTORIAMENTE ===';
END;
$$;

ROLLBACK;
