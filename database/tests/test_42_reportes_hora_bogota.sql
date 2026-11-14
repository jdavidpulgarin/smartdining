-- ==============================================================================
-- PRUEBA REPRODUCIBLE: vistas de reportes en hora de Bogotá (script 42, T6)
-- ARCHIVO: database/tests/test_42_reportes_hora_bogota.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Usa días del 2031 (sin
-- otros datos) y su propia mesa (942). La sesión va en UTC, como Docker.
-- Correr desde database/tests (usa \ir).
--
-- CASOS:
--  1. Pedido a las 8:30 p. m. de Bogotá (1:30 a. m. UTC del día siguiente):
--     cuenta en SU día de Bogotá. SIN el script 42 la prueba falla aquí (caía
--     en el día siguiente y «hoy» no lo veía).
--  2. La zona de la sesión no importa (Asia/Tokyo da lo mismo).
--  3. Un pago hecho al día siguiente cuenta en el día del PAGO, no en el del
--     pedido; un día con pagos y sin pedidos nuevos también sale.
--  4. Cuadre: total_recaudado de un día = suma de transacciones completadas
--     de ese día de Bogotá (lo que suman «Recaudado hoy» y los métodos).
--  5. Pago de un pedido que después se cancela: la plata recibida sigue en
--     total_recaudado (como en «Recaudado hoy»); el pedido no cuenta.
--  6. Una línea cancelada no cuenta en total_items_vendidos ni en v_platos_top.
--  7. v_tiempos_kds por el día de Bogotá.
--  8. Las columnas y tipos de las vistas no cambiaron (el backend las lee).
--  9. Correr el script otra vez no cambia nada (idempotente).
-- ==============================================================================

BEGIN;
SET LOCAL TIME ZONE 'UTC';

CREATE TEMP TABLE t42 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT COALESCE(p_ok, FALSE) THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS INTEGER AS $$ SELECT id FROM t42 WHERE clave = p $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.bog(p TEXT) RETURNS TIMESTAMPTZ AS $$ SELECT p::timestamp AT TIME ZONE 'America/Bogota' $$ LANGUAGE sql;
-- Fila de un día de v_ventas_diarias. No devuelve el tipo de la vista (el caso 9
-- vuelve a crearla y una función atada a su tipo lo impediría).
CREATE FUNCTION pg_temp.dia(p DATE) RETURNS TABLE (total_pedidos BIGINT, total_recaudado NUMERIC, total_items_vendidos NUMERIC) AS $$
    SELECT total_pedidos, total_recaudado, total_items_vendidos FROM v_ventas_diarias WHERE fecha = p
$$ LANGUAGE sql;

-- Columnas y tipos de antes (script 24), para el caso 8.
CREATE TEMP TABLE t42_cols ON COMMIT DROP AS
SELECT table_name::text, ordinal_position, column_name::text, data_type::text
FROM information_schema.columns
WHERE table_name IN ('v_ventas_diarias', 'v_platos_top', 'v_ingredientes_top', 'v_tiempos_kds');

-- Escenario ---------------------------------------------------------------------
INSERT INTO t42 SELECT 'plato', id_plato FROM platos ORDER BY id_plato LIMIT 1;
WITH m AS (
    INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
    VALUES (942, 4, 'terraza', 'ocupada', pg_temp.bog('2031-03-10 19:00'))
    RETURNING id_mesa
)
INSERT INTO t42 SELECT 'mesa', id_mesa FROM m;

-- Pedido A: 2031-03-10 20:30 de Bogotá, dos líneas (2 + 1 unidades).
WITH p AS (
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, creado_en)
    VALUES (pg_temp.id('mesa'), 'T42-A', 'entregado', pg_temp.bog('2031-03-10 20:30'))
    RETURNING id_pedido
)
INSERT INTO t42 SELECT 'A', id_pedido FROM p;
WITH d AS (
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (pg_temp.id('A'), pg_temp.id('plato'), 2, 10000, 20000, 'Ana') RETURNING id_detalle
)
INSERT INTO t42 SELECT 'A_doble', id_detalle FROM d;
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
VALUES (pg_temp.id('A'), pg_temp.id('plato'), 1, 10000, 10000, 'Beto');

-- 1. El día de Bogotá -------------------------------------------------------------
SELECT pg_temp.exigir((SELECT total_pedidos FROM pg_temp.dia('2031-03-10')) = 1,
    '1. pedido de las 8:30 p. m. de Bogotá cuenta el 10 (no el 11 de UTC)');
SELECT pg_temp.exigir(COALESCE((SELECT total_pedidos FROM pg_temp.dia('2031-03-11')), 0) = 0,
    '1. el 11 no tiene ese pedido');
SELECT pg_temp.exigir((SELECT total_items_vendidos FROM pg_temp.dia('2031-03-10')) = 3, '1. 3 ítems el 10');

-- 2. La zona de la sesión no importa ----------------------------------------------
SET LOCAL TIME ZONE 'Asia/Tokyo';
SELECT pg_temp.exigir((SELECT total_pedidos FROM pg_temp.dia('2031-03-10')) = 1, '2. con la sesión en Asia/Tokyo, igual');
SET LOCAL TIME ZONE 'UTC';

