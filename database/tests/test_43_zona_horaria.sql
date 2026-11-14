-- ==============================================================================
-- PRUEBA REPRODUCIBLE: zona horaria de la base y columnas de fecha (script 43)
-- ARCHIVO: database/tests/test_43_zona_horaria.sql
-- ==============================================================================
-- Solo lectura: no crea ni cambia nada. La corre también el CI (job
-- "backend · integración") después de migrar.sh, así que una columna de fecha
-- nueva que no sea TIMESTAMPTZ rompe el CI.
--
-- CASOS:
--  1. La base tiene America/Bogota como zona por defecto (pg_db_role_setting).
--  2. Una sesión NUEVA la toma: reconecta (\connect) y mira TimeZone.
--  3. Ninguna columna de una tabla de public es TIMESTAMP sin zona, DATE ni
--     TIME: un "timestamp" sin zona guarda la hora de pared de quien insertó y
--     se corre de día según la sesión; las fechas van siempre como TIMESTAMPTZ
--     y el día se calcula con AT TIME ZONE 'America/Bogota'.
--  4. Con la zona de la base, el día de Bogotá y el de la sesión coinciden
--     (now()::date = (now() AT TIME ZONE 'America/Bogota')::date).
-- ==============================================================================

\set ON_ERROR_STOP 1

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT COALESCE(p_ok, FALSE) THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

-- 1. El ajuste está guardado en la base (no en el rol ni en postgresql.conf).
SELECT pg_temp.exigir(
    EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase
             WHERE d.datname = current_database() AND s.setrole = 0
               AND EXISTS (SELECT 1 FROM unnest(s.setconfig) AS x(ajuste)
                            WHERE lower(x.ajuste) = 'timezone=america/bogota')),
    '1. la base actual tiene timezone = America/Bogota (ALTER DATABASE)');

-- 2. Una sesión nueva lo toma. \connect sin argumentos reabre la misma base.
\connect
CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT COALESCE(p_ok, FALSE) THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.exigir(current_setting('TimeZone') = 'America/Bogota',
    '2. una sesión nueva arranca con TimeZone = America/Bogota');

-- 3. Solo TIMESTAMPTZ. El mensaje dice cuáles sobran, para arreglarlas.
DO $$
DECLARE
    v_malas TEXT;
BEGIN
    SELECT string_agg(format('%s.%s (%s)', c.table_name, c.column_name, c.data_type), ', '
                      ORDER BY c.table_name, c.column_name)
      INTO v_malas
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.data_type IN ('timestamp without time zone', 'date',
                           'time without time zone', 'time with time zone');
    IF v_malas IS NOT NULL THEN
        RAISE EXCEPTION 'FALLA: 3. columnas de fecha que no son TIMESTAMPTZ: %', v_malas;
    END IF;
    RAISE NOTICE 'OK   3. todas las columnas de fecha de public son TIMESTAMPTZ';
END
$$;

-- 4. El "hoy" de la sesión es el de Bogotá.
SELECT pg_temp.exigir(now()::date = (now() AT TIME ZONE 'America/Bogota')::date,
    '4. now()::date de una sesión nueva es el día de Bogotá');
