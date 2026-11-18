-- ==============================================================================
-- PRUEBA REPRODUCIBLE: espacios Unicode en el contacto del local (script 34)
-- ARCHIVO: database/tests/test_34_contacto_espacios_unicode.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Usa la fila única de
-- configuracion_restaurante (id = 1, la crea el script 26). Correr desde
-- database/tests (usa \ir).
--
-- CASOS:
--  1. redes con U+00A0, U+2003, U+3000 o U+FEFF → inválidas. SIN el script 34
--     la base las acepta en postgres:16-alpine (esta prueba falla).
--  2. correo con U+00A0 o U+2003 → el CHECK lo rechaza.
--  3. Lo de antes no cambia: URL y E.164 válidos pasan; espacio ASCII y
--     tabulador se siguen rechazando; U+200B (que \s de JavaScript tampoco
--     cuenta como espacio) no cambia de veredicto.
--  4. Los dos CHECK quedan validados (convalidated).
--  5. Datos viejos: si una fila ya tiene un espacio Unicode, volver a correr el
--     script NO falla: deja el CHECK NOT VALID (y avisa); al corregir el dato y
--     correrlo otra vez, queda validado.
-- ==============================================================================

BEGIN;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.red(p_clave TEXT, p_valor TEXT) RETURNS BOOLEAN AS $$
    SELECT fn_redes_contacto_validas(jsonb_build_object(p_clave, p_valor))
$$ LANGUAGE sql;

-- TRUE si guardar ese correo en la fila 1 lo rechaza un CHECK
CREATE FUNCTION pg_temp.correo_rechazado(p_correo TEXT) RETURNS BOOLEAN AS $$
BEGIN
    BEGIN
        UPDATE configuracion_restaurante SET correo = p_correo WHERE id = 1;
        RAISE EXCEPTION 'deshacer' USING ERRCODE = 'P0001';
    EXCEPTION
        WHEN check_violation THEN RETURN TRUE;
        WHEN raise_exception THEN RETURN FALSE;
    END;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.validado(p_nombre TEXT) RETURNS BOOLEAN AS $$
    SELECT convalidated FROM pg_constraint
     WHERE conrelid = 'configuracion_restaurante'::regclass AND conname = p_nombre
$$ LANGUAGE sql;

SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM configuracion_restaurante WHERE id = 1), 'preparación: existe la fila única de configuración');

-- 1. redes con espacios Unicode
SELECT pg_temp.exigir(NOT pg_temp.red('instagram', E'https://instagram.com/smart dining'),
    'caso 1: instagram con U+00A0 → inválida (sin el script 34 la base la acepta)');
SELECT pg_temp.exigir(NOT pg_temp.red('facebook', E'https://facebook.com/smart dining'), 'caso 1: facebook con U+2003 → inválida');
SELECT pg_temp.exigir(NOT pg_temp.red('tiktok', E'https://tiktok.com/@smart　dining'), 'caso 1: tiktok con U+3000 → inválida');
SELECT pg_temp.exigir(NOT pg_temp.red('whatsapp', E'﻿+573001234567'), 'caso 1: whatsapp con U+FEFF → inválido');

-- 2. correo con espacios Unicode
SELECT pg_temp.exigir(pg_temp.correo_rechazado(E'hola x@smartdining.co'), 'caso 2: correo con U+00A0 → lo rechaza el CHECK');
SELECT pg_temp.exigir(pg_temp.correo_rechazado(E'hola@smart dining.co'), 'caso 2: correo con U+2003 → lo rechaza el CHECK');

-- 3. lo de antes no cambia
SELECT pg_temp.exigir(pg_temp.red('instagram', 'https://instagram.com/smartdining')
                  AND pg_temp.red('facebook', 'https://fb.com/smartdining')
                  AND pg_temp.red('tiktok', 'https://tiktok.com/@smartdining')
                  AND pg_temp.red('whatsapp', '+573001234567'),
    'caso 3: URL y E.164 válidos siguen pasando');
SELECT pg_temp.exigir(NOT pg_temp.red('instagram', 'https://instagram.com/smart dining')
                  AND NOT pg_temp.red('instagram', E'https://instagram.com/smart\tdining'),
    'caso 3: espacio ASCII y tabulador se siguen rechazando');
SELECT pg_temp.exigir(pg_temp.red('instagram', E'https://instagram.com/smart​dining'),
    'caso 3: U+200B (no es \s en JavaScript) sigue igual que antes');
SELECT pg_temp.exigir(NOT pg_temp.correo_rechazado('hola@smartdining.co') AND pg_temp.correo_rechazado('hola mundo@smartdining.co'),
    'caso 3: correo normal pasa y con espacio ASCII se rechaza');

-- 4. CHECKs validados
SELECT pg_temp.exigir(pg_temp.validado('ck_configuracion_correo') AND pg_temp.validado('ck_configuracion_redes'),
    'caso 4: ck_configuracion_correo y ck_configuracion_redes quedan validados');

-- 5. datos viejos con un espacio Unicode: el script no falla, deja NOT VALID
ALTER TABLE configuracion_restaurante DROP CONSTRAINT ck_configuracion_correo;
UPDATE configuracion_restaurante SET correo = E'viejo x@smartdining.co' WHERE id = 1;
\ir ../scripts/34_contacto_espacios_unicode.sql
SELECT pg_temp.exigir(NOT pg_temp.validado('ck_configuracion_correo'),
    'caso 5: con un correo viejo con U+00A0, el script no falla y deja el CHECK NOT VALID');
SELECT pg_temp.exigir(pg_temp.correo_rechazado(E'nuevo x@smartdining.co'),
    'caso 5: aun NOT VALID, una escritura nueva con U+00A0 se rechaza');
UPDATE configuracion_restaurante SET correo = 'hola@smartdining.co' WHERE id = 1;
\ir ../scripts/34_contacto_espacios_unicode.sql
SELECT pg_temp.exigir(pg_temp.validado('ck_configuracion_correo') AND pg_temp.validado('ck_configuracion_redes'),
    'caso 5: corregido el dato y corrido otra vez, los CHECK quedan validados (idempotente)');

ROLLBACK;