-- 3. El pago cuenta en el día del pago --------------------------------------------
INSERT INTO transacciones (id_pedido, monto, metodo_pago, estado_transaccion, comensal, creado_en)
VALUES (pg_temp.id('A'), 12000, 'efectivo', 'completada', 'Ana', pg_temp.bog('2031-03-10 23:30')),
       (pg_temp.id('A'), 18000, 'online', 'completada', 'Beto', pg_temp.bog('2031-03-11 10:00')),
       (pg_temp.id('A'), 99000, 'online', 'fallida', 'Beto', pg_temp.bog('2031-03-11 10:05'));
SELECT pg_temp.exigir((SELECT total_recaudado FROM pg_temp.dia('2031-03-10')) = 12000,
    '3. el 10: 12.000 (pago de las 11:30 p. m., que en UTC ya es el 11)');
SELECT pg_temp.exigir((SELECT total_recaudado FROM pg_temp.dia('2031-03-11')) = 18000 AND (SELECT total_pedidos FROM pg_temp.dia('2031-03-11')) = 0,
    '3. el 11: 18.000 cobrados sin pedidos nuevos (la fila del día sale igual); la fallida no cuenta');

-- 4. Cuadre con las transacciones del día de Bogotá -------------------------------
SELECT pg_temp.exigir(
    (SELECT total_recaudado FROM pg_temp.dia('2031-03-11')) = (
        SELECT SUM(monto) FROM transacciones
        WHERE estado_transaccion = 'completada'
          AND creado_en >= pg_temp.bog('2031-03-11 00:00') AND creado_en < pg_temp.bog('2031-03-12 00:00')),
    '4. total_recaudado del 11 = transacciones completadas del 11 de Bogotá («Recaudado hoy»)');

-- 5. Pago de un pedido que después se cancela -------------------------------------
WITH p AS (
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, creado_en)
    VALUES (pg_temp.id('mesa'), 'T42-B', 'recibido', pg_temp.bog('2031-03-11 12:00'))
    RETURNING id_pedido
)
INSERT INTO t42 SELECT 'B', id_pedido FROM p;
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
VALUES (pg_temp.id('B'), pg_temp.id('plato'), 1, 7000, 7000, 'Caro');
INSERT INTO transacciones (id_pedido, monto, metodo_pago, estado_transaccion, comensal, creado_en)
VALUES (pg_temp.id('B'), 7000, 'efectivo', 'completada', 'Caro', pg_temp.bog('2031-03-11 12:05'));
UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = pg_temp.id('B');
SELECT pg_temp.exigir((SELECT total_recaudado FROM pg_temp.dia('2031-03-11')) = 25000 AND (SELECT total_pedidos FROM pg_temp.dia('2031-03-11')) = 0,
    '5. lo cobrado de un pedido cancelado sigue en lo recaudado (25.000); el pedido no cuenta');

-- 6. Líneas canceladas ------------------------------------------------------------
CREATE TEMP TABLE t42_antes ON COMMIT DROP AS
SELECT unidades_totales_vendidas AS u FROM v_platos_top WHERE id_plato = pg_temp.id('plato');
UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = pg_temp.id('A_doble');
SELECT pg_temp.exigir((SELECT total_items_vendidos FROM pg_temp.dia('2031-03-10')) = 1, '6. sin la línea cancelada: 1 ítem el 10');
SELECT pg_temp.exigir(
    (SELECT unidades_totales_vendidas FROM v_platos_top WHERE id_plato = pg_temp.id('plato')) = (SELECT u FROM t42_antes) - 2,
    '6. v_platos_top baja las 2 unidades de la línea cancelada');

-- 7. v_tiempos_kds -----------------------------------------------------------------
INSERT INTO kds_metricas (id_pedido, id_plato, tiempo_preparacion_real, tiempo_preparacion_estimado, variacion_porcentaje, fecha_metrica)
VALUES (pg_temp.id('A'), pg_temp.id('plato'), 12, 10, 20, pg_temp.bog('2031-03-10 21:00'));
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM v_tiempos_kds WHERE fecha = '2031-03-10' AND platos_preparados = 1)
    AND NOT EXISTS (SELECT 1 FROM v_tiempos_kds WHERE fecha = '2031-03-11'),
    '7. v_tiempos_kds: la comanda de las 9 p. m. cuenta el 10');

-- 8. Mismas columnas y tipos -------------------------------------------------------
\ir ../scripts/42_reportes_hora_bogota.sql
SELECT pg_temp.exigir(NOT EXISTS (
    (SELECT table_name::text, ordinal_position, column_name::text, data_type::text FROM information_schema.columns
      WHERE table_name IN ('v_ventas_diarias', 'v_platos_top', 'v_ingredientes_top', 'v_tiempos_kds')
     EXCEPT SELECT * FROM t42_cols)
    UNION ALL
    (SELECT * FROM t42_cols EXCEPT
     SELECT table_name::text, ordinal_position, column_name::text, data_type::text FROM information_schema.columns
      WHERE table_name IN ('v_ventas_diarias', 'v_platos_top', 'v_ingredientes_top', 'v_tiempos_kds'))),
    '8. las cuatro vistas conservan sus columnas y tipos');

-- 9. Idempotente (el \ir de arriba lo corrió otra vez) ------------------------------
SELECT pg_temp.exigir((SELECT total_recaudado FROM pg_temp.dia('2031-03-10')) = 12000 AND (SELECT total_recaudado FROM pg_temp.dia('2031-03-11')) = 25000,
    '9. correr el script 42 otra vez no cambia el resultado');

ROLLBACK;
