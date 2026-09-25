-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 03_funciones_pedidos.sql
-- MÓDULO: Paquete 2 - Gestión del Ciclo de Vida de Pedidos y Comandas
-- ==============================================================================

-- 1. CREAR PEDIDO
CREATE OR REPLACE FUNCTION crear_pedido(
    id_mesa_param INTEGER,
    notas_generales_param TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id_pedido INTEGER;
    v_codigo_pedido VARCHAR(16);
    v_mesa_existe BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM mesas WHERE id_mesa = id_mesa_param) INTO v_mesa_existe;
    IF NOT v_mesa_existe THEN
        RAISE EXCEPTION 'Mesa con ID % no encontrada', id_mesa_param;
    END IF;

    -- Generar código único legible (ej: ORD-A3F9 o ORD-8392)
    v_codigo_pedido := 'ORD-' || UPPER(SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));

    INSERT INTO pedidos (
        id_mesa,
        codigo_pedido,
        estado,
        total,
        notas_generales
    ) VALUES (
        id_mesa_param,
        v_codigo_pedido,
        'recibido',
        0.00,
        notas_generales_param
    ) RETURNING id_pedido INTO v_id_pedido;

    -- Marcar mesa como ocupada automáticamente
    UPDATE mesas
    SET estado = 'ocupada',
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_mesa = id_mesa_param
      AND estado != 'ocupada';

    -- Registrar evento inicial en historial
    INSERT INTO historial_estados (
        id_pedido,
        id_usuario,
        estado_anterior,
        estado_nuevo,
        observaciones
    ) VALUES (
        v_id_pedido,
        NULL,
        NULL,
        'recibido',
        'Pedido creado inicialmente desde la aplicación'
    );

    RETURN v_id_pedido;
END;
$$ LANGUAGE plpgsql;

