-- ==============================================================================
-- PROYECTO: SmartDining
-- ARCHIVO: seed_zonas_demo.sql
-- MÓDULO: Domicilios · zonas de entrega para staging y la demo
-- ==============================================================================
-- Sin zonas activas, GET /api/v1/zonas viene vacío y cotizar siempre responde
-- 422 fuera_de_cobertura: la app no puede mostrar un domicilio cotizado. Este
-- archivo carga tres zonas activas con barrios de Cartagena:
--
--   Centro       Centro Histórico, Getsemaní, San Diego, La Matuna   $4.000 · 25 min
--   Bocagrande   Bocagrande, Castillogrande, El Laguito, Manga       $6.000 · 35 min
--   Norte        Crespo, Marbella, El Cabrero, Torices               $7.000 · 40 min
--
-- SOLO PARA LOCAL, STAGING Y LA DEMO. Se carga A MANO después de migrar.sh
-- (necesita el script 36); no lo corren docker-init.sh ni migrar.sh, para que
-- nunca llegue solo a producción. Ver database/README.md, sección "Zonas de
-- entrega para la demo".
--
-- Solo INSERTA, nunca actualiza ni borra. Cada zona se crea solo si:
--   - no existe ya una zona con ese nombre (activa o no), y
--   - ninguno de sus barrios está ya en otra zona ACTIVA (el trigger del 36
--     lo rechazaría; aquí se salta la zona con un NOTICE en vez de fallar).
-- Así las zonas que el administrador cree, edite, desactive o borre (D-20)
-- nunca se pisan, y correrlo dos veces no cambia nada.
--
-- No toca el esquema. Es un solo bloque DO: o entra todo o nada. No abre su
-- propia transacción, así una prueba puede cargarlo dentro de BEGIN ... ROLLBACK.
-- ==============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_zona   RECORD;
    v_choque TEXT;
BEGIN
    -- El mismo candado que el trigger del 36: entre la revisión y el INSERT
    -- nadie puede colar una zona con estos barrios.
    PERFORM pg_advisory_xact_lock(hashtext('zonas_envio'));

    FOR v_zona IN
        SELECT * FROM (VALUES
            ('Centro',     ARRAY['Centro Histórico', 'Getsemaní', 'San Diego', 'La Matuna'],     4000, 25),
            ('Bocagrande', ARRAY['Bocagrande', 'Castillogrande', 'El Laguito', 'Manga'],         6000, 35),
            ('Norte',      ARRAY['Crespo', 'Marbella', 'El Cabrero', 'Torices'],                 7000, 40)
        ) AS z(nombre, barrios, costo_envio, tiempo_estimado_min)
    LOOP
        IF EXISTS (SELECT 1 FROM zonas_envio WHERE nombre = v_zona.nombre) THEN
            RAISE NOTICE 'zona "%" ya existe: no se toca', v_zona.nombre;
            CONTINUE;
        END IF;

        SELECT z.nombre INTO v_choque
          FROM zonas_envio z, unnest(z.barrios) b
         WHERE z.activa
           AND fn_clave_barrio(b) IN (SELECT fn_clave_barrio(n) FROM unnest(v_zona.barrios) n)
         LIMIT 1;
        IF v_choque IS NOT NULL THEN
            RAISE NOTICE 'zona "%" no se crea: uno de sus barrios ya está en la zona activa "%"',
                v_zona.nombre, v_choque;
            CONTINUE;
        END IF;

        INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min, activa)
        VALUES (v_zona.nombre, v_zona.barrios, v_zona.costo_envio, v_zona.tiempo_estimado_min, TRUE);
        RAISE NOTICE 'zona "%" creada', v_zona.nombre;
    END LOOP;
END
$$;

-- Resumen: las zonas activas que quedan (las de la demo y las que ya hubiera).
SELECT nombre, costo_envio, tiempo_estimado_min, array_to_string(barrios, ', ') AS barrios
  FROM zonas_envio WHERE activa ORDER BY id_zona;
