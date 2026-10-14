-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 19_fix_h01_bloqueo_pedidos.sql
-- HALLAZGO: H-01 (CRÍTICO) — Sobrecobro por condición de carrera en pagos simultáneos
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- En pagos concurrentes (por ejemplo, múltiples comensales pagando a la vez o
-- reintentos de pasarela paralelos), leer pedidos.total y SUM(transacciones)
-- sin bloqueo exclusivo permitía sobrecobros que superaban el total del pedido.
-- 
-- SOLUCIÓN:
-- 1. Ejecutar SELECT total FROM pedidos WHERE id_pedido = NEW.id_pedido FOR UPDATE
--    dentro del trigger fn_tr_validar_transaccion_financiera().
-- 2. Actualizar también la función de validación imperativa validar_transaccion_financiera()
--    con FOR UPDATE para consistencia cuando se invoque fuera de triggers.

-- 1. TRIGGER FUNCTION: fn_tr_validar_transaccion_financiera
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
        -- Bloqueo pesimista exclusivo de la fila del pedido para serializar pagos concurrentes
        SELECT total INTO v_total_pedido 
        FROM pedidos 
        WHERE id_pedido = NEW.id_pedido
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'El pedido con ID % no existe', NEW.id_pedido;
        END IF;

        -- Sumar los pagos completados ya confirmados para este pedido
        SELECT COALESCE(SUM(monto), 0.00) INTO v_total_pagado
        FROM transacciones
        WHERE id_pedido = NEW.id_pedido
          AND estado_transaccion = 'completada'
          AND (TG_OP = 'INSERT' OR id_transaccion != NEW.id_transaccion);

        IF (v_total_pagado + NEW.monto) > v_total_pedido THEN
            -- Registrar anomalía en tabla de intentos fallidos
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

-- Asegurar vinculación del trigger
DROP TRIGGER IF EXISTS tr_validar_transaccion_financiera ON transacciones;
CREATE TRIGGER tr_validar_transaccion_financiera
    BEFORE INSERT OR UPDATE ON transacciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_transaccion_financiera();

-- 2. FUNCIÓN IMPERATIVA: validar_transaccion_financiera con FOR UPDATE
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

    -- Bloqueo pesimista exclusivo de la comanda
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
