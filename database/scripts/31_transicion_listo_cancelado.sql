-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 31_transicion_listo_cancelado.sql
-- MÓDULO: Pedidos · máquina de estados
-- ==============================================================================
-- Agrega la transición listo → cancelado a transiciones_validas.
--
-- Caso real: el plato ya salió de cocina (pedido en 'listo') y el cliente se va
-- o lo rechaza antes de que el mesero lo sirva. Hasta ahora la máquina de
-- estados solo dejaba cancelar desde 'recibido' y 'en_preparacion', así que:
--   - D-13 (el personal cancela un plato) respondía 409 item_no_cancelable al
--     cancelar la ÚLTIMA línea de un pedido en 'listo';
--   - POST /pedidos/:id/cancelar y PATCH /pedidos/:id/estado a 'cancelado'
--     daban 409 con un pedido en 'listo'.
-- El backend lee esta tabla (trigger tr_validar_transicion_estado), así que con
-- la fila nueva esos tres caminos quedan permitidos sin tocar el backend.
--
-- Inventario: no hay que tocar nada. tr_devolver_inventario_pedido (script 27)
-- trata cualquier cancelación que no venga de 'recibido' como MERMA: lo que ya
-- se cocinó no vuelve al stock (la fila de merma va con cantidad 0, porque el
-- stock ya se descontó en la reserva).
--
-- Sigue prohibido: entregado → cancelado y pagado → cancelado (lo servido o lo
-- cobrado no se cancela; eso sería un reembolso, otro flujo).
--
-- cancelar_pedido() (script 03) tenía su propia lista fija ('recibido',
-- 'en_preparacion') y habría seguido rechazando 'listo'. Se redefine para que
-- consulte transiciones_validas, igual que el trigger: una sola fuente de
-- verdad. El resto de la función no cambia (mismos pasos, mismo historial).
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. La transición
-- ------------------------------------------------------------------------------
INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
VALUES ('listo', 'cancelado',
        'Pedido cancelado con los platos ya listos (el cliente se fue o lo rechazó antes de servirlo): lo cocinado es merma',
        TRUE)
ON CONFLICT (estado_desde, estado_hacia) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. cancelar_pedido() lee la máquina de estados
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancelar_pedido(
    id_pedido_param INTEGER,
    razon_param VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_id_mesa INTEGER;
    v_estado_actual VARCHAR(20);
    v_permitidos TEXT;
BEGIN
    SELECT id_mesa, estado INTO v_id_mesa, v_estado_actual
    FROM pedidos
    WHERE id_pedido = id_pedido_param
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido ID % no encontrado', id_pedido_param;
    END IF;

    -- La misma regla que tr_validar_transicion_estado: si la transición no está
    -- en transiciones_validas, no se cancela.
    IF NOT EXISTS (
        SELECT 1 FROM transiciones_validas
         WHERE estado_desde = v_estado_actual AND estado_hacia = 'cancelado'
    ) THEN
        SELECT string_agg(estado_desde, ', ' ORDER BY estado_desde) INTO v_permitidos
          FROM transiciones_validas WHERE estado_hacia = 'cancelado';
        RAISE EXCEPTION 'No se puede cancelar un pedido en estado "%". Solo se permite cancelar desde %',
            v_estado_actual, COALESCE(v_permitidos, '(ningún estado)');
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