-- 2. CAMBIAR ESTADO DE PEDIDO (Validación con Máquina de Estados)
CREATE OR REPLACE FUNCTION cambiar_estado_pedido(
    id_pedido_param INTEGER,
    estado_nuevo_param VARCHAR,
    observaciones_param TEXT,
    id_usuario_param INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_estado_actual VARCHAR(20);
    v_transicion_valida BOOLEAN;
    v_requiere_usuario BOOLEAN;
BEGIN
    SELECT estado INTO v_estado_actual
    FROM pedidos
    WHERE id_pedido = id_pedido_param
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido con ID % no existe', id_pedido_param;
    END IF;

    IF v_estado_actual = estado_nuevo_param THEN
        RETURN TRUE; -- Sin cambio necesario
    END IF;

    -- Verificar máquina de estados
    SELECT true, requiere_usuario 
    INTO v_transicion_valida, v_requiere_usuario
    FROM transiciones_validas
    WHERE estado_desde = v_estado_actual 
      AND estado_hacia = estado_nuevo_param;

    IF NOT COALESCE(v_transicion_valida, false) THEN
        RAISE EXCEPTION 'Transición de estado inválida: No se permite cambiar de "%" hacia "%"', 
            v_estado_actual, estado_nuevo_param;
    END IF;

    IF v_requiere_usuario AND id_usuario_param IS NULL THEN
        RAISE EXCEPTION 'La transición de "%" a "%" requiere la firma de un usuario operativo autenticado',
            v_estado_actual, estado_nuevo_param;
    END IF;

    -- Actualizar estado del pedido
    UPDATE pedidos
    SET estado = estado_nuevo_param,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_pedido = id_pedido_param;

    -- Registrar en trazabilidad histórica
    INSERT INTO historial_estados (
        id_pedido,
        id_usuario,
        estado_anterior,
        estado_nuevo,
        observaciones
    ) VALUES (
        id_pedido_param,
        id_usuario_param,
        v_estado_actual,
        estado_nuevo_param,
        observaciones_param
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 3. OBTENER DETALLES DE UN PEDIDO CON DATOS DEL PLATO
CREATE OR REPLACE FUNCTION obtener_detalles_pedido(id_pedido_param INTEGER)
RETURNS TABLE (
    id_detalle INTEGER,
    id_plato INTEGER,
    nombre_plato VARCHAR,
    cantidad INTEGER,
    precio_unitario DECIMAL(10,2),
    subtotal DECIMAL(10,2),
    estado_item VARCHAR,
    notas_especiales TEXT,
    tiempo_estimado INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dp.id_detalle,
        dp.id_plato,
        pl.nombre AS nombre_plato,
        dp.cantidad,
        dp.precio_unitario,
        dp.subtotal,
        dp.estado_item,
        dp.notas_especiales,
        pl.tiempo_preparacion_estimado AS tiempo_estimado
    FROM detalles_pedido dp
    JOIN platos pl ON dp.id_plato = pl.id_plato
    WHERE dp.id_pedido = id_pedido_param
    ORDER BY dp.id_detalle ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. CANCELAR PEDIDO
CREATE OR REPLACE FUNCTION cancelar_pedido(
    id_pedido_param INTEGER,
    razon_param VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_id_mesa INTEGER;
    v_estado_actual VARCHAR(20);
BEGIN
    SELECT id_mesa, estado INTO v_id_mesa, v_estado_actual
    FROM pedidos
    WHERE id_pedido = id_pedido_param
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido ID % no encontrado', id_pedido_param;
    END IF;

    IF v_estado_actual IN ('pagado', 'cancelado') THEN
        RAISE EXCEPTION 'No se puede cancelar un pedido en estado final "%"', v_estado_actual;
    END IF;

    -- Marcar items del pedido como cancelados
    UPDATE detalles_pedido
    SET estado_item = 'cancelado'
    WHERE id_pedido = id_pedido_param;

    -- Actualizar pedido a cancelado
    UPDATE pedidos
    SET estado = 'cancelado',
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_pedido = id_pedido_param;

    -- Registrar auditoría en historial
    INSERT INTO historial_estados (
        id_pedido,
        id_usuario,
        estado_anterior,
        estado_nuevo,
        observaciones
    ) VALUES (
        id_pedido_param,
        NULL,
        v_estado_actual,
        'cancelado',
        format('Cancelación solicitada: %s', COALESCE(razon_param, 'Sin motivo especificado'))
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 5. OBTENER PEDIDOS POR MESA CON FILTRO OPCIONAL DE ESTADO
CREATE OR REPLACE FUNCTION obtener_pedidos_mesa(
    id_mesa_param INTEGER,
    estado_param VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id_pedido INTEGER,
    codigo_pedido VARCHAR,
    estado VARCHAR,
    total DECIMAL(10,2),
    creado_en TIMESTAMPTZ,
    actualizado_en TIMESTAMPTZ,
    cantidad_items BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id_pedido,
        p.codigo_pedido,
        p.estado,
        p.total,
        p.creado_en,
        p.actualizado_en,
        COUNT(dp.id_detalle) AS cantidad_items
    FROM pedidos p
    LEFT JOIN detalles_pedido dp ON p.id_pedido = dp.id_pedido
    WHERE p.id_mesa = id_mesa_param
      AND (estado_param IS NULL OR p.estado = estado_param)
    GROUP BY p.id_pedido, p.codigo_pedido, p.estado, p.total, p.creado_en, p.actualizado_en
    ORDER BY p.creado_en DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. OBTENER PEDIDOS ACTIVOS EN SALA Y COCINA (KDS)
CREATE OR REPLACE FUNCTION obtener_pedidos_activos()
RETURNS TABLE (
    id_pedido INTEGER,
    id_mesa INTEGER,
    numero_mesa INTEGER,
    codigo_pedido VARCHAR,
    estado VARCHAR,
    total DECIMAL(10,2),
    notas_generales TEXT,
    minutos_transcurridos NUMERIC,
    creado_en TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id_pedido,
        p.id_mesa,
        m.numero AS numero_mesa,
        p.codigo_pedido,
        p.estado,
        p.total,
        p.notas_generales,
        ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.creado_en)) / 60, 1) AS minutos_transcurridos,
        p.creado_en
    FROM pedidos p
    JOIN mesas m ON p.id_mesa = m.id_mesa
    WHERE p.estado IN ('recibido', 'en_preparacion', 'listo')
    ORDER BY p.creado_en ASC; -- FIFO para cocina y atención
END;
$$ LANGUAGE plpgsql STABLE;
