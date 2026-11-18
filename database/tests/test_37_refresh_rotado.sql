-- ==============================================================================
-- PRUEBA REPRODUCIBLE: rotado_en de refresh_tokens_cliente (script 37)
-- ARCHIVO: database/tests/test_37_refresh_rotado.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Crea su propio cliente.
-- Correr desde database/tests (usa \ir).
--
-- CASOS:
--  1. La columna existe (TIMESTAMPTZ, admite NULL). SIN el script 37 la prueba
--     falla aquí.
--  2. Token nuevo: sin rotado_en ni reemplazado_por.
--  3. Rotación normal (contrato de #199): nuevo con la misma familia; el viejo
--     con reemplazado_por y rotado_en; revocado_en sigue NULL.
--  4. CHECK pareja: rotado_en sin reemplazado_por, o al revés → rechazado.
--  5. Gracia: cambiar reemplazado_por a otro token de la familia se puede y
--     rotado_en NO se mueve; intentar moverlo o volverlo NULL → rechazado.
--  6. El reemplazo de otra familia u otro cliente → rechazado; a sí mismo → rechazado.
--  7. rotado_en anterior a creado_en → rechazado.
--  8. Reuso: revocar toda la familia no choca con las reglas.
--  9. Correr el script otra vez no cambia nada (idempotente).
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t37 (clave TEXT PRIMARY KEY, id BIGINT) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.rechaza(p_sql TEXT) RETURNS BOOLEAN AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'deshacer' USING ERRCODE = 'T3700';
    EXCEPTION
        WHEN SQLSTATE 'T3700' THEN RETURN FALSE;
        WHEN OTHERS THEN RETURN TRUE;
    END;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS BIGINT AS $$ SELECT id FROM t37 WHERE clave = p $$ LANGUAGE sql;

-- Un token del cliente p_cliente y la familia p_familia; hash a partir de la clave.
CREATE FUNCTION pg_temp.token(p_clave TEXT, p_cliente TEXT, p_familia UUID) RETURNS BIGINT AS $$
DECLARE v BIGINT;
BEGIN
    INSERT INTO refresh_tokens_cliente (id_cliente, hash, familia, expira_en)
    VALUES ((SELECT id FROM t37 WHERE clave = p_cliente), encode(digest('T37' || p_clave, 'sha256'), 'hex'),
            p_familia, now() + interval '30 days')
    RETURNING id INTO v;
    INSERT INTO t37 VALUES (p_clave, v);
    RETURN v;
END;
$$ LANGUAGE plpgsql;

WITH c AS (
    INSERT INTO clientes (nombre, email, password_hash)
    VALUES ('T37 Ana', 't37.ana@correo.co', '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345'),
           ('T37 Luis', 't37.luis@correo.co', '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345')
    RETURNING id_cliente, nombre)
INSERT INTO t37 SELECT CASE nombre WHEN 'T37 Ana' THEN 'ana' ELSE 'luis' END, id_cliente FROM c;

-- 1. La columna
SELECT pg_temp.exigir(EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'refresh_tokens_cliente' AND column_name = 'rotado_en'
       AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'),
    'caso 1: refresh_tokens_cliente.rotado_en existe (TIMESTAMPTZ, admite NULL)');

-- 2. Token nuevo
SELECT pg_temp.token('t1', 'ana', '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.exigir((SELECT rotado_en IS NULL AND reemplazado_por IS NULL AND revocado_en IS NULL
                         FROM refresh_tokens_cliente WHERE id = pg_temp.id('t1')),
    'caso 2: un token nuevo no está rotado, reemplazado ni revocado');

-- 3. Rotación normal
SELECT pg_temp.token('t2', 'ana', '00000000-0000-4000-8000-000000000001');
UPDATE refresh_tokens_cliente SET reemplazado_por = pg_temp.id('t2'), rotado_en = now() WHERE id = pg_temp.id('t1');
SELECT pg_temp.exigir((SELECT reemplazado_por = pg_temp.id('t2') AND rotado_en IS NOT NULL AND revocado_en IS NULL
                         FROM refresh_tokens_cliente WHERE id = pg_temp.id('t1')),
    'caso 3: rotación normal: reemplazado_por y rotado_en puestos, revocado_en sigue NULL');

