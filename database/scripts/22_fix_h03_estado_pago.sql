-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 22_fix_h03_estado_pago.sql
-- HALLAZGO: H-03 (ALTO) — Separación de estado de cocina y estado financiero (estado_pago)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- PROBLEMA:
-- El campo pedidos.estado mezclaba el flujo de cocina ('recibido', 'en_preparacion',
-- 'listo', 'entregado') con el estado financiero ('pagado'). Al intentar liquidar
-- un pedido que estaba 'en_preparacion', el trigger tr_validar_transicion_estado
-- lanzaba excepción 409 "Transición de estado no autorizada: de 'en_preparacion' hacia 'pagado'".
--
-- SOLUCIÓN:
-- 1. Agregar columna estado_pago a pedidos ('pendiente', 'parcial', 'pagado'), default 'pendiente'.
-- 2. Migrar los pedidos existentes calculando su estado_pago según sus transacciones completadas.
-- 3. Crear trigger tr_sincronizar_estado_pago_pedido en transacciones para actualizar
--    automáticamente pedidos.estado_pago ante cualquier abono, liquidación o reembolso.
-- 4. Modificar procesar_pago para que no fuerce pedidos.estado = 'pagado', preservando
--    el estado de preparación en cocina.
-- 5. Ajustar funciones de métricas y consultas que evaluaban liquidación vía pedidos.estado.

-- 1. COLUMNA estado_pago E ÍNDICES
ALTER TABLE pedidos
    ADD COLUMN IF NOT EXISTS estado_pago VARCHAR(20) NOT NULL DEFAULT 'pendiente';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pedidos'::regclass
          AND conname = 'chk_pedidos_estado_pago'
    ) THEN
        ALTER TABLE pedidos
            ADD CONSTRAINT chk_pedidos_estado_pago
            CHECK (estado_pago IN ('pendiente', 'parcial', 'pagado'));
    END IF;
END $$;

COMMENT ON COLUMN pedidos.estado_pago IS 
    'Estado financiero del pedido (pendiente, parcial, pagado), desacoplado del estado operativo de cocina.';

CREATE INDEX IF NOT EXISTS idx_pedidos_estado_pago
    ON pedidos(estado_pago);

-- 2. MIGRACIÓN DE DATOS HISTÓRICOS
UPDATE pedidos p
SET estado_pago = CASE
    WHEN COALESCE(tx.total_pagado, 0.00) <= 0.00 THEN 'pendiente'
    WHEN COALESCE(tx.total_pagado, 0.00) >= p.total AND p.total > 0 THEN 'pagado'
    WHEN COALESCE(tx.total_pagado, 0.00) > 0.00 THEN 'parcial'
    ELSE 'pendiente'
END
FROM (
    SELECT id_pedido, SUM(monto) AS total_pagado
    FROM transacciones
    WHERE estado_transaccion = 'completada'
    GROUP BY id_pedido
) tx
WHERE p.id_pedido = tx.id_pedido;

-- Para registros históricos donde el estado era 'pagado'
UPDATE pedidos
SET estado_pago = 'pagado'
WHERE estado = 'pagado' AND estado_pago = 'pendiente';

-- 3. TRIGGER AUTOMÁTICO EN TRANSACCIONES PARA SINCRONIZAR estado_pago
CREATE OR REPLACE FUNCTION fn_tr_sincronizar_estado_pago_pedido()
RETURNS TRIGGER AS $$
DECLARE
    v_id_pedido INTEGER;
    v_total_pedido DECIMAL(10,2);
    v_total_pagado DECIMAL(10,2);
    v_nuevo_estado_pago VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_id_pedido := OLD.id_pedido;
    ELSE
        v_id_pedido := NEW.id_pedido;
    END IF;

    SELECT total INTO v_total_pedido
    FROM pedidos
    WHERE id_pedido = v_id_pedido;

    IF NOT FOUND THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    SELECT COALESCE(SUM(monto), 0.00) INTO v_total_pagado
    FROM transacciones
    WHERE id_pedido = v_id_pedido
      AND estado_transaccion = 'completada';

    IF v_total_pagado <= 0.00 THEN
        v_nuevo_estado_pago := 'pendiente';
    ELSIF v_total_pagado >= v_total_pedido AND v_total_pedido > 0 THEN
        v_nuevo_estado_pago := 'pagado';
    ELSE
        v_nuevo_estado_pago := 'parcial';
    END IF;

    -- Actualizar el estado financiero de la comanda sin tocar el estado de cocina
    UPDATE pedidos
    SET estado_pago = v_nuevo_estado_pago,
        actualizado_en = CURRENT_TIMESTAMP
    WHERE id_pedido = v_id_pedido;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sincronizar_estado_pago_pedido ON transacciones;
