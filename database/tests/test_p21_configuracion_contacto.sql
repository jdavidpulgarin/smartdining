-- ==============================================================================
-- PRUEBA REPRODUCIBLE: P-21 (correo y redes del local, script 29)
-- ARCHIVO: database/tests/test_p21_configuracion_contacto.sql
-- ==============================================================================
-- COMPORTAMIENTO ESPERADO:
-- 1. Las columnas existen: correo opcional (NULL) y redes '{}' por defecto.
-- 2. Un correo con forma válida entra; NULL también.
-- 3. Un correo sin arroba, con espacios, con dos arrobas o sin dominio se
--    rechaza con 23514 (ck_configuracion_correo).
-- 4. redes con las cuatro claves válidas entra, y con una sola también.
-- 5. redes se rechaza con 23514 (ck_configuracion_redes) si: trae una clave
--    desconocida, no es un objeto, un valor no es texto o es null/vacío, una
--    URL no es https o es de otro dominio, o whatsapp no es E.164.
-- 6. La fila queda como estaba (correo y redes originales).
-- ==============================================================================

DO $$
DECLARE
    v_correo_original VARCHAR(254);
    v_redes_original JSONB;
    v_rechazado BOOLEAN;
    v_caso TEXT;
    v_correos_malos TEXT[] := ARRAY[
        'sin-arroba.com',
        'con espacio@local.co',
        'dos@@local.co',
        'a@b@local.co',
        'sin@dominio',
        'sin@dominio.',
        '@local.co',
        ''
    ];
    v_redes_malas JSONB[] := ARRAY[
        '{"twitter": "https://twitter.com/smart"}',
        '[]',
        '"https://instagram.com/smart"',
        '{"instagram": 123}',
        '{"instagram": null}',
        '{"instagram": ""}',
        '{"instagram": "http://instagram.com/smart"}',
        '{"instagram": "https://instagram.com.evil.co/smart"}',
        '{"instagram": "https://evil.co/instagram.com/smart"}',
        '{"facebook": "https://youtube.com/smart"}',
        '{"facebook": "https://facebook.com/ con espacio"}',
        '{"tiktok": "https://tiktok.com/"}',
        '{"whatsapp": "3001234567"}',
        '{"whatsapp": "+57 300 1234567"}',
        '{"whatsapp": "+0573001234567"}',
        '{"whatsapp": "+12345"}'
    ]::JSONB[];
    v_mala JSONB;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA P-21: correo y redes del local (script 29) ---';

    SELECT correo, redes INTO v_correo_original, v_redes_original
      FROM configuracion_restaurante WHERE id = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-21: no existe la fila de configuracion_restaurante (id = 1).';
    END IF;

    -- CASO 1: columnas y valores por defecto
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'configuracion_restaurante' AND column_name = 'correo'
                      AND is_nullable = 'YES') THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-21: falta la columna correo o no es opcional.';
    END IF;
    IF (SELECT column_default FROM information_schema.columns
         WHERE table_name = 'configuracion_restaurante' AND column_name = 'redes') IS DISTINCT FROM '''{}''::jsonb' THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-21: redes no tiene ''{}'' por defecto.';
    END IF;
    RAISE NOTICE 'Caso 1 OK: correo opcional y redes ''{}'' por defecto';

    -- CASO 2: correo válido y NULL
    UPDATE configuracion_restaurante SET correo = 'contacto@smartdining.com.co' WHERE id = 1;
    UPDATE configuracion_restaurante SET correo = 'reservas.sede-1@local.co' WHERE id = 1;
    UPDATE configuracion_restaurante SET correo = NULL WHERE id = 1;
    RAISE NOTICE 'Caso 2 OK: correos válidos y NULL entran';

    -- CASO 3: correos mal formados
    FOREACH v_caso IN ARRAY v_correos_malos LOOP
        v_rechazado := FALSE;
        BEGIN
            UPDATE configuracion_restaurante SET correo = v_caso WHERE id = 1;
        EXCEPTION WHEN check_violation THEN
            v_rechazado := TRUE;
        END;
        IF NOT v_rechazado THEN
            RAISE EXCEPTION 'FALLÓ PRUEBA P-21: el correo "%" debió rechazarse.', v_caso;
        END IF;
    END LOOP;
    RAISE NOTICE 'Caso 3 OK: % correos mal formados rechazados con 23514', array_length(v_correos_malos, 1);

    -- CASO 4: redes válidas
    UPDATE configuracion_restaurante SET redes = '{
        "instagram": "https://www.instagram.com/smartdining",
        "facebook": "https://facebook.com/smartdining",
        "tiktok": "https://www.tiktok.com/@smartdining",
        "whatsapp": "+573001234567"
    }'::jsonb WHERE id = 1;
    UPDATE configuracion_restaurante SET redes = '{"whatsapp": "+573001234567"}'::jsonb WHERE id = 1;
    UPDATE configuracion_restaurante SET redes = '{"facebook": "https://fb.com/smartdining"}'::jsonb WHERE id = 1;
    UPDATE configuracion_restaurante SET redes = '{}'::jsonb WHERE id = 1;
    RAISE NOTICE 'Caso 4 OK: las cuatro redes, una sola y ninguna entran';

    -- CASO 5: redes mal formadas
    FOREACH v_mala IN ARRAY v_redes_malas LOOP
        v_rechazado := FALSE;
        BEGIN
            UPDATE configuracion_restaurante SET redes = v_mala WHERE id = 1;
        EXCEPTION WHEN check_violation THEN
            v_rechazado := TRUE;
        END;
        IF NOT v_rechazado THEN
            RAISE EXCEPTION 'FALLÓ PRUEBA P-21: redes % debió rechazarse.', v_mala;
        END IF;
    END LOOP;
    v_rechazado := FALSE;
    BEGIN
        UPDATE configuracion_restaurante SET redes = NULL WHERE id = 1;
    EXCEPTION WHEN not_null_violation OR check_violation THEN
        v_rechazado := TRUE;
    END;
    IF NOT v_rechazado THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-21: redes NULL debió rechazarse.';
    END IF;
    RAISE NOTICE 'Caso 5 OK: % formas de redes inválidas rechazadas (y NULL)', array_length(v_redes_malas, 1);

    -- CASO 6: dejar la fila como estaba
    UPDATE configuracion_restaurante
       SET correo = v_correo_original, redes = v_redes_original
     WHERE id = 1;
    IF (SELECT correo IS NOT DISTINCT FROM v_correo_original AND redes = v_redes_original
          FROM configuracion_restaurante WHERE id = 1) IS NOT TRUE THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-21: la fila no volvió a sus valores originales.';
    END IF;
    RAISE NOTICE 'Caso 6 OK: correo y redes originales restaurados';

    RAISE NOTICE '--- PRUEBA P-21 PASADA ---';
END $$;
