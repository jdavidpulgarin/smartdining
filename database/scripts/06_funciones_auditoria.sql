-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 06_funciones_auditoria.sql
-- MÓDULO: Paquete 5 - Seguridad, Detección de Anomalías y Auditoría Forense
-- ==============================================================================

-- 1. REGISTRAR CAMBIOS EN BITÁCORA CON HASH DE INTEGRIDAD
CREATE OR REPLACE FUNCTION auditar_cambios(
    tabla_param VARCHAR,
    operacion_param VARCHAR,
    registro_id_param INTEGER,
    datos_anteriores_param JSONB,
    datos_nuevos_param JSONB,
    usuario_id_param INTEGER
)
RETURNS VOID AS $$
DECLARE
    v_anteriores_limpios JSONB := datos_anteriores_param;
    v_nuevos_limpios JSONB := datos_nuevos_param;
    v_hash VARCHAR(64);
BEGIN
    -- Enmascarar credenciales y campos sensibles
    IF v_anteriores_limpios ? 'password_hash' THEN
        v_anteriores_limpios := v_anteriores_limpios || '{"password_hash": "[REDACTED]"}';
    END IF;
    IF v_nuevos_limpios ? 'password_hash' THEN
        v_nuevos_limpios := v_nuevos_limpios || '{"password_hash": "[REDACTED]"}';
    END IF;
    IF v_anteriores_limpios ? 'clave_auth' THEN
        v_anteriores_limpios := v_anteriores_limpios || '{"clave_auth": "[REDACTED]"}';
    END IF;
    IF v_nuevos_limpios ? 'clave_auth' THEN
        v_nuevos_limpios := v_nuevos_limpios || '{"clave_auth": "[REDACTED]"}';
    END IF;

    -- Generar firma hash SHA-256 para verificación anti-manipulación
    v_hash := encode(digest(
        tabla_param || operacion_param || COALESCE(registro_id_param::text, '0') || 
        COALESCE(v_anteriores_limpios::text, '') || COALESCE(v_nuevos_limpios::text, '') || 
        clock_timestamp()::text,
        'sha256'
    ), 'hex');

    INSERT INTO auditoria_cambios (
        tabla_afectada,
        operacion,
        registro_id,
        datos_anteriores,
        datos_nuevos,
        usuario_id,
        fecha_cambio,
        hash_verificacion
    ) VALUES (
        tabla_param,
        operacion_param,
        registro_id_param,
        v_anteriores_limpios,
        v_nuevos_limpios,
        usuario_id_param,
        CURRENT_TIMESTAMP,
        v_hash
    );
END;
$$ LANGUAGE plpgsql;

