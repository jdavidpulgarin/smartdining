-- ==============================================================================
-- PRUEBA REPRODUCIBLE: voucher de tarjeta en transacciones (script 35)
-- ARCHIVO: database/tests/test_35_voucher.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. No depende del seed: crea su
-- propia mesa, categoría, plato y pedido. Correr desde database/tests (usa \ir).
--
-- CASOS:
--  1. La columna existe: VARCHAR(40), admite NULL. SIN el script 35 la prueba
--     falla aquí.
--  2. Con tarjeta débito o crédito se guarda el voucher (AP-94812, 123456, 40
--     caracteres) y también se puede cobrar sin él (NULL: es opcional).
--  3. Con efectivo, transferencia u online, un voucher se rechaza (CHECK).
--  4. Formato: minúsculas, espacios (al inicio, en medio, al final), vacío,
--     41 caracteres, punto o barra → se rechazan.
--  5. Cambiar a efectivo una transacción con voucher → se rechaza.
--  6. La auditoría guarda el voucher en datos_nuevos.
--  7. Correr el script otra vez no cambia nada (idempotente).
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t35 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

-- TRUE si la base rechaza insertar una transacción de 100 con ese método y voucher
CREATE FUNCTION pg_temp.rechazado(p_metodo TEXT, p_voucher TEXT) RETURNS BOOLEAN AS $$
BEGIN
    BEGIN
        INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, voucher)
        VALUES ((SELECT id FROM t35 WHERE clave = 'pedido'), p_metodo, 100, 'completada', p_voucher);
        RAISE EXCEPTION 'deshacer' USING ERRCODE = 'P0001';
    EXCEPTION
        WHEN check_violation THEN RETURN TRUE;
        -- 41 caracteres o más: lo corta el VARCHAR(40) antes que el CHECK
        WHEN string_data_right_truncation THEN RETURN TRUE;
        WHEN raise_exception THEN RETURN FALSE;
    END;
END;
$$ LANGUAGE plpgsql;

-- 1. La columna
SELECT pg_temp.exigir(EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'transacciones' AND column_name = 'voucher'
       AND data_type = 'character varying' AND character_maximum_length = 40 AND is_nullable = 'YES'),
    'caso 1: transacciones.voucher existe, VARCHAR(40), admite NULL (sin el script 35 falla aquí)');

DO $$
DECLARE v_mesa INTEGER; v_cat INTEGER; v_plato INTEGER; v_pedido INTEGER;
BEGIN
    INSERT INTO mesas (numero, capacidad, ubicacion, estado)
    VALUES (9935, 2, 'T35 prueba', 'disponible') RETURNING id_mesa INTO v_mesa;
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion)
    VALUES ('T35 Prueba', 'prueba', 99) RETURNING id_categoria INTO v_cat;
    INSERT INTO platos (id_categoria, nombre, precio)
    VALUES (v_cat, 'T35 Plato', 100000) RETURNING id_plato INTO v_plato;
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
    VALUES (v_mesa, 'T35-' || substr(md5(clock_timestamp()::text), 1, 10), 'recibido', 0) RETURNING id_pedido INTO v_pedido;
    INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
    VALUES (v_pedido, v_plato, 1, 100000, 100000);
    INSERT INTO t35 VALUES ('pedido', v_pedido);
END $$;

-- 2. Tarjeta con y sin voucher
SELECT pg_temp.exigir(NOT pg_temp.rechazado('tarjeta_credito', 'AP-94812')
                  AND NOT pg_temp.rechazado('tarjeta_debito', '123456')
                  AND NOT pg_temp.rechazado('tarjeta_credito', repeat('A', 40)),
    'caso 2: tarjeta débito/crédito con voucher válido (AP-94812, 123456, 40 caracteres) se guarda');
SELECT pg_temp.exigir(NOT pg_temp.rechazado('tarjeta_debito', NULL) AND NOT pg_temp.rechazado('efectivo', NULL),
    'caso 2: sin voucher (NULL) se cobra igual, con tarjeta o en efectivo: es opcional');

-- 3. Otros métodos con voucher
SELECT pg_temp.exigir(pg_temp.rechazado('efectivo', 'AP-94812')
                  AND pg_temp.rechazado('transferencia', 'AP-94812')
                  AND pg_temp.rechazado('online', 'AP-94812'),
    'caso 3: efectivo, transferencia u online con voucher → lo rechaza el CHECK');

-- 4. Formato
SELECT pg_temp.exigir(pg_temp.rechazado('tarjeta_credito', 'ap-94812'), 'caso 4: minúsculas → rechazado (el backend normaliza)');
SELECT pg_temp.exigir(pg_temp.rechazado('tarjeta_credito', ' AP94812')
                  AND pg_temp.rechazado('tarjeta_credito', 'AP 94812')
                  AND pg_temp.rechazado('tarjeta_credito', 'AP94812 '),
    'caso 4: espacios al inicio, en medio o al final → rechazado');
SELECT pg_temp.exigir(pg_temp.rechazado('tarjeta_credito', ''), 'caso 4: vacío → rechazado (sin voucher es NULL)');
SELECT pg_temp.exigir(pg_temp.rechazado('tarjeta_credito', repeat('A', 41)), 'caso 4: 41 caracteres → rechazado');
SELECT pg_temp.exigir(pg_temp.rechazado('tarjeta_credito', 'AP.948') AND pg_temp.rechazado('tarjeta_credito', 'AP/948'),
    'caso 4: punto o barra → rechazado');

-- 5 y 6. Una transacción real con voucher: cambio de método y auditoría
INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, voucher)
VALUES ((SELECT id FROM t35 WHERE clave = 'pedido'), 'tarjeta_credito', 100, 'completada', 'AP-94812');
INSERT INTO t35 SELECT 'tx', max(id_transaccion) FROM transacciones WHERE voucher = 'AP-94812';
DO $$
BEGIN
    BEGIN
        UPDATE transacciones SET metodo_pago = 'efectivo' WHERE id_transaccion = (SELECT id FROM t35 WHERE clave = 'tx');
        RAISE EXCEPTION 'FALLA: caso 5: pasar a efectivo una transacción con voucher no se rechazó';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK   caso 5: pasar a efectivo una transacción con voucher → rechazado';
    END;
END $$;
SELECT pg_temp.exigir(EXISTS (
    SELECT 1 FROM auditoria_cambios
     WHERE tabla_afectada = 'transacciones' AND operacion = 'INSERT'
       AND registro_id = (SELECT id FROM t35 WHERE clave = 'tx')
       AND datos_nuevos ->> 'voucher' = 'AP-94812'),
    'caso 6: la auditoría guarda el voucher en datos_nuevos');

-- 7. Idempotente
\ir ../scripts/35_transacciones_voucher.sql
SELECT pg_temp.exigir((SELECT voucher FROM transacciones WHERE id_transaccion = (SELECT id FROM t35 WHERE clave = 'tx')) = 'AP-94812'
                  AND (SELECT convalidated FROM pg_constraint WHERE conname = 'ck_transacciones_voucher'),
    'caso 7: correr el script otra vez no cambia los datos y el CHECK sigue validado');

ROLLBACK;