CREATE TRIGGER tr_sincronizar_estado_pago_pedido
    AFTER INSERT OR UPDATE OR DELETE ON transacciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_sincronizar_estado_pago_pedido();

-- 4. DESACOPLAR procesar_pago DE LA MÁQUINA DE ESTADOS DE COCINA
CREATE OR REPLACE FUNCTION procesar_pago(
    id_pedido_param INTEGER,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    referencia_param VARCHAR DEFAULT NULL,
    comensal_param VARCHAR DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id_transaccion INTEGER;
BEGIN
    IF NOT validar_metodo_pago(metodo_pago_param) THEN
        RAISE EXCEPTION 'Método de pago "%" no permitido. Válidos: efectivo, tarjeta_debito, tarjeta_credito, transferencia, online', metodo_pago_param;
    END IF;

    -- Validar viabilidad financiera del pedido
    PERFORM validar_transaccion_financiera(id_pedido_param, monto_param);

    -- Registrar transacción con comensal asociado
    -- (El trigger tr_sincronizar_estado_pago_pedido actualizará automáticamente pedidos.estado_pago)
    INSERT INTO transacciones (
        id_pedido,
        metodo_pago,
        monto,
        estado_transaccion,
        referencia_externa,
        comensal
    ) VALUES (
        id_pedido_param,
        metodo_pago_param,
        monto_param,
        'completada',
        referencia_param,
        NULLIF(btrim(comensal_param), '')
    ) RETURNING id_transaccion INTO v_id_transaccion;

    RETURN v_id_transaccion;
END;
$$ LANGUAGE plpgsql;

-- Sobrecarga clásica para compatibilidad con llamadas sin comensal
CREATE OR REPLACE FUNCTION procesar_pago(
    id_pedido_param INTEGER,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    referencia_param VARCHAR DEFAULT NULL
)
RETURNS INTEGER AS $$
BEGIN
    RETURN procesar_pago(id_pedido_param, metodo_pago_param, monto_param, referencia_param, NULL);
END;
$$ LANGUAGE plpgsql;

-- 5. AJUSTAR procesar_pago_comensal_mesa PARA FILTRAR POR estado_pago != 'pagado'
CREATE OR REPLACE FUNCTION procesar_pago_comensal_mesa(
    id_mesa_param INTEGER,
    comensal_param VARCHAR,
    metodo_pago_param VARCHAR,
    monto_param DECIMAL,
    referencia_param VARCHAR DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id_pedido INTEGER;
    v_id_transaccion INTEGER;
    v_sesion_iniciada_en TIMESTAMPTZ;
BEGIN
    SELECT sesion_iniciada_en INTO v_sesion_iniciada_en
    FROM mesas
    WHERE id_mesa = id_mesa_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La mesa con ID % no existe', id_mesa_param;
    END IF;

    IF v_sesion_iniciada_en IS NULL THEN
        RAISE EXCEPTION 'La mesa % no tiene una sesión activa iniciada (sesion_iniciada_en es nulo)', id_mesa_param;
    END IF;

    -- Seleccionar el pedido activo de la sesión actual con saldo pendiente (estado_pago != 'pagado')
    SELECT p.id_pedido
    INTO v_id_pedido
    FROM pedidos p
    WHERE p.id_mesa = id_mesa_param
      AND p.estado != 'cancelado'
      AND p.estado_pago != 'pagado'
      AND p.creado_en >= v_sesion_iniciada_en
    ORDER BY p.creado_en ASC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró un pedido activo con saldo pendiente en la sesión actual de la mesa %', id_mesa_param;
    END IF;

    v_id_transaccion := procesar_pago(
        v_id_pedido,
        metodo_pago_param,
        monto_param,
        referencia_param,
        comensal_param
    );

    RETURN v_id_transaccion;
END;
$$ LANGUAGE plpgsql;

-- 6. AJUSTAR MÉTRICAS DE MESA PARA LEER estado_pago
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
        'pedidos_pagados', COUNT(CASE WHEN p.estado_pago = 'pagado' OR p.estado = 'pagado' THEN 1 END)
    ) INTO v_resultado
    FROM pedidos p
    WHERE p.id_mesa = id_mesa_param
      AND p.creado_en::date BETWEEN fecha_inicio_param AND fecha_fin_param;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;
