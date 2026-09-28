-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 02_funciones_pagos.sql
-- MÓDULO: Paquete 1 - Gestión de Pagos y Transacciones Financieras
-- ==============================================================================

-- 1. VALIDAR MÉTODO DE PAGO
CREATE OR REPLACE FUNCTION validar_metodo_pago(metodo_pago_param VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN metodo_pago_param IN ('efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'online');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. OBTENER SALDO PENDIENTE DE UN PEDIDO
CREATE OR REPLACE FUNCTION obtener_saldo_pendiente(id_pedido_param INTEGER)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    v_total DECIMAL(10,2);
    v_pagado DECIMAL(10,2);
    v_saldo DECIMAL(10,2);
BEGIN
    SELECT total INTO v_total
    FROM pedidos
    WHERE id_pedido = id_pedido_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pedido con ID % no existe', id_pedido_param;
    END IF;

    SELECT COALESCE(SUM(monto), 0.00) INTO v_pagado
    FROM transacciones
    WHERE id_pedido = id_pedido_param
      AND estado_transaccion = 'completada';

    v_saldo := v_total - v_pagado;
    IF v_saldo < 0 THEN
        v_saldo := 0.00;
    END IF;

    RETURN v_saldo;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. VALIDAR TRANSACCIÓN FINANCIERA
CREATE OR REPLACE FUNCTION validar_transaccion_financiera(
    id_pedido_param INTEGER,
    monto_param DECIMAL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_total DECIMAL(10,2);
    v_pagado DECIMAL(10,2);
    v_nuevo_total_pagado DECIMAL(10,2);
BEGIN
    IF monto_param <= 0 THEN
        RAISE EXCEPTION 'El monto a pagar debe ser estrictamente mayor a 0 (recibido: %)', monto_param;
    END IF;

    SELECT total INTO v_total
    FROM pedidos
    WHERE id_pedido = id_pedido_param
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pedido % no existe para validar transacción', id_pedido_param;
    END IF;

    SELECT COALESCE(SUM(monto), 0.00) INTO v_pagado
    FROM transacciones
    WHERE id_pedido = id_pedido_param
      AND estado_transaccion = 'completada';

    v_nuevo_total_pagado := v_pagado + monto_param;

    IF v_nuevo_total_pagado > v_total THEN
        -- Registrar intento fallido para auditoría
        INSERT INTO intentos_pago_fallidos (id_pedido, monto, razon_rechazo)
        VALUES (
            id_pedido_param, 
            monto_param, 
            format('Monto excede el total del pedido. Total: %s, Pagado previo: %s, Intentado: %s', v_total, v_pagado, monto_param)
        );

        RAISE EXCEPTION 'Pago excede monto debido. Total: %, Ya pagado: %, Saldo pendiente: %, Monto intentado: %', 
            v_total, v_pagado, (v_total - v_pagado), monto_param;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 4. PROCESAR PAGO
CREATE OR REPLACE FUNCTION procesar_pago(
    id_pedido_param INTEGER,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    referencia_param VARCHAR DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id_transaccion INTEGER;
    v_saldo_restante DECIMAL(10,2);
BEGIN
    IF NOT validar_metodo_pago(metodo_pago_param) THEN
        RAISE EXCEPTION 'Método de pago "%" no permitido. Válidos: efectivo, tarjeta_debito, tarjeta_credito, transferencia, online', metodo_pago_param;
    END IF;

    -- Validar viabilidad financiera
    PERFORM validar_transaccion_financiera(id_pedido_param, monto_param);

    -- Registrar transacción
    INSERT INTO transacciones (
        id_pedido,
        metodo_pago,
        monto,
        estado_transaccion,
        referencia_externa
    ) VALUES (
        id_pedido_param,
        metodo_pago_param,
        monto_param,
        'completada',
        referencia_param
    ) RETURNING id_transaccion INTO v_id_transaccion;

    -- Verificar si se liquidó la totalidad del pedido
    v_saldo_restante := obtener_saldo_pendiente(id_pedido_param);

    IF v_saldo_restante = 0.00 THEN
        UPDATE pedidos
        SET estado = 'pagado',
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id_pedido = id_pedido_param;
    END IF;

    RETURN v_id_transaccion;
END;
$$ LANGUAGE plpgsql;

-- 5. REEMBOLSAR PAGO
CREATE OR REPLACE FUNCTION reembolsar_pago(
    id_transaccion_param INTEGER,
    razon_param VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_id_pedido INTEGER;
    v_estado_actual VARCHAR(20);
    v_monto DECIMAL(10,2);
BEGIN
    SELECT id_pedido, estado_transaccion, monto 
    INTO v_id_pedido, v_estado_actual, v_monto
    FROM transacciones
    WHERE id_transaccion = id_transaccion_param
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La transacción con ID % no existe', id_transaccion_param;
    END IF;

    IF v_estado_actual != 'completada' THEN
        RAISE EXCEPTION 'Solo se pueden reembolsar transacciones en estado "completada" (Estado actual: %)', v_estado_actual;
    END IF;

    UPDATE transacciones
    SET estado_transaccion = 'reembolsada'
    WHERE id_transaccion = id_transaccion_param;

    -- Registrar en historial del pedido
    INSERT INTO historial_estados (
        id_pedido,
        id_usuario,
        estado_anterior,
        estado_nuevo,
        observaciones
    ) VALUES (
        v_id_pedido,
        NULL,
        'pagado',
        'en_preparacion',
        format('Reembolso de transacción ID %s por monto $%s. Razón: %s', id_transaccion_param, v_monto, COALESCE(razon_param, 'Sin motivo especificado'))
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 6. GENERAR COMPROBANTE DE PAGO
CREATE OR REPLACE FUNCTION generar_comprobante_pago(id_transaccion_param INTEGER)
RETURNS JSON AS $$
DECLARE
    v_resultado JSON;
BEGIN
    SELECT json_build_object(
        'comprobante_id', t.id_transaccion,
        'fecha_emision', t.creado_en,
        'pedido', json_build_object(
            'id_pedido', p.id_pedido,
            'codigo_pedido', p.codigo_pedido,
            'mesa_numero', m.numero,
            'total_pedido', p.total
        ),
        'pago', json_build_object(
            'monto', t.monto,
            'metodo_pago', t.metodo_pago,
            'estado', t.estado_transaccion,
            'referencia', t.referencia_externa
        ),
        'items', (
            SELECT json_agg(json_build_object(
                'plato', pl.nombre,
                'cantidad', dp.cantidad,
                'precio_unitario', dp.precio_unitario,
                'subtotal', dp.subtotal
            ))
            FROM detalles_pedido dp
            JOIN platos pl ON dp.id_plato = pl.id_plato
            WHERE dp.id_pedido = p.id_pedido
        )
    ) INTO v_resultado
    FROM transacciones t
    JOIN pedidos p ON t.id_pedido = p.id_pedido
    JOIN mesas m ON p.id_mesa = m.id_mesa
    WHERE t.id_transaccion = id_transaccion_param;

    IF v_resultado IS NULL THEN
        RAISE EXCEPTION 'Transacción % no encontrada', id_transaccion_param;
    END IF;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;
