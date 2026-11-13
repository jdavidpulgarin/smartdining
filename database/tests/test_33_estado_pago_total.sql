-- ==============================================================================
-- PRUEBA REPRODUCIBLE: estado_pago al cambiar el total del pedido (script 33)
-- ARCHIVO: database/tests/test_33_estado_pago_total.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. No depende del seed: crea su
-- propia mesa, categoría y plato. Correr desde database/tests (usa \ir).
--
-- CASOS:
--  1. Pedido de 2 líneas de 1000, abono de 1000 → 'parcial'. Se quita una
--     línea (estado_item = 'cancelado'): el total baja a 1000 = lo pagado →
--     'pagado'. SIN el script 33 se queda en 'parcial' (esta prueba falla).
--  2. Se agrega una línea de 500: el total sube a 1500 → vuelve a 'parcial'.
--  3. Pedido sin pagos al que se le quita una línea → sigue 'pendiente'.
--  4. Cambiar el total no toca el estado de cocina (sigue 'recibido').
--  5. Arreglo de datos: un pedido que quedó 'parcial' con el saldo en 0 pasa
--     a 'pagado' al volver a correr el script (y correrlo dos veces no cambia
--     nada más: es idempotente).
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t33 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS INTEGER AS $$ SELECT id FROM t33 WHERE clave = p $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.ep(p TEXT) RETURNS TEXT AS $$
    SELECT estado_pago FROM pedidos WHERE id_pedido = (SELECT id FROM t33 WHERE clave = p)
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_mesa INTEGER; v_cat INTEGER; v_plato INTEGER; v_a INTEGER; v_b INTEGER; v_det INTEGER;
BEGIN
    INSERT INTO mesas (numero, capacidad, ubicacion, estado)
    VALUES (9933, 2, 'T33 prueba', 'disponible') RETURNING id_mesa INTO v_mesa;
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion)
    VALUES ('T33 Prueba', 'prueba', 99) RETURNING id_categoria INTO v_cat;
    INSERT INTO platos (id_categoria, nombre, precio)
    VALUES (v_cat, 'T33 Plato', 1000) RETURNING id_plato INTO v_plato;
    INSERT INTO t33 VALUES ('plato', v_plato);

    -- Pedido A: dos líneas de 1000 y un abono de 1000
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T33A-' || substr(md5(clock_timestamp()::text), 1, 10), 'recibido', 0) RETURNING id_pedido INTO v_a;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_a, v_plato, 1, 1000, 1000);
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_a, v_plato, 1, 1000, 1000) RETURNING id_detalle INTO v_det;
    INSERT INTO t33 VALUES ('A', v_a), ('A_linea2', v_det);
    INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa)
    VALUES (v_a, 'efectivo', 1000, 'completada', 'test33-' || md5(clock_timestamp()::text));

    -- Pedido B: dos líneas, sin pagos
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T33B-' || substr(md5(clock_timestamp()::text), 1, 10), 'recibido', 0) RETURNING id_pedido INTO v_b;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_b, v_plato, 1, 1000, 1000);
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_b, v_plato, 1, 1000, 1000) RETURNING id_detalle INTO v_det;
    INSERT INTO t33 VALUES ('B', v_b), ('B_linea2', v_det);
END $$;

SELECT pg_temp.exigir((SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('A')) = 2000 AND pg_temp.ep('A') = 'parcial',
    'preparación: pedido A con total 2000 y 1000 pagados → parcial');

-- 1. Quitar una línea: el total queda igual a lo pagado
UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = pg_temp.id('A_linea2');
SELECT pg_temp.exigir((SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('A')) = 1000,
    'caso 1: al quitar la línea el total baja a 1000');
SELECT pg_temp.exigir(pg_temp.ep('A') = 'pagado',
    'caso 1: total = lo pagado → estado_pago pagado (sin el script 33 se queda en parcial)');

-- 2. Agregar una línea: el total vuelve a superar lo pagado
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
VALUES (pg_temp.id('A'), pg_temp.id('plato'), 1, 500, 500);
SELECT pg_temp.exigir((SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('A')) = 1500 AND pg_temp.ep('A') = 'parcial',
    'caso 2: al agregar una línea de 500 el total sube a 1500 → parcial otra vez');

-- 3. Sin pagos
UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = pg_temp.id('B_linea2');
SELECT pg_temp.exigir((SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('B')) = 1000 AND pg_temp.ep('B') = 'pendiente',
    'caso 3: pedido sin pagos al que se le quita una línea → pendiente');

-- 4. El estado de cocina no cambia
SELECT pg_temp.exigir((SELECT bool_and(estado = 'recibido') FROM pedidos WHERE id_pedido IN (pg_temp.id('A'), pg_temp.id('B'))),
    'caso 4: cambiar el total no toca pedidos.estado');

-- 5. Arreglo de datos: dejar A con saldo 0 y forzar 'parcial' como antes del 33
UPDATE detalles_pedido SET estado_item = 'cancelado'
 WHERE id_pedido = pg_temp.id('A') AND subtotal = 500;
UPDATE pedidos SET estado_pago = 'parcial' WHERE id_pedido = pg_temp.id('A');
SELECT pg_temp.exigir(pg_temp.ep('A') = 'parcial', 'caso 5: pedido A forzado a parcial con el saldo en 0 (como antes del 33)');
\ir ../scripts/33_estado_pago_al_cambiar_total.sql
SELECT pg_temp.exigir(pg_temp.ep('A') = 'pagado', 'caso 5: volver a correr el script lo corrige a pagado');
\ir ../scripts/33_estado_pago_al_cambiar_total.sql
SELECT pg_temp.exigir(pg_temp.ep('A') = 'pagado' AND pg_temp.ep('B') = 'pendiente', 'caso 5: correrlo otra vez no cambia nada (idempotente)');
SELECT pg_temp.exigir(NOT EXISTS (
    SELECT 1 FROM pedidos p
      JOIN (SELECT id_pedido, SUM(monto) pagado FROM transacciones WHERE estado_transaccion = 'completada' GROUP BY id_pedido) t
        USING (id_pedido)
     WHERE p.estado_pago = 'parcial' AND p.estado <> 'pagado' AND t.pagado >= p.total AND p.total > 0),
    'ningún pedido de la base queda parcial con el saldo en 0');

ROLLBACK;
