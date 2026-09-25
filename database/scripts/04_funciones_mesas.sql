-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 04_funciones_mesas.sql
-- MÓDULO: Paquete 3 - Gestión de Mesas, QR Dinámico y Control Concurrente
-- ==============================================================================

-- 1. ASEGURAR COLUMNA DE VERSION CONTROL (Concurrencia Optimista)
CREATE OR REPLACE FUNCTION agregar_version_control_mesa()
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'mesas' AND column_name = 'version_control'
    ) THEN
        ALTER TABLE mesas ADD COLUMN version_control INTEGER NOT NULL DEFAULT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 2. OBTENER MESA POR TOKEN QR
CREATE OR REPLACE FUNCTION obtener_mesa_por_qr(token_qr_param VARCHAR)
RETURNS TABLE (
    id_mesa INTEGER,
    numero INTEGER,
    capacidad INTEGER,
    ubicacion VARCHAR,
    estado VARCHAR,
    token_qr VARCHAR,
    version_control INTEGER,
    actualizado_en TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id_mesa,
        m.numero,
        m.capacidad,
        m.ubicacion,
        m.estado,
        m.token_qr,
        m.version_control,
        m.actualizado_en
    FROM mesas m
    WHERE m.token_qr = token_qr_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Código QR inválido o expirado';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. CAMBIAR ESTADO DE MESA CON CONCURRENCIA OPTIMISTA
CREATE OR REPLACE FUNCTION cambiar_estado_mesa(
    id_mesa_param INTEGER,
    nuevo_estado_param VARCHAR,
    version_control_param INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_filas_afectadas INTEGER;
    v_version_actual INTEGER;
BEGIN
    IF nuevo_estado_param NOT IN ('disponible', 'ocupada', 'reservada', 'mantenimiento') THEN
        RAISE EXCEPTION 'Estado "%" inválido para mesa', nuevo_estado_param;
    END IF;

    -- Intento de actualización atómica basada en versión
    UPDATE mesas
    SET estado = nuevo_estado_param,
        version_control = version_control + 1,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_mesa = id_mesa_param
      AND version_control = version_control_param;

    GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

    IF v_filas_afectadas = 0 THEN
        SELECT version_control INTO v_version_actual FROM mesas WHERE id_mesa = id_mesa_param;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Mesa ID % no encontrada', id_mesa_param;
        ELSE
            RAISE EXCEPTION 'Conflicto de concurrencia: La mesa fue modificada por otro usuario (versión esperada %, versión actual %)', 
                version_control_param, v_version_actual;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 4. REGENERAR TOKEN QR SEGURO
CREATE OR REPLACE FUNCTION regenerar_token_qr(id_mesa_param INTEGER)
RETURNS VARCHAR AS $$
DECLARE
    v_token_antiguo VARCHAR(64);
    v_nuevo_token VARCHAR(64);
BEGIN
    SELECT token_qr INTO v_token_antiguo
    FROM mesas
    WHERE id_mesa = id_mesa_param
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mesa ID % no encontrada para rotación de QR', id_mesa_param;
    END IF;

    -- Generar token aleatorio criptográficamente seguro de 64 caracteres hex
    v_nuevo_token := encode(gen_random_bytes(32), 'hex');

    -- Guardar token previo en histórico
    INSERT INTO token_qr_historico (id_mesa, token_antiguo, fecha_invalidacion)
    VALUES (id_mesa_param, v_token_antiguo, CURRENT_TIMESTAMP);

    -- Actualizar mesa
    UPDATE mesas
    SET token_qr = v_nuevo_token,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_mesa = id_mesa_param;

    RETURN v_nuevo_token;
END;
$$ LANGUAGE plpgsql;

-- 5. OBTENER MESAS DISPONIBLES POR CAPACIDAD
CREATE OR REPLACE FUNCTION obtener_mesas_disponibles(capacidad_minima_param INTEGER DEFAULT 1)
RETURNS TABLE (
    id_mesa INTEGER,
    numero INTEGER,
    capacidad INTEGER,
    ubicacion VARCHAR,
    estado VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        m.id_mesa,
        m.numero,
        m.capacidad,
        m.ubicacion,
        m.estado
    FROM mesas m
    WHERE m.estado = 'disponible'
      AND m.capacidad >= capacidad_minima_param
    ORDER BY m.capacidad ASC, m.numero ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. MÉTRICAS HISTÓRICAS DE MESA
CREATE OR REPLACE FUNCTION obtener_metricas_mesa(
    id_mesa_param INTEGER,
    fecha_inicio_param DATE,
    fecha_fin_param DATE
)
RETURNS JSON AS $$
DECLARE
    v_resultado JSON;
BEGIN
    SELECT json_build_object(
        'id_mesa', id_mesa_param,
        'rango', json_build_object('inicio', fecha_inicio_param, 'fin', fecha_fin_param),
        'total_pedidos', COUNT(p.id_pedido),
        'ingresos_totales', COALESCE(SUM(p.total), 0.00),
        'ticket_promedio', CASE 
            WHEN COUNT(p.id_pedido) > 0 THEN ROUND(SUM(p.total) / COUNT(p.id_pedido), 2)
            ELSE 0.00 
        END,
        'pedidos_cancelados', COUNT(CASE WHEN p.estado = 'cancelado' THEN 1 END),
        'pedidos_pagados', COUNT(CASE WHEN p.estado = 'pagado' THEN 1 END)
    ) INTO v_resultado
    FROM pedidos p
    WHERE p.id_mesa = id_mesa_param
      AND p.creado_en::date BETWEEN fecha_inicio_param AND fecha_fin_param;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;
