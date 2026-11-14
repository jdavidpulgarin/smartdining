-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 43_zona_horaria_bogota.sql
-- MÓDULO: Infraestructura · zona horaria de la base (T6)
-- ==============================================================================
-- La base corría con la zona que dejó initdb en el contenedor: UTC. Todo lo que
-- dependía de la zona de la SESIÓN contaba los días en UTC, y desde las 7 p. m.
-- de Bogotá una venta caía en el día siguiente:
--   - las vistas que usan date(col) (#241 las pasa a AT TIME ZONE explícito);
--   - generar_reporte_auditoria() y obtener_metricas_mesa() (col::date BETWEEN);
--   - cualquier consulta a mano (psql, respaldos, soporte) con now()::date.
--
-- Este script deja America/Bogota como zona POR DEFECTO de la base: cada sesión
-- NUEVA la toma (las ya abiertas siguen con la suya hasta reconectar; por eso
-- el despliegue recrea el backend después de migrar, para que su pool y la
-- conexión LISTEN del canal 'inventario' la tomen).
--
-- Qué NO cambia:
--   - Los datos: las 40 columnas de fecha son TIMESTAMPTZ (instantes en UTC por
--     dentro); no hay ninguna TIMESTAMP sin zona ni DATE que migrar.
--     tests/test_43_zona_horaria.sql falla si aparece una.
--   - El código que ya dice la zona (AT TIME ZONE 'America/Bogota' en el backend
--     y en #241, o AT TIME ZONE 'UTC' en el historial de la Caja) da lo mismo.
--   - Lo único visible: las fechas que la base convierte a texto (p. ej. dentro
--     de obtener_cuenta_mesa_json o generar_comprobante_pago) salen con -05:00
--     en vez de +00:00. Es el mismo instante en ISO 8601, y todos los clientes
--     lo leen con new Date() / Date.parse (revisado en socket-server, backend,
--     panel, PWA y KDS).
--
-- Es la base ACTUAL (current_database()): el mismo script sirve para
-- smartdining, la de staging y la del CI. ALTER DATABASE … SET es idempotente:
-- correrlo dos veces deja lo mismo. Necesita ser dueño de la base o
-- superusuario (migrar.sh corre como POSTGRES_USER).
-- ==============================================================================

DO $$
DECLARE
    v_zona CONSTANT TEXT := 'America/Bogota';
BEGIN
    -- Falla aquí (y migrar.sh deshace todo) si la zona no existiera en la imagen.
    PERFORM now() AT TIME ZONE v_zona;
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), v_zona);
    RAISE NOTICE 'Zona por defecto de la base %: % (la toman las sesiones nuevas)', current_database(), v_zona;
END
$$;
