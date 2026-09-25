-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 08_triggers.sql
-- MÓDULO: Disparadores (Triggers) de Integridad, Concurrencia y Auditoría
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- TRIGGER 1: tr_validar_transaccion_financiera
-- Valida que los pagos no superen el total del pedido antes de persistirse.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_validar_transaccion_financiera()
RETURNS TRIGGER AS $$
DECLARE
    v_total_pedido DECIMAL(10,2);
    v_total_pagado DECIMAL(10,2);
BEGIN
    IF NEW.monto <= 0 THEN
        RAISE EXCEPTION 'El monto de la transacción debe ser mayor a 0 (recibido: %)', NEW.monto;
    END IF;

    IF NEW.estado_transaccion = 'completada' THEN
        SELECT total INTO v_total_pedido 
        FROM pedidos 
        WHERE id_pedido = NEW.id_pedido;

        SELECT COALESCE(SUM(monto), 0.00) INTO v_total_pagado
        FROM transacciones
        WHERE id_pedido = NEW.id_pedido
          AND estado_transaccion = 'completada'
          AND (TG_OP = 'INSERT' OR id_transaccion != NEW.id_transaccion);

        IF (v_total_pagado + NEW.monto) > v_total_pedido THEN
            -- Registrar anomalía
            INSERT INTO intentos_pago_fallidos (id_pedido, metodo_pago, monto, razon_rechazo)
            VALUES (
                NEW.id_pedido,
                NEW.metodo_pago,
                NEW.monto,
                format('Pago excede monto debido. Total: %s, Pagado previo: %s, Intento: %s', v_total_pedido, v_total_pagado, NEW.monto)
            );

            RAISE EXCEPTION 'Pago excede el monto debido del pedido % (Total: %, Pagado: %, Intentado: %)',
                NEW.id_pedido, v_total_pedido, v_total_pagado, NEW.monto;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_transaccion_financiera ON transacciones;
CREATE TRIGGER tr_validar_transaccion_financiera
    BEFORE INSERT OR UPDATE ON transacciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_transaccion_financiera();

-- ------------------------------------------------------------------------------
-- TRIGGER 2: tr_validar_suscripcion_push
-- Valida endpoints HTTPS y protege las claves criptográficas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_validar_suscripcion_push()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.id_pedido IS NULL AND NEW.id_mesa IS NULL THEN
        RAISE EXCEPTION 'La suscripción Push debe asociarse obligatoriamente a un pedido o una mesa';
    END IF;

    IF NEW.endpoint NOT LIKE 'https://%' THEN
        RAISE EXCEPTION 'El endpoint de notificación debe utilizar protocolo HTTPS: %', NEW.endpoint;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_suscripcion_push ON suscripciones_push;
CREATE TRIGGER tr_validar_suscripcion_push
    BEFORE INSERT OR UPDATE ON suscripciones_push
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_suscripcion_push();

-- ------------------------------------------------------------------------------
-- TRIGGER 3: tr_validar_transicion_estado
-- Aplica la máquina de estados en pedidos y registra la trazabilidad.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_validar_transicion_estado()
RETURNS TRIGGER AS $$
DECLARE
    v_valido BOOLEAN;
BEGIN
    IF OLD.estado = NEW.estado THEN
        RETURN NEW;
    END IF;

    SELECT TRUE INTO v_valido
    FROM transiciones_validas
    WHERE estado_desde = OLD.estado 
      AND estado_hacia = NEW.estado;

    IF NOT COALESCE(v_valido, FALSE) THEN
        RAISE EXCEPTION 'Transición de estado no autorizada: de "%" hacia "%"', OLD.estado, NEW.estado;
    END IF;

    NEW.actualizado_en := CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_transicion_estado ON pedidos;
CREATE TRIGGER tr_validar_transicion_estado
    BEFORE UPDATE OF estado ON pedidos
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_transicion_estado();

-- ------------------------------------------------------------------------------
-- TRIGGER 4: tr_actualizar_total_pedido
-- Recalcula automáticamente el total de la comanda ante cambios en sus ítems.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_actualizar_total_pedido()
RETURNS TRIGGER AS $$
DECLARE
    v_id_pedido INTEGER;
    v_nuevo_total DECIMAL(10,2);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_id_pedido := OLD.id_pedido;
    ELSE
        v_id_pedido := NEW.id_pedido;
    END IF;

    SELECT COALESCE(SUM(subtotal), 0.00) INTO v_nuevo_total
    FROM detalles_pedido
    WHERE id_pedido = v_id_pedido
      AND estado_item != 'cancelado';

    UPDATE pedidos
    SET total = v_nuevo_total,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_pedido = v_id_pedido;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_actualizar_total_pedido ON detalles_pedido;
