-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 07_funciones_notificaciones.sql
-- MÓDULO: Paquete 6 - Notificaciones Web Push y Gestión de Suscripciones PWA
-- ==============================================================================

-- 1. VERIFICAR FORMATO DE ENDPOINT SEGURO (HTTPS)
CREATE OR REPLACE FUNCTION verificar_endpoint_valido(endpoint_param TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (endpoint_param IS NOT NULL AND endpoint_param LIKE 'https://%');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. REGISTRAR SUSCRIPCIÓN PUSH
CREATE OR REPLACE FUNCTION registrar_suscripcion_push(
    id_mesa_o_pedido_param INTEGER,
    tipo_param VARCHAR,
    endpoint_param TEXT,
    p256dh_param TEXT,
    auth_param TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_id_suscripcion INTEGER;
    v_id_pedido INTEGER := NULL;
    v_id_mesa INTEGER := NULL;
BEGIN
    IF NOT verificar_endpoint_valido(endpoint_param) THEN
        RAISE EXCEPTION 'El endpoint de suscripción Push debe utilizar protocolo HTTPS seguro: %', endpoint_param;
    END IF;

    IF tipo_param = 'pedido' THEN
        v_id_pedido := id_mesa_o_pedido_param;
    ELSIF tipo_param = 'mesa' THEN
        v_id_mesa := id_mesa_o_pedido_param;
    ELSE
        RAISE EXCEPTION 'Tipo de suscripción inválido ("%"). Valores permitidos: "pedido" o "mesa"', tipo_param;
    END IF;

    -- Upsert para evitar colisiones por endpoint único
    INSERT INTO suscripciones_push (
        id_pedido,
        id_mesa,
        endpoint,
        clave_p256dh,
        clave_auth
    ) VALUES (
        v_id_pedido,
        v_id_mesa,
        endpoint_param,
        p256dh_param,
        auth_param
    )
    ON CONFLICT (endpoint) DO UPDATE 
    SET id_pedido = EXCLUDED.id_pedido,
        id_mesa = EXCLUDED.id_mesa,
        clave_p256dh = EXCLUDED.clave_p256dh,
        clave_auth = EXCLUDED.clave_auth,
        creado_en = CURRENT_TIMESTAMP
    RETURNING id_suscripcion INTO v_id_suscripcion;

    RETURN v_id_suscripcion;
END;
$$ LANGUAGE plpgsql;

-- 3. OBTENER SUSCRIPCIONES ACTIVAS
CREATE OR REPLACE FUNCTION obtener_suscripciones_activas(
    id_pedido_o_mesa_param INTEGER,
    tipo_param VARCHAR
)
RETURNS TABLE (
    id_suscripcion INTEGER,
    endpoint TEXT,
    clave_p256dh TEXT,
    clave_auth TEXT,
    creado_en TIMESTAMPTZ
) AS $$
BEGIN
    IF tipo_param = 'pedido' THEN
        RETURN QUERY
        SELECT s.id_suscripcion, s.endpoint, s.clave_p256dh, s.clave_auth, s.creado_en
        FROM suscripciones_push s
        WHERE s.id_pedido = id_pedido_o_mesa_param
          AND s.creado_en > (CURRENT_TIMESTAMP - INTERVAL '30 days');
    ELSIF tipo_param = 'mesa' THEN
        RETURN QUERY
        SELECT s.id_suscripcion, s.endpoint, s.clave_p256dh, s.clave_auth, s.creado_en
        FROM suscripciones_push s
        WHERE s.id_mesa = id_pedido_o_mesa_param
          AND s.creado_en > (CURRENT_TIMESTAMP - INTERVAL '30 days');
    ELSE
        RAISE EXCEPTION 'Tipo de parámetro inválido: %', tipo_param;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. DISPARAR ENLACE DE NOTIFICACIÓN PUSH (FORMATO JSON PARA BACKEND)
CREATE OR REPLACE FUNCTION enviar_notificacion_push(
    id_pedido_o_mesa_param INTEGER,
    tipo_param VARCHAR,
    titulo_param VARCHAR,
    mensaje_param VARCHAR
)
RETURNS JSON AS $$
DECLARE
    v_notificaciones JSON;
BEGIN
    SELECT json_agg(
        json_build_object(
            'endpoint', s.endpoint,
            'keys', json_build_object(
                'p256dh', s.clave_p256dh,
                'auth', s.clave_auth
            ),
            'payload', json_build_object(
                'title', titulo_param,
                'body', mensaje_param,
                'timestamp', CURRENT_TIMESTAMP,
                'icon', '/assets/icons/icon-192x192.png'
            )
        )
    ) INTO v_notificaciones
    FROM suscripciones_push s
    WHERE (tipo_param = 'pedido' AND s.id_pedido = id_pedido_o_mesa_param)
       OR (tipo_param = 'mesa' AND s.id_mesa = id_pedido_o_mesa_param);

    RETURN COALESCE(v_notificaciones, '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. CANCELAR SUSCRIPCIÓN PUSH
CREATE OR REPLACE FUNCTION cancelar_suscripcion_push(id_suscripcion_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_filas INTEGER;
BEGIN
    DELETE FROM suscripciones_push
    WHERE id_suscripcion = id_suscripcion_param;

    GET DIAGNOSTICS v_filas = ROW_COUNT;
    RETURN (v_filas > 0);
END;
$$ LANGUAGE plpgsql;

-- 6. LIMPIAR SUSCRIPCIONES EXPIRADAS (Mantenimiento Periódico)
CREATE OR REPLACE FUNCTION limpiar_suscripciones_expiradas()
RETURNS INTEGER AS $$
DECLARE
    v_eliminadas INTEGER;
BEGIN
    DELETE FROM suscripciones_push
    WHERE creado_en < (CURRENT_TIMESTAMP - INTERVAL '90 days');

    GET DIAGNOSTICS v_eliminadas = ROW_COUNT;
    RETURN v_eliminadas;
END;
$$ LANGUAGE plpgsql;
