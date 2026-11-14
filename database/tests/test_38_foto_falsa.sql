-- ==============================================================================
-- PRUEBA REPRODUCIBLE: platos con la foto falsa del panel (script 38)
-- ARCHIVO: database/tests/test_38_foto_falsa.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Crea su propia categoría y
-- sus platos. Correr desde database/tests (usa \ir).
--
-- CASOS:
--  1. Un plato con EXACTAMENTE la foto falsa del panel queda en NULL. SIN el
--     script 38 la prueba falla aquí.
--  2. La misma foto con otros parámetros (la del Bowl de la semilla), otra foto
--     de Unsplash, una ruta /imagenes/<uuid>.webp y un plato sin foto: no cambian.
--  3. Casi iguales (mayúsculas, un espacio de más, otro ancho): no se tocan.
--  4. Las fotos de la semilla siguen igual (el Bowl 1001, si está cargado).
--  5. El cambio queda en la auditoría de platos.
--  6. Correr el script otra vez no cambia nada (idempotente).
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t38 (clave TEXT PRIMARY KEY, id INTEGER, url TEXT) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.url(p TEXT) RETURNS TEXT AS $$
    SELECT url_imagen FROM platos WHERE id_plato = (SELECT id FROM t38 WHERE clave = p)
$$ LANGUAGE sql;

-- Lo que había antes en el Bowl de la semilla (si la base tiene la semilla).
INSERT INTO t38 SELECT 'bowl_semilla', id_plato, url_imagen FROM platos WHERE id_plato = 1001;

WITH c AS (
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion)
    VALUES ('T38 Prueba', 'categoría de la prueba del script 38', 97) RETURNING id_categoria
), datos (clave, url) AS (VALUES
    ('falsa',        'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'),
    ('bowl',         'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80&auto=format'),
    ('otra',         'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80&auto=format'),
    ('propia',       '/imagenes/3f2b8c1e-9a4d-4e6b-8f1a-2c3d4e5f6a7b.webp'),
    ('sin_foto',     NULL),
    ('mayusculas',   'HTTPS://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80'),
    ('con_espacio',  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80 '),
    ('otro_ancho',   'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80')
), p AS (
    INSERT INTO platos (id_categoria, nombre, precio, url_imagen)
    SELECT c.id_categoria, 'T38 ' || d.clave, 1000, d.url FROM c, datos d
    RETURNING id_plato, nombre, url_imagen
)
INSERT INTO t38 SELECT substr(nombre, 5), id_plato, url_imagen FROM p;

\ir ../scripts/38_platos_sin_foto_falsa.sql

-- 1. La foto falsa
SELECT pg_temp.exigir(pg_temp.url('falsa') IS NULL,
    'caso 1: el plato con exactamente la foto falsa del panel quedó sin foto (NULL)');

-- 2 y 3. Lo demás no cambia
SELECT pg_temp.exigir(NOT EXISTS (
    SELECT 1 FROM t38
     WHERE clave IN ('bowl', 'otra', 'propia', 'sin_foto', 'mayusculas', 'con_espacio', 'otro_ancho')
       AND pg_temp.url(clave) IS DISTINCT FROM url),
    'casos 2 y 3: la misma foto con otros parámetros, otra foto, /imagenes/, sin foto y los casi iguales no cambian');

-- 4. La semilla
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM t38 WHERE clave = 'bowl_semilla')
                   OR (SELECT url_imagen FROM platos WHERE id_plato = 1001)
                      IS NOT DISTINCT FROM (SELECT url FROM t38 WHERE clave = 'bowl_semilla'),
    'caso 4: la foto del Bowl Personalizado de la semilla sigue igual');

-- 5. Auditoría
SELECT pg_temp.exigir(EXISTS (
    SELECT 1 FROM auditoria_cambios
     WHERE tabla_afectada = 'platos' AND operacion = 'UPDATE'
       AND registro_id = (SELECT id FROM t38 WHERE clave = 'falsa')
       AND datos_nuevos ->> 'url_imagen' IS NULL
       AND datos_anteriores ->> 'url_imagen' = (SELECT url FROM t38 WHERE clave = 'falsa')),
    'caso 5: el cambio queda en la auditoría de platos (antes la foto falsa, después NULL)');

-- 6. Idempotente
CREATE TEMP TABLE t38_antes ON COMMIT DROP AS SELECT id_plato, url_imagen FROM platos;
\ir ../scripts/38_platos_sin_foto_falsa.sql
SELECT pg_temp.exigir(NOT EXISTS (
    SELECT 1 FROM platos p JOIN t38_antes a USING (id_plato) WHERE p.url_imagen IS DISTINCT FROM a.url_imagen),
    'caso 6: correr el script otra vez no cambia nada');

ROLLBACK;
