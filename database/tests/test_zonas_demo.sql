-- ==============================================================================
-- PRUEBA REPRODUCIBLE: zonas de entrega para staging y la demo (seed_zonas_demo.sql)
-- ARCHIVO: database/tests/test_zonas_demo.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Carga ella misma el seed
-- (con \ir), así sirve en una base con o sin él. Correr desde database/tests.
-- En staging, si el administrador ya cambió alguna de las tres zonas, el caso 1
-- lo avisa: no es un fallo del seed.
--
-- CASOS:
--  1. Tras cargar el seed, las tres zonas existen, activas, con sus barrios,
--     costo y tiempo. SIN el seed la prueba falla aquí.
--  2. cotizar_zona las encuentra con cualquier escritura del barrio
--     ('getsemani', 'CRESPO', '  el   laguito ') y deja fuera un barrio que no
--     cubren ('Turbaco').
--  3. Cargar el seed otra vez no cambia nada (mismas filas, mismo
--     actualizado_en).
--  4. Una zona editada o desactivada por el administrador (D-20) no se pisa al
--     volver a correrlo.
--  5. Si un barrio ya está en otra zona activa, esa zona se salta sin error y
--     las demás se crean.
--  6. Una zona borrada se vuelve a crear solo si nadie más cubre sus barrios.
-- ==============================================================================

BEGIN;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.huella() RETURNS TEXT AS $$
    SELECT string_agg(format('%s|%s|%s|%s|%s|%s', id_zona, nombre, barrios, costo_envio,
                             tiempo_estimado_min, activa) || '|' || actualizado_en, ';' ORDER BY id_zona)
      FROM zonas_envio
$$ LANGUAGE sql;

-- 1. Las tres zonas
\ir ../seed_zonas_demo.sql
SELECT pg_temp.exigir(
    (SELECT count(*) FROM zonas_envio WHERE activa AND (nombre, barrios, costo_envio, tiempo_estimado_min) IN (
        ('Centro',     ARRAY['Centro Histórico', 'Getsemaní', 'San Diego', 'La Matuna'],  4000::NUMERIC, 25),
        ('Bocagrande', ARRAY['Bocagrande', 'Castillogrande', 'El Laguito', 'Manga'],      6000::NUMERIC, 35),
        ('Norte',      ARRAY['Crespo', 'Marbella', 'El Cabrero', 'Torices'],              7000::NUMERIC, 40))) = 3,
    'caso 1: Centro, Bocagrande y Norte activas con sus barrios, costo y tiempo');

-- 2. Cotizar
SELECT pg_temp.exigir(
    (SELECT nombre FROM cotizar_zona('getsemani')) = 'Centro'
    AND (SELECT costo_envio FROM cotizar_zona('CRESPO')) = 7000
    AND (SELECT tiempo_estimado_min FROM cotizar_zona('  el   laguito ')) = 35
    AND NOT EXISTS (SELECT 1 FROM cotizar_zona('Turbaco')),
    'caso 2: cotizar_zona encuentra la zona con cualquier escritura y deja fuera Turbaco');

-- 3. Idempotente
CREATE TEMP TABLE tzd ON COMMIT DROP AS SELECT pg_temp.huella() AS h;
\ir ../seed_zonas_demo.sql
SELECT pg_temp.exigir(pg_temp.huella() = (SELECT h FROM tzd),
    'caso 3: correr el script otra vez no cambia ninguna fila');

-- 4. Lo que hizo el administrador no se pisa
UPDATE zonas_envio SET costo_envio = 4500, barrios = ARRAY['Centro Histórico'] WHERE nombre = 'Centro';
UPDATE zonas_envio SET activa = FALSE WHERE nombre = 'Norte';
TRUNCATE tzd; INSERT INTO tzd SELECT pg_temp.huella();
\ir ../seed_zonas_demo.sql
SELECT pg_temp.exigir(pg_temp.huella() = (SELECT h FROM tzd)
                  AND (SELECT costo_envio FROM zonas_envio WHERE nombre = 'Centro') = 4500
                  AND NOT (SELECT activa FROM zonas_envio WHERE nombre = 'Norte'),
    'caso 4: una zona editada o desactivada no vuelve a su valor inicial');

-- 5. Barrio ya cubierto por otra zona activa: se salta esa zona, sin error
DELETE FROM zonas_envio WHERE nombre IN ('Centro', 'Bocagrande', 'Norte');
INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
VALUES ('TZD Isla', ARRAY['manga'], 9000, 50);
\ir ../seed_zonas_demo.sql
SELECT pg_temp.exigir(
    NOT EXISTS (SELECT 1 FROM zonas_envio WHERE nombre = 'Bocagrande')
    AND (SELECT nombre FROM cotizar_zona('Manga')) = 'TZD Isla'
    AND (SELECT count(*) FROM zonas_envio WHERE nombre IN ('Centro', 'Norte') AND activa) = 2,
    'caso 5: Bocagrande se salta porque Manga ya es de otra zona activa; Centro y Norte se crean');

-- 6. Liberado el barrio, la zona borrada vuelve
DELETE FROM zonas_envio WHERE nombre = 'TZD Isla';
\ir ../seed_zonas_demo.sql
SELECT pg_temp.exigir((SELECT nombre FROM cotizar_zona('Manga')) = 'Bocagrande'
                  AND (SELECT count(*) FROM zonas_envio WHERE nombre IN ('Centro', 'Bocagrande', 'Norte')) = 3,
    'caso 6: sin nadie que cubra Manga, Bocagrande se vuelve a crear');

ROLLBACK;
