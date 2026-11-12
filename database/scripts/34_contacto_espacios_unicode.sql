-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 34_contacto_espacios_unicode.sql
-- MÓDULO: Administración y configuración (P-21) · contacto del local (script 29)
-- ==============================================================================
-- PROBLEMA:
-- El script 29 prohíbe los espacios en `correo` y en cada valor de `redes` con
-- la clase [[:space:]]. Esa clase depende del LC_CTYPE de la base y de la libc:
-- en postgres:16-alpine (desarrollo, staging y producción) solo reconoce los
-- espacios ASCII, así que la base ACEPTABA "smart dining" (espacio duro
-- U+00A0) o "a b@c.co". El backend (zod, #172) usa \s de JavaScript, que sí
-- los rechaza: la base y la API no decían lo mismo.
--
-- ARREGLO:
-- 1. fn_tiene_espacio(texto): la MISMA lista de caracteres que \s de JavaScript,
--    escrita a mano, así no depende del locale:
--      \t \n \v \f \r, espacio, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029,
--      U+202F, U+205F, U+3000 y U+FEFF.
-- 2. fn_redes_contacto_validas y ck_configuracion_correo la usan en lugar de
--    [[:space:]]. Lo demás (claves, dominios, E.164, largos) no cambia.
-- 3. Si una fila ya guardada tuviera uno de esos espacios, el CHECK se crea
--    NOT VALID (las escrituras nuevas sí se validan) y se avisa con WARNING, en
--    vez de detener el despliegue. Si no hay ninguna, se valida completo.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

-- 1. ESPACIOS, IGUAL QUE \s DE JAVASCRIPT
-- IMMUTABLE porque la usan los CHECK: depende solo de su argumento.
CREATE OR REPLACE FUNCTION fn_tiene_espacio(p_texto TEXT)
RETURNS BOOLEAN AS $$
    SELECT p_texto ~ '[\t\n\v\f\r    -     　﻿]'
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION fn_tiene_espacio(TEXT) IS
    'TRUE si el texto tiene algún espacio de los que reconoce \s de JavaScript (ASCII y '
    'Unicode: U+00A0, U+2000-U+200A, U+3000, U+FEFF...). No depende del locale (script 34).';

-- 2a. REDES: misma función del 29, con fn_tiene_espacio
CREATE OR REPLACE FUNCTION fn_redes_contacto_validas(p_redes JSONB)
RETURNS BOOLEAN AS $$
    SELECT p_redes IS NOT NULL
       AND jsonb_typeof(p_redes) = 'object'
       -- solo las claves conocidas
       AND (p_redes - ARRAY['instagram', 'facebook', 'tiktok', 'whatsapp']) = '{}'::jsonb
       -- cada valor presente: texto, sin espacios (tampoco Unicode), de 1 a 200 caracteres
       AND NOT EXISTS (
            SELECT 1
              FROM jsonb_each(p_redes) AS r(clave, valor)
             WHERE jsonb_typeof(r.valor) <> 'string'
                OR char_length(r.valor #>> '{}') NOT BETWEEN 1 AND 200
                OR fn_tiene_espacio(r.valor #>> '{}')
       )
       AND (NOT p_redes ? 'instagram'
            OR (p_redes ->> 'instagram') ~* '^https://([a-z0-9-]+\.)?instagram\.com/[^[:space:]]+$')
       AND (NOT p_redes ? 'facebook'
            OR (p_redes ->> 'facebook') ~* '^https://([a-z0-9-]+\.)?(facebook|fb)\.com/[^[:space:]]+$')
       AND (NOT p_redes ? 'tiktok'
            OR (p_redes ->> 'tiktok') ~* '^https://([a-z0-9-]+\.)?tiktok\.com/[^[:space:]]+$')
       AND (NOT p_redes ? 'whatsapp'
            OR (p_redes ->> 'whatsapp') ~ '^\+[1-9][0-9]{6,14}$');
$$ LANGUAGE sql IMMUTABLE;

-- 2b. CORREO y 3. CHECKs (NOT VALID solo si ya hay datos con esos espacios)
DO $$
DECLARE
    v_malos_correo INTEGER;
    v_malos_redes INTEGER;
BEGIN
    SELECT count(*) INTO v_malos_correo FROM configuracion_restaurante
     WHERE correo IS NOT NULL AND fn_tiene_espacio(correo);
    SELECT count(*) INTO v_malos_redes FROM configuracion_restaurante
     WHERE NOT fn_redes_contacto_validas(redes);

    ALTER TABLE configuracion_restaurante DROP CONSTRAINT IF EXISTS ck_configuracion_correo;
    ALTER TABLE configuracion_restaurante
        ADD CONSTRAINT ck_configuracion_correo CHECK (
            correo IS NULL
            OR (correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
                AND NOT fn_tiene_espacio(correo))
        ) NOT VALID;
    IF v_malos_correo = 0 THEN
        ALTER TABLE configuracion_restaurante VALIDATE CONSTRAINT ck_configuracion_correo;
    ELSE
        RAISE WARNING 'script 34: % fila(s) de configuracion_restaurante tienen un espacio Unicode en correo; ck_configuracion_correo queda NOT VALID hasta corregirlas', v_malos_correo;
    END IF;

    -- ck_configuracion_redes ya llama a fn_redes_contacto_validas (recién
    -- reemplazada): se recrea para que la validación de lo guardado sea explícita.
    ALTER TABLE configuracion_restaurante DROP CONSTRAINT IF EXISTS ck_configuracion_redes;
    ALTER TABLE configuracion_restaurante
        ADD CONSTRAINT ck_configuracion_redes CHECK (fn_redes_contacto_validas(redes)) NOT VALID;
    IF v_malos_redes = 0 THEN
        ALTER TABLE configuracion_restaurante VALIDATE CONSTRAINT ck_configuracion_redes;
    ELSE
        RAISE WARNING 'script 34: % fila(s) de configuracion_restaurante tienen redes que ya no son válidas (espacio Unicode); ck_configuracion_redes queda NOT VALID hasta corregirlas', v_malos_redes;
    END IF;
END $$;

COMMENT ON CONSTRAINT ck_configuracion_correo ON configuracion_restaurante IS
    'Forma algo@algo.algo, sin dos arrobas ni espacios (tampoco Unicode: fn_tiene_espacio). Scripts 29 y 34.';
