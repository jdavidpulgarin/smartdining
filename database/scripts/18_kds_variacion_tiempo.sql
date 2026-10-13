-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 18_kds_variacion_tiempo.sql
-- MÓDULO: Corrección de Desbordamiento Numérico en Métricas de Cocina (KDS)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. AMPLIAR COLUMNAS DE VARIACIÓN PORCENTUAL A NUMERIC(10,2)
-- Evita desbordamiento numérico (error 22003) cuando un pedido permanece en
-- preparación durante un periodo prolongado frente a su tiempo estimado.
-- ------------------------------------------------------------------------------
ALTER TABLE kds_metricas
    ALTER COLUMN variacion_porcentaje TYPE NUMERIC(10,2);

ALTER TABLE kds_alertas
    ALTER COLUMN variacion_porcentaje TYPE NUMERIC(10,2);

-- ------------------------------------------------------------------------------
-- 2. ACTUALIZACIÓN DE LA FUNCIÓN DE DISPARADOR: fn_tr_calcular_tiempo_preparacion
-- Amplía variables locales a NUMERIC(10,2) y aplica acotamiento defensivo (clamp)
-- para garantizar que transiciones en_preparacion -> listo nunca fallen por overflow.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_calcular_tiempo_preparacion()
RETURNS TRIGGER AS $$
DECLARE
    v_fecha_inicio TIMESTAMPTZ;
    v_tiempo_real NUMERIC(10,2);
    v_tiempo_estimado INTEGER;
    v_variacion NUMERIC(10,2);
    v_cursor_platos CURSOR FOR
        SELECT dp.id_plato, pl.tiempo_preparacion_estimado
        FROM detalles_pedido dp
        JOIN platos pl ON dp.id_plato = pl.id_plato
        WHERE dp.id_pedido = NEW.id_pedido;
BEGIN
    IF NEW.estado_nuevo = 'listo' THEN
        -- Buscar cuándo inició la preparación en el KDS
        SELECT fecha_cambio INTO v_fecha_inicio
        FROM historial_estados
        WHERE id_pedido = NEW.id_pedido
          AND estado_nuevo = 'en_preparacion'
        ORDER BY fecha_cambio DESC
        LIMIT 1;

        IF v_fecha_inicio IS NOT NULL THEN
            v_tiempo_real := ROUND(EXTRACT(EPOCH FROM (NEW.fecha_cambio - v_fecha_inicio)) / 60.0, 2);

            -- Analizar métrica para cada plato en la comanda
            FOR r IN v_cursor_platos LOOP
                v_tiempo_estimado := r.tiempo_preparacion_estimado;

                IF v_tiempo_estimado IS NOT NULL AND v_tiempo_estimado > 0 THEN
                    -- Calcular variación porcentual y acotarla al rango de NUMERIC(10,2) para evitar desbordamientos
                    v_variacion := LEAST(
                        GREATEST(
                            ROUND(((v_tiempo_real - v_tiempo_estimado) / v_tiempo_estimado::numeric) * 100.0, 2),
                            -99999999.99
                        ),
                        99999999.99
                    );
                ELSE
                    v_variacion := 0.00;
                    v_tiempo_estimado := 1;
                END IF;

                INSERT INTO kds_metricas (
                    id_pedido,
                    id_plato,
                    tiempo_preparacion_real,
                    tiempo_preparacion_estimado,
                    variacion_porcentaje,
                    fecha_metrica
                ) VALUES (
                    NEW.id_pedido,
                    r.id_plato,
                    v_tiempo_real,
                    v_tiempo_estimado,
                    v_variacion,
                    NEW.fecha_cambio
                );

                -- Disparar alerta si hubo una demora superior al 50%
                IF v_variacion > 50.0 THEN
                    INSERT INTO kds_alertas (id_pedido, mensaje, variacion_porcentaje)
                    VALUES (
                        NEW.id_pedido,
                        format('Demora crítica en pedido %s: Tiempo real %s min vs estimado %s min (+%s%%)', 
                            NEW.id_pedido, v_tiempo_real, v_tiempo_estimado, v_variacion),
                        v_variacion
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Re-asociar el trigger a historial_estados
DROP TRIGGER IF EXISTS tr_calcular_tiempo_preparacion ON historial_estados;
CREATE TRIGGER tr_calcular_tiempo_preparacion
    AFTER INSERT ON historial_estados
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_calcular_tiempo_preparacion();