-- 2. TIMELINE COMPLETO DE UN PEDIDO (Estados, Pagos e Incidentes)
CREATE OR REPLACE FUNCTION obtener_historial_pedido(id_pedido_param INTEGER)
RETURNS TABLE (
    tipo_evento VARCHAR,
    fecha_evento TIMESTAMPTZ,
    descripcion TEXT,
    usuario_responsable VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    -- A. Cambios de estado
    SELECT 
        'ESTADO'::VARCHAR AS tipo_evento,
        h.fecha_cambio AS fecha_evento,
        format('Transición: %s -> %s. Notas: %s', COALESCE(h.estado_anterior, 'INICIAL'), h.estado_nuevo, COALESCE(h.observaciones, 'N/A'))::TEXT,
        COALESCE(u.nombre, 'Cliente / Sistema')::VARCHAR AS usuario_responsable
    FROM historial_estados h
    LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario
    WHERE h.id_pedido = id_pedido_param

    UNION ALL

    -- B. Transacciones de pago
    SELECT 
        'PAGO'::VARCHAR AS tipo_evento,
        t.creado_en AS fecha_evento,
        format('Pago %s por $%s vía %s (Ref: %s)', t.estado_transaccion, t.monto, t.metodo_pago, COALESCE(t.referencia_externa, 'S/R'))::TEXT,
        'Cajero / Pasarela'::VARCHAR AS usuario_responsable
    FROM transacciones t
    WHERE t.id_pedido = id_pedido_param

    UNION ALL

    -- C. Intentos de pago rechazados
    SELECT 
        'ALERTA_PAGO'::VARCHAR AS tipo_evento,
        i.fecha_intento AS fecha_evento,
        format('Rechazo de pago por $%s (%s): %s', i.monto, i.metodo_pago, i.razon_rechazo)::TEXT,
        COALESCE(u2.nombre, 'Sistema')::VARCHAR AS usuario_responsable
    FROM intentos_pago_fallidos i
    LEFT JOIN usuarios u2 ON i.id_usuario = u2.id_usuario
    WHERE i.id_pedido = id_pedido_param

    ORDER BY fecha_evento ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. CONSULTAR AUDITORÍA POR TABLA Y FECHAS
CREATE OR REPLACE FUNCTION obtener_auditoria_cambios(
    tabla_param VARCHAR,
    fecha_inicio_param TIMESTAMPTZ,
    fecha_fin_param TIMESTAMPTZ,
    registro_id_param INTEGER DEFAULT NULL
)
RETURNS TABLE (
    id_auditoria BIGINT,
    tabla VARCHAR,
    operacion VARCHAR,
    registro_id INTEGER,
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id INTEGER,
    fecha_cambio TIMESTAMPTZ,
    hash_verificacion VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id_auditoria,
        a.tabla_afectada,
        a.operacion,
        a.registro_id,
        a.datos_anteriores,
        a.datos_nuevos,
        a.usuario_id,
        a.fecha_cambio,
        a.hash_verificacion
    FROM auditoria_cambios a
    WHERE a.tabla_afectada = tabla_param
      AND a.fecha_cambio BETWEEN fecha_inicio_param AND fecha_fin_param
      AND (registro_id_param IS NULL OR a.registro_id = registro_id_param)
    ORDER BY a.fecha_cambio DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. GENERAR REPORTE GERENCIAL DE AUDITORÍA
CREATE OR REPLACE FUNCTION generar_reporte_auditoria(
    fecha_inicio_param DATE,
    fecha_fin_param DATE
)
RETURNS JSON AS $$
DECLARE
    v_resultado JSON;
BEGIN
    SELECT json_build_object(
        'periodo', json_build_object('desde', fecha_inicio_param, 'hasta', fecha_fin_param),
        'resumen_operaciones', (
            SELECT json_object_agg(tabla_afectada || '_' || operacion, cantidad)
            FROM (
                SELECT tabla_afectada, operacion, COUNT(*) AS cantidad
                FROM auditoria_cambios
                WHERE fecha_cambio::date BETWEEN fecha_inicio_param AND fecha_fin_param
                GROUP BY tabla_afectada, operacion
            ) sub
        ),
        'total_intentos_pago_fallidos', (
            SELECT COUNT(*) 
            FROM intentos_pago_fallidos 
            WHERE fecha_intento::date BETWEEN fecha_inicio_param AND fecha_fin_param
        ),
        'usuarios_con_mas_actividad', (
            SELECT json_agg(json_build_object('usuario_id', usuario_id, 'acciones', conteo))
            FROM (
                SELECT usuario_id, COUNT(*) AS conteo
                FROM auditoria_cambios
                WHERE usuario_id IS NOT NULL 
                  AND fecha_cambio::date BETWEEN fecha_inicio_param AND fecha_fin_param
                GROUP BY usuario_id
                ORDER BY conteo DESC
                LIMIT 5
            ) top_u
        )
    ) INTO v_resultado;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. OBTENER INTENTOS SOSPECHOSOS Y FALLIDOS
CREATE OR REPLACE FUNCTION obtener_intentos_fraude()
RETURNS TABLE (
    id_intento INTEGER,
    id_pedido INTEGER,
    metodo_pago VARCHAR,
    monto DECIMAL(10,2),
    razon_rechazo TEXT,
    ip_origen VARCHAR,
    fecha_intento TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id_intento,
        i.id_pedido,
        i.metodo_pago,
        i.monto,
        i.razon_rechazo,
        i.ip_origen,
        i.fecha_intento
    FROM intentos_pago_fallidos i
    ORDER BY i.fecha_intento DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. BLOQUEAR USUARIO SOSPECHOSO
CREATE OR REPLACE FUNCTION bloquear_usuario_sospechoso(
    id_usuario_param INTEGER,
    razon_param VARCHAR
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE usuarios
    SET activo = FALSE
    WHERE id_usuario = id_usuario_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario ID % no encontrado', id_usuario_param;
    END IF;

    -- Registrar bloqueo
    INSERT INTO auditoria_cambios (
        tabla_afectada,
        operacion,
        registro_id,
        datos_anteriores,
        datos_nuevos,
        hash_verificacion
    ) VALUES (
        'usuarios',
        'UPDATE',
        id_usuario_param,
        jsonb_build_object('activo', TRUE),
        jsonb_build_object('activo', FALSE, 'motivo_bloqueo', razon_param),
        md5(format('bloqueo_usuario_%s_%s', id_usuario_param, clock_timestamp()))
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
