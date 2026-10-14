-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 23_fix_h08_intentos_pago_fallidos.sql
-- HALLAZGO: H-08 (MEDIO) — intentos_pago_fallidos siempre vacía por rollback del trigger
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- PROBLEMA:
-- En fn_tr_validar_transaccion_financiera y validar_transaccion_financiera, cuando
-- el monto excedía el total debido, el código ejecutaba un INSERT INTO intentos_pago_fallidos
-- y acto seguido un RAISE EXCEPTION. En PostgreSQL, toda excepción aborta y revierte la
-- transacción en curso, deshaciendo de inmediato el INSERT y dejando la tabla siempre vacía.
--
-- SOLUCIÓN:
-- 1. Quitar el INSERT dentro del trigger financiero (y de validar_transaccion_financiera).
-- 2. Crear una función pública registrar_intento_pago_fallido(...) con soporte para
--    id_pedido, método, monto, motivo forense y metadatos de pasarela.
-- 3. Daniel / el backend invoca registrar_intento_pago_fallido(...) desde el bloque catch
--    en una transacción/conexión independiente tras capturar la excepción de cobro.

-- 1. ACTUALIZAR fn_tr_validar_transaccion_financiera SIN INSERT INÚTIL
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
        -- Bloqueo pesimista del pedido (H-01)
        SELECT total INTO v_total_pedido 
        FROM pedidos 
        WHERE id_pedido = NEW.id_pedido
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'El pedido con ID % no existe', NEW.id_pedido;
        END IF;

        SELECT COALESCE(SUM(monto), 0.00) INTO v_total_pagado
        FROM transacciones
        WHERE id_pedido = NEW.id_pedido
          AND estado_transaccion = 'completada'
          AND (TG_OP = 'INSERT' OR id_transaccion != NEW.id_transaccion);

        IF (v_total_pagado + NEW.monto) > v_total_pedido THEN
            -- No insertamos aquí: el RAISE EXCEPTION desharía el insert en PostgreSQL.
            -- El backend registra el intento fallido en registrar_intento_pago_fallido() en el catch.
            RAISE EXCEPTION 'Pago excede el monto debido del pedido % (Total: %, Pagado: %, Intentado: %)',
                NEW.id_pedido, v_total_pedido, v_total_pagado, NEW.monto;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. ACTUALIZAR validar_transaccion_financiera SIN INSERT INÚTIL
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
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pedido % no existe para validar transacción', id_pedido_param;
    END IF;

    SELECT COALESCE(SUM(monto), 0.00) INTO v_pagado
    FROM transacciones
    WHERE id_pedido = id_pedido_param
      AND estado_transaccion = 'completada';

    v_nuevo_total_pagado := v_pagado + monto_param;

    IF v_nuevo_total_pagado > v_total THEN
        RAISE EXCEPTION 'Pago excede monto debido. Total: %, Ya pagado: %, Saldo pendiente: %, Monto intentado: %', 
            v_total, v_pagado, (v_total - v_pagado), monto_param;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 3. FUNCIÓN: registrar_intento_pago_fallido (Llamable por el Backend en catch)
CREATE OR REPLACE FUNCTION registrar_intento_pago_fallido(
    id_pedido_param INTEGER,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    razon_param TEXT,
    referencia_param VARCHAR DEFAULT NULL,
    id_mesa_param INTEGER DEFAULT NULL,
    id_transaccion_pasarela_param VARCHAR DEFAULT NULL,
    pasarela_param VARCHAR DEFAULT NULL,
    moneda_param VARCHAR DEFAULT 'COP'
)
RETURNS INTEGER AS $$
DECLARE
    v_id_intento INTEGER;
    v_id_mesa_final INTEGER := id_mesa_param;
BEGIN
    -- Inferir la mesa si no vino pero sí hay pedido
    IF v_id_mesa_final IS NULL AND id_pedido_param IS NOT NULL THEN
        SELECT id_mesa INTO v_id_mesa_final
        FROM pedidos
        WHERE id_pedido = id_pedido_param;
    END IF;

    INSERT INTO intentos_pago_fallidos (
        id_pedido,
        id_mesa,
        metodo_pago,
        monto,
        razon_rechazo,
        referencia_externa,
        id_transaccion_pasarela,
        pasarela,
        moneda,
        fecha_intento
    ) VALUES (
        id_pedido_param,
        v_id_mesa_final,
        metodo_pago_param,
        monto_param,
        COALESCE(razon_param, 'Rechazo no especificado'),
        referencia_param,
        id_transaccion_pasarela_param,
        pasarela_param,
        COALESCE(moneda_param, 'COP'),
        CURRENT_TIMESTAMP
    ) RETURNING id_intento INTO v_id_intento;

    RETURN v_id_intento;
END;
$$ LANGUAGE plpgsql;

-- Sobrecarga simple
CREATE OR REPLACE FUNCTION registrar_intento_pago_fallido(
    id_pedido_param INTEGER,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    razon_param TEXT
)
RETURNS INTEGER AS $$
BEGIN
    RETURN registrar_intento_pago_fallido(
        id_pedido_param,
        metodo_pago_param,
        monto_param,
        razon_param,
        NULL,
        NULL,
        NULL,
        NULL,
        'COP'
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION registrar_intento_pago_fallido(INTEGER, VARCHAR, DECIMAL, TEXT, VARCHAR, INTEGER, VARCHAR, VARCHAR, VARCHAR) IS
    'Registra explícitamente un intento fallido o anómalo de cobro sin riesgo de ser revertido por excepciones del trigger.';