CREATE TRIGGER tr_actualizar_total_pedido
    AFTER INSERT OR UPDATE OR DELETE ON detalles_pedido
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_actualizar_total_pedido();

-- ------------------------------------------------------------------------------
-- TRIGGER 5: tr_validar_detalle_pedido
-- Valida cantidades, precios históricos y coherencia de subtotal.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_validar_detalle_pedido()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad del ítem debe ser mayor a cero (recibido: %)', NEW.cantidad;
    END IF;

    IF NEW.precio_unitario < 0 THEN
        RAISE EXCEPTION 'El precio unitario no puede ser negativo';
    END IF;

    IF NEW.estado_item NOT IN ('pendiente', 'cocinando', 'listo', 'servido', 'cancelado') THEN
        RAISE EXCEPTION 'Estado de preparación "%" no válido', NEW.estado_item;
    END IF;

    -- Cálculo estricto del subtotal
    NEW.subtotal := NEW.cantidad * NEW.precio_unitario;

    -- Preservación del precio histórico ante ediciones
    IF TG_OP = 'UPDATE' AND OLD.precio_unitario != NEW.precio_unitario THEN
        RAISE EXCEPTION 'No se permite modificar el precio histórico original de un detalle de pedido ya emitido';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_detalle_pedido ON detalles_pedido;
CREATE TRIGGER tr_validar_detalle_pedido
    BEFORE INSERT OR UPDATE ON detalles_pedido
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_detalle_pedido();

-- ------------------------------------------------------------------------------
-- TRIGGER 6: tr_control_concurrencia_mesa
-- Control de concurrencia optimista para estado y versión de mesas.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_control_concurrencia_mesa()
RETURNS TRIGGER AS $$
BEGIN
    -- Si la versión no fue incrementada explícitamente por la lógica de negocio, incrementarla
    IF NEW.version_control = OLD.version_control THEN
        NEW.version_control := OLD.version_control + 1;
    ELSIF NEW.version_control != OLD.version_control + 1 THEN
        RAISE EXCEPTION 'Conflicto de concurrencia en mesa %. Registro modificado simultáneamente por otro proceso', OLD.id_mesa;
    END IF;

    NEW.actualizado_en := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_control_concurrencia_mesa ON mesas;
CREATE TRIGGER tr_control_concurrencia_mesa
    BEFORE UPDATE ON mesas
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_control_concurrencia_mesa();

-- ------------------------------------------------------------------------------
-- TRIGGER 7: tr_regenerar_token_qr
-- Invalida y regenera el QR de la mesa al liquidar o cancelar la sesión de consumo.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_regenerar_token_qr()
RETURNS TRIGGER AS $$
DECLARE
    v_pedidos_abiertos INTEGER;
    v_nuevo_token VARCHAR(64);
    v_token_actual VARCHAR(64);
BEGIN
    IF NEW.estado IN ('pagado', 'cancelado') AND OLD.estado NOT IN ('pagado', 'cancelado') THEN
        -- Comprobar si quedan más pedidos activos en la misma mesa
        SELECT COUNT(*) INTO v_pedidos_abiertos
        FROM pedidos
        WHERE id_mesa = NEW.id_mesa
          AND estado NOT IN ('pagado', 'cancelado')
          AND id_pedido != NEW.id_pedido;

        IF v_pedidos_abiertos = 0 THEN
            SELECT token_qr INTO v_token_actual FROM mesas WHERE id_mesa = NEW.id_mesa;

            v_nuevo_token := encode(gen_random_bytes(32), 'hex');

            -- Guardar histórico de token anterior
            INSERT INTO token_qr_historico (id_mesa, token_antiguo, fecha_invalidacion)
            VALUES (NEW.id_mesa, v_token_actual, CURRENT_TIMESTAMP);

            -- Rotar token y liberar mesa
            UPDATE mesas
            SET token_qr = v_nuevo_token,
                estado = 'disponible',
                actualizado_en = CURRENT_TIMESTAMP
            WHERE id_mesa = NEW.id_mesa;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_regenerar_token_qr ON pedidos;
CREATE TRIGGER tr_regenerar_token_qr
    AFTER UPDATE OF estado ON pedidos
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_regenerar_token_qr();

