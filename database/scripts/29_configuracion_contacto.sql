-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 29_configuracion_contacto.sql
-- MÓDULO: Administración y configuración (P-21) · contacto del local
-- ==============================================================================
-- Agrega a configuracion_restaurante (script 26) dos datos de contacto para la
-- sección "Nuestro restaurante" del sitio público:
--
--   1. correo  VARCHAR(254), opcional (NULL = no se publica).
--      CHECK sencillo de forma: algo@algo.algo, sin espacios ni dos arrobas.
--      No pretende validar todo RFC 5322; eso lo hace mejor el formulario.
--
--   2. redes   JSONB, siempre un objeto ('{}' = ninguna red). Claves opcionales,
--      y SOLO estas cuatro:
--        instagram  "https://instagram.com/..."  (o www./m. delante del dominio)
--        facebook   "https://facebook.com/..."   (o fb.com)
--        tiktok     "https://tiktok.com/..."
--        whatsapp   "+573001234567"  número en formato E.164: '+', sin espacios,
--                   de 7 a 15 dígitos; el enlace wa.me lo arma el frontend.
--      Cada valor es un texto de hasta 200 caracteres. Una red que no se usa se
--      OMITE (no va con null ni con ""). Lo valida fn_redes_contacto_validas().
--
-- Por qué JSONB y no cuatro columnas: es la misma forma que `horario` y una red
-- nueva no obliga a migrar la tabla, solo a cambiar la función de validación.
--
-- Contrato con el backend (D-16): las columnas existen desde aquí, pero el
-- backend decide qué publica. GET /api/configuracion (lista blanca), el PUT
-- (Zod .strict()) y /configuracion/completa las incluyen cuando el backend se
-- actualice; hasta entonces, mandarlas en el PUT da 400.
--
-- El número 29 queda para este script; el de "menú con agotados" (G-06) será el
-- 30, para no dejar huecos en el orden de migrar.sh.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente: se
-- puede ejecutar dos veces sin error.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Validación de `redes`
-- ------------------------------------------------------------------------------
-- IMMUTABLE porque la usa un CHECK: depende solo de su argumento.
CREATE OR REPLACE FUNCTION fn_redes_contacto_validas(p_redes JSONB)
RETURNS BOOLEAN AS $$
    SELECT p_redes IS NOT NULL
       AND jsonb_typeof(p_redes) = 'object'
       -- solo las claves conocidas
       AND (p_redes - ARRAY['instagram', 'facebook', 'tiktok', 'whatsapp']) = '{}'::jsonb
       -- cada valor presente: texto, sin espacios, de 1 a 200 caracteres
       AND NOT EXISTS (
            SELECT 1
              FROM jsonb_each(p_redes) AS r(clave, valor)
             WHERE jsonb_typeof(r.valor) <> 'string'
                OR char_length(r.valor #>> '{}') NOT BETWEEN 1 AND 200
                OR (r.valor #>> '{}') ~ '[[:space:]]'
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

COMMENT ON FUNCTION fn_redes_contacto_validas(JSONB) IS
    'TRUE si p_redes es un objeto con solo instagram, facebook, tiktok (URL https de su '
    'dominio) y whatsapp (E.164, +57...), todas opcionales. La usa '
    'ck_configuracion_redes (script 29).';

-- ------------------------------------------------------------------------------
-- 2. Columnas
-- ------------------------------------------------------------------------------
ALTER TABLE configuracion_restaurante
    ADD COLUMN IF NOT EXISTS correo VARCHAR(254),
    ADD COLUMN IF NOT EXISTS redes JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Se recrean para que una segunda corrida deje exactamente esta versión.
ALTER TABLE configuracion_restaurante DROP CONSTRAINT IF EXISTS ck_configuracion_correo;
ALTER TABLE configuracion_restaurante
    ADD CONSTRAINT ck_configuracion_correo CHECK (
        correo IS NULL
        OR correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
    );

ALTER TABLE configuracion_restaurante DROP CONSTRAINT IF EXISTS ck_configuracion_redes;
ALTER TABLE configuracion_restaurante
    ADD CONSTRAINT ck_configuracion_redes CHECK (fn_redes_contacto_validas(redes));

-- ------------------------------------------------------------------------------
-- 3. Documentación embebida
-- ------------------------------------------------------------------------------
COMMENT ON COLUMN configuracion_restaurante.correo IS
    'Correo de contacto del local, opcional (NULL = sin correo). CHECK de forma '
    'ck_configuracion_correo (script 29).';
COMMENT ON COLUMN configuracion_restaurante.redes IS
    'Redes del local: objeto con instagram, facebook, tiktok (URL https) y whatsapp '
    '(E.164), todas opcionales; ''{}'' = ninguna. Ver fn_redes_contacto_validas (script 29).';
