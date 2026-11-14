-- ==============================================================================
-- PRUEBA REPRODUCIBLE: la cuenta de la mesa sin las líneas canceladas (script 41)
-- ARCHIVO: database/tests/test_41_cuenta_sin_lineas_canceladas.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Crea su propia mesa (941).
-- Correr desde database/tests (usa \ir).
--
-- Mesa con un pedido de 3 líneas de 10.000: Ana 2 (una de cantidad 2, otra de 1)
-- y Beto 1. Quitar líneas como lo hace el backend (estado_item = 'cancelado').
--
-- CASOS:
--  1. Antes de quitar: total 40.000, 4 ítems; la cuenta = pedidos.total.
--  2. Quitar la línea de Beto: total y saldo de la mesa 30.000, 3 ítems; Beto
--     sale del desglose; la cuenta sigue igual a pedidos.total. SIN el script
--     41 la prueba falla aquí (la cuenta se queda en 40.000).
--  3. Con un pago de Ana de 5.000 y quitar su línea de cantidad 2: Ana debe
--     5.000 (10.000 − 5.000); la mesa, total 10.000, pagado 5.000, saldo 5.000.
--  4. La cuenta JSON (la que leen la Caja, la PWA y Wompi) dice lo mismo, y su
--     lista de pedidos suma lo mismo que total_mesa.
--  5. Si a Ana le quitan TODO tras pagar, sigue en el desglose con su pago y
--     saldo 0 (no se pierde el pago); la mesa queda en saldo 0.
--  6. Un segundo pedido con líneas vivas suma normal (el filtro es por línea).
--  7. H-02 intacta: con sesion_iniciada_en NULL la cuenta sale vacía.
--  8. Correr el script otra vez no cambia nada (idempotente).
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t41 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT COALESCE(p_ok, FALSE) THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS INTEGER AS $$ SELECT id FROM t41 WHERE clave = p $$ LANGUAGE sql;

-- Fila de un comensal (o 'TOTAL MESA') de obtener_cuenta_mesa().
CREATE FUNCTION pg_temp.fila(p_comensal TEXT)
RETURNS TABLE (items BIGINT, subtotal NUMERIC, pagado NUMERIC, saldo NUMERIC) AS $$
    SELECT c.items_pedidos, c.subtotal, c.pagado, c.saldo
    FROM obtener_cuenta_mesa(pg_temp.id('mesa')) c
    WHERE c.comensal = p_comensal
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.json() RETURNS JSON AS $$ SELECT obtener_cuenta_mesa_json(pg_temp.id('mesa')) $$ LANGUAGE sql;

-- Suma de pedidos.total de la sesión: lo que la cuenta debe decir.
CREATE FUNCTION pg_temp.suma_pedidos() RETURNS NUMERIC AS $$
    SELECT COALESCE(SUM(total), 0) FROM pedidos
    WHERE id_mesa = pg_temp.id('mesa') AND estado <> 'cancelado'
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.quitar(p_linea TEXT) RETURNS VOID AS $$
    UPDATE detalles_pedido SET estado_item = 'cancelado' WHERE id_detalle = pg_temp.id(p_linea)
$$ LANGUAGE sql;

-- Escenario ---------------------------------------------------------------------
INSERT INTO t41
SELECT 'plato', id_plato FROM platos ORDER BY id_plato LIMIT 1;

WITH m AS (
    INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
    VALUES (941, 4, 'terraza', 'ocupada', now() - interval '1 minute')
    RETURNING id_mesa
)
INSERT INTO t41 SELECT 'mesa', id_mesa FROM m;

WITH p AS (
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado)
    VALUES (pg_temp.id('mesa'), 'T41-A', 'recibido')
    RETURNING id_pedido
)
INSERT INTO t41 SELECT 'pedido', id_pedido FROM p;

WITH d AS (
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (pg_temp.id('pedido'), pg_temp.id('plato'), 2, 10000, 20000, 'Ana')
    RETURNING id_detalle
)
INSERT INTO t41 SELECT 'ana_doble', id_detalle FROM d;

WITH d AS (
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (pg_temp.id('pedido'), pg_temp.id('plato'), 1, 10000, 10000, 'Ana')
    RETURNING id_detalle
)
INSERT INTO t41 SELECT 'ana_simple', id_detalle FROM d;

WITH d AS (
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
    VALUES (pg_temp.id('pedido'), pg_temp.id('plato'), 1, 10000, 10000, 'Beto')
    RETURNING id_detalle
)
INSERT INTO t41 SELECT 'beto', id_detalle FROM d;

-- 1. Antes de quitar ------------------------------------------------------------
SELECT pg_temp.exigir((SELECT subtotal = 40000 AND items = 4 AND saldo = 40000 FROM pg_temp.fila('TOTAL MESA')),
    '1. sin quitar nada: total 40.000, 4 ítems, saldo 40.000');
SELECT pg_temp.exigir((SELECT subtotal FROM pg_temp.fila('TOTAL MESA')) = pg_temp.suma_pedidos(),
    '1. la cuenta = suma de pedidos.total');