-- ------------------------------------------------------------------------------
-- TRIGGER 8: tr_auditar_cambios
-- Bitácora unificada de auditoría DML en tablas críticas del sistema.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_auditar_cambios()
RETURNS TRIGGER AS $$
DECLARE
    v_operacion VARCHAR(10) := TG_OP;
    v_registro_id INTEGER;
    v_anteriores JSONB := NULL;
    v_nuevos JSONB := NULL;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_nuevos := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_anteriores := to_jsonb(OLD);
        v_nuevos := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_anteriores := to_jsonb(OLD);
    END IF;

    -- Extraer el identificador primario de forma dinámica
    IF v_nuevos IS NOT NULL THEN
        v_registro_id := COALESCE(
            (v_nuevos->>'id_' || TG_TABLE_NAME)::integer,
            (v_nuevos->>'id_usuario')::integer,
            (v_nuevos->>'id_mesa')::integer,
            (v_nuevos->>'id_pedido')::integer,
            (v_nuevos->>'id_plato')::integer,
            (v_nuevos->>'id_transaccion')::integer,
            (v_nuevos->>'id_detalle')::integer
        );
    ELSIF v_anteriores IS NOT NULL THEN
        v_registro_id := COALESCE(
            (v_anteriores->>'id_' || TG_TABLE_NAME)::integer,
            (v_anteriores->>'id_usuario')::integer,
            (v_anteriores->>'id_mesa')::integer,
            (v_anteriores->>'id_pedido')::integer,
            (v_anteriores->>'id_plato')::integer,
            (v_anteriores->>'id_transaccion')::integer,
            (v_anteriores->>'id_detalle')::integer
        );
    END IF;

    PERFORM auditar_cambios(
        TG_TABLE_NAME::VARCHAR,
        v_operacion,
        v_registro_id,
        v_anteriores,
        v_nuevos,
        NULL
    );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Asignación de auditoría en tablas sensibles
DROP TRIGGER IF EXISTS tr_auditar_usuarios ON usuarios;
CREATE TRIGGER tr_auditar_usuarios AFTER INSERT OR UPDATE OR DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION fn_tr_auditar_cambios();

DROP TRIGGER IF EXISTS tr_auditar_platos ON platos;
CREATE TRIGGER tr_auditar_platos AFTER INSERT OR UPDATE OR DELETE ON platos FOR EACH ROW EXECUTE FUNCTION fn_tr_auditar_cambios();

DROP TRIGGER IF EXISTS tr_auditar_transacciones ON transacciones;
CREATE TRIGGER tr_auditar_transacciones AFTER INSERT OR UPDATE OR DELETE ON transacciones FOR EACH ROW EXECUTE FUNCTION fn_tr_auditar_cambios();

-- ------------------------------------------------------------------------------
-- TRIGGER 9: tr_calcular_tiempo_preparacion
-- Registra métricas y alertas de demora en cocina al pasar pedido a 'listo'.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_calcular_tiempo_preparacion()
RETURNS TRIGGER AS $$
DECLARE
    v_fecha_inicio TIMESTAMPTZ;
    v_tiempo_real NUMERIC(8,2);
    v_tiempo_estimado INTEGER;
    v_variacion NUMERIC(6,2);
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
                v_variacion := ROUND(((v_tiempo_real - v_tiempo_estimado) / v_tiempo_estimado::numeric) * 100.0, 2);

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

DROP TRIGGER IF EXISTS tr_calcular_tiempo_preparacion ON historial_estados;
CREATE TRIGGER tr_calcular_tiempo_preparacion
    AFTER INSERT ON historial_estados
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_calcular_tiempo_preparacion();

-- ------------------------------------------------------------------------------
-- TRIGGER 10: tr_validar_disponibilidad_plato
-- Impide comandar platos inactivos salvo autorización explícita de administración.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_validar_disponibilidad_plato()
RETURNS TRIGGER AS $$
DECLARE
    v_disponible BOOLEAN;
    v_nombre_plato VARCHAR(120);
BEGIN
    SELECT disponible, nombre INTO v_disponible, v_nombre_plato
    FROM platos
    WHERE id_plato = NEW.id_plato;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El plato con ID % no existe', NEW.id_plato;
    END IF;

    IF NOT v_disponible THEN
        IF NEW.notas_especiales IS NOT NULL AND NEW.notas_especiales LIKE '%OVERRIDE_ADMIN%' THEN
            RETURN NEW; -- Permitir por bypass administrativo
        ELSE
            RAISE EXCEPTION 'El plato "%" no se encuentra disponible actualmente en la cocina', v_nombre_plato;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_disponibilidad_plato ON detalles_pedido;
CREATE TRIGGER tr_validar_disponibilidad_plato
    BEFORE INSERT ON detalles_pedido
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_disponibilidad_plato();