-- 4. Pareja rotado_en / reemplazado_por
SELECT pg_temp.token('t3', 'ana', '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE refresh_tokens_cliente SET rotado_en = now() WHERE id = %s', pg_temp.id('t3'))),
    'caso 4: rotado_en sin reemplazado_por → rechazado');
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE refresh_tokens_cliente SET reemplazado_por = %s WHERE id = %s', pg_temp.id('t2'), pg_temp.id('t3'))),
    'caso 4: reemplazado_por sin rotado_en → rechazado');

-- 5. Gracia: el reemplazo cambia, rotado_en no
CREATE TEMP TABLE t37_antes ON COMMIT DROP AS
    SELECT rotado_en FROM refresh_tokens_cliente WHERE id = pg_temp.id('t1');
UPDATE refresh_tokens_cliente SET reemplazado_por = pg_temp.id('t3') WHERE id = pg_temp.id('t1');
SELECT pg_temp.exigir((SELECT r.reemplazado_por = pg_temp.id('t3') AND r.rotado_en = a.rotado_en
                         FROM refresh_tokens_cliente r, t37_antes a WHERE r.id = pg_temp.id('t1')),
    'caso 5: la gracia cambia reemplazado_por y rotado_en no se mueve');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET rotado_en = rotado_en + interval ''1 minute'' WHERE id = %s', pg_temp.id('t1'))),
    'caso 5: mover rotado_en (alargar la ventana) → rechazado');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET rotado_en = NULL, reemplazado_por = NULL WHERE id = %s', pg_temp.id('t1'))),
    'caso 5: deshacer la rotación (rotado_en a NULL) → rechazado');

-- 6. El reemplazo: misma familia y mismo cliente; nunca a sí mismo
SELECT pg_temp.token('otra_familia', 'ana', '00000000-0000-4000-8000-000000000002');
SELECT pg_temp.token('de_luis', 'luis', '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.token('t4', 'ana', '00000000-0000-4000-8000-000000000001');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET reemplazado_por = %s, rotado_en = now() WHERE id = %s', pg_temp.id('otra_familia'), pg_temp.id('t4'))),
    'caso 6: reemplazo de otra familia → rechazado');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET reemplazado_por = %s, rotado_en = now() WHERE id = %s', pg_temp.id('de_luis'), pg_temp.id('t4'))),
    'caso 6: reemplazo de otro cliente (misma familia) → rechazado');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET reemplazado_por = id, rotado_en = now() WHERE id = %s', pg_temp.id('t4'))),
    'caso 6: un token reemplazado por sí mismo → rechazado');

-- 7. rotado_en no antes de creado_en
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'UPDATE refresh_tokens_cliente SET reemplazado_por = %s, rotado_en = creado_en - interval ''1 second'' WHERE id = %s',
    pg_temp.id('t2'), pg_temp.id('t4'))),
    'caso 7: rotado_en anterior a creado_en → rechazado');

-- 8. Reuso: se revoca toda la familia
UPDATE refresh_tokens_cliente SET revocado_en = now()
 WHERE familia = '00000000-0000-4000-8000-000000000001' AND revocado_en IS NULL
   AND id_cliente = (SELECT id FROM t37 WHERE clave = 'ana');
SELECT pg_temp.exigir((SELECT count(*) FROM refresh_tokens_cliente
                        WHERE familia = '00000000-0000-4000-8000-000000000001'
                          AND id_cliente = (SELECT id FROM t37 WHERE clave = 'ana') AND revocado_en IS NULL) = 0,
    'caso 8: el reuso revoca toda la familia sin chocar con las reglas');

-- 9. Idempotente
\ir ../scripts/37_refresh_rotado_en.sql
SELECT pg_temp.exigir((SELECT r.rotado_en = a.rotado_en FROM refresh_tokens_cliente r, t37_antes a WHERE r.id = pg_temp.id('t1'))
                  AND (SELECT count(*) FROM pg_constraint
                        WHERE conname IN ('ck_refresh_rotado', 'ck_refresh_rotado_tras_creado', 'ck_refresh_no_se_reemplaza_a_si_mismo')
                          AND convalidated) = 3
                  AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_refresh_rotacion' AND NOT tgisinternal) = 1,
    'caso 9: correr el script otra vez no cambia los datos; CHECK validados y un solo trigger');

ROLLBACK;