-- 2. Quitar la línea de Beto ----------------------------------------------------
SELECT pg_temp.quitar('beto');
SELECT pg_temp.exigir((SELECT total = 30000 FROM pedidos WHERE id_pedido = pg_temp.id('pedido')),
    '2. pedidos.total baja a 30.000 (script 08, ya estaba bien)');
SELECT pg_temp.exigir((SELECT subtotal = 30000 AND items = 3 AND saldo = 30000 FROM pg_temp.fila('TOTAL MESA')),
    '2. quitar el plato de Beto: total y saldo de la mesa 30.000, 3 ítems');
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM pg_temp.fila('Beto')),
    '2. Beto (sin consumo ni pago) sale del desglose');
SELECT pg_temp.exigir((SELECT subtotal FROM pg_temp.fila('TOTAL MESA')) = pg_temp.suma_pedidos(),
    '2. la cuenta sigue = suma de pedidos.total');

-- 3. Pago de Ana y quitar su línea doble ----------------------------------------
INSERT INTO transacciones (id_pedido, monto, metodo_pago, estado_transaccion, comensal)
VALUES (pg_temp.id('pedido'), 5000, 'efectivo', 'completada', 'Ana');
SELECT pg_temp.quitar('ana_doble');
SELECT pg_temp.exigir((SELECT subtotal = 10000 AND pagado = 5000 AND saldo = 5000 AND items = 1 FROM pg_temp.fila('Ana')),
    '3. Ana: consumo 10.000, pagó 5.000, debe 5.000');
SELECT pg_temp.exigir((SELECT subtotal = 10000 AND pagado = 5000 AND saldo = 5000 FROM pg_temp.fila('TOTAL MESA')),
    '3. mesa: total 10.000, pagado 5.000, saldo 5.000');

-- 4. La cuenta JSON (Caja, PWA, Wompi) ------------------------------------------
SELECT pg_temp.exigir(
    (pg_temp.json()->>'total_mesa')::numeric = 10000
    AND (pg_temp.json()->>'saldo_mesa')::numeric = 5000
    AND (pg_temp.json()->>'items_totales')::int = 1,
    '4. JSON: total_mesa 10.000, saldo_mesa 5.000, items_totales 1');
SELECT pg_temp.exigir(
    (SELECT SUM((e->>'total')::numeric) FROM json_array_elements(pg_temp.json()->'pedidos') e)
        = (pg_temp.json()->>'total_mesa')::numeric,
    '4. JSON: la lista de pedidos suma lo mismo que total_mesa');
SELECT pg_temp.exigir(
    (SELECT (e->>'saldo')::numeric FROM json_array_elements(pg_temp.json()->'comensales') e WHERE e->>'comensal' = 'Ana') = 5000,
    '4. JSON: el saldo de Ana (lo que cobraría «pagar lo mío») es 5.000');

-- 5. Quitarle todo a Ana tras pagar ---------------------------------------------
-- El backend no deja cancelar una línea si lo pagado supera el total que
-- quedaría (409 pago_registrado), pero la función tiene que ser coherente
-- igual: se prueba directo en la base.
SELECT pg_temp.quitar('ana_simple');
SELECT pg_temp.exigir((SELECT subtotal = 0 AND pagado = 5000 AND saldo = 0 FROM pg_temp.fila('Ana')),
    '5. sin consumo pero con pago: Ana sigue con su pago y saldo 0');
SELECT pg_temp.exigir((SELECT saldo = 0 FROM pg_temp.fila('TOTAL MESA')),
    '5. mesa con saldo 0 (nunca negativo)');

-- 6. Otro pedido con líneas vivas -----------------------------------------------
WITH p AS (
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado)
    VALUES (pg_temp.id('mesa'), 'T41-B', 'recibido')
    RETURNING id_pedido
)
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, comensal)
SELECT id_pedido, pg_temp.id('plato'), 1, 7000, 7000, 'Caro' FROM p;
SELECT pg_temp.exigir((SELECT subtotal = 7000 AND saldo = 7000 FROM pg_temp.fila('Caro')),
    '6. un pedido nuevo con líneas vivas suma normal');
SELECT pg_temp.exigir((SELECT subtotal FROM pg_temp.fila('TOTAL MESA')) = pg_temp.suma_pedidos(),
    '6. la cuenta = suma de pedidos.total con dos pedidos');

-- 7. H-02 intacta ---------------------------------------------------------------
UPDATE mesas SET sesion_iniciada_en = NULL WHERE id_mesa = pg_temp.id('mesa');
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM obtener_cuenta_mesa(pg_temp.id('mesa')))
    AND (pg_temp.json()->>'total_mesa')::numeric = 0,
    '7. sin sesión (H-02): cuenta vacía y total 0');
UPDATE mesas SET sesion_iniciada_en = now() - interval '1 minute' WHERE id_mesa = pg_temp.id('mesa');

-- 8. Idempotente ----------------------------------------------------------------
\ir ../scripts/41_cuenta_sin_lineas_canceladas.sql
SELECT pg_temp.exigir((SELECT subtotal = 7000 AND pagado = 5000 FROM pg_temp.fila('TOTAL MESA')),
    '8. correr el script 41 otra vez no cambia el resultado');

ROLLBACK;
