-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 33_estado_pago_al_cambiar_total.sql
-- MÓDULO: Pagos · estado financiero del pedido (H-03, script 22)
-- ==============================================================================
-- PROBLEMA:
-- pedidos.estado_pago ('pendiente', 'parcial', 'pagado') solo se recalculaba
-- cuando cambiaba una TRANSACCIÓN (tr_sincronizar_estado_pago_pedido, script 22).
-- Si lo que cambiaba era el TOTAL del pedido, el estado se quedaba viejo. Pasa
-- desde #180 / D-13: al quitar un plato (estado_item = 'cancelado') el total
-- baja. Si queda igual a lo ya pagado, el saldo es 0 pero estado_pago sigue en
-- 'parcial', y el pedido aparece como pendiente de cobro y vuelve a ser
-- candidato de procesar_pago_comensal_mesa().
--
-- ARREGLO:
-- 1. calcular_estado_pago(total, pagado): la misma regla del script 22, en un
--    solo sitio.
-- 2. Trigger BEFORE UPDATE OF total en pedidos: si el total cambia, recalcula
--    estado_pago con las transacciones completadas. Como es BEFORE y escribe en
--    NEW, no hace un segundo UPDATE ni se llama a sí mismo. El trigger de
--    transacciones del 22 no toca el total, así que no lo dispara.
--    Los pedidos con estado = 'pagado' (históricos de antes del 22, que pueden
--    no tener transacciones) no se tocan.
-- 3. Corrige las filas que ya quedaron mal: 'parcial' con lo pagado >= total.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

-- 1. LA REGLA, EN UN SOLO SITIO (igual que fn_tr_sincronizar_estado_pago_pedido)
CREATE OR REPLACE FUNCTION calcular_estado_pago(p_total DECIMAL, p_pagado DECIMAL)
RETURNS VARCHAR AS $$
    SELECT CASE
        WHEN COALESCE(p_pagado, 0.00) <= 0.00 THEN 'pendiente'
        WHEN p_pagado >= p_total AND p_total > 0 THEN 'pagado'
        ELSE 'parcial'
    END
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION calcular_estado_pago(DECIMAL, DECIMAL) IS
    'Estado financiero de un pedido según su total y lo pagado (transacciones completadas). Regla única del script 22.';

-- 2. RECALCULAR AL CAMBIAR EL TOTAL
CREATE OR REPLACE FUNCTION fn_tr_estado_pago_al_cambiar_total()
RETURNS TRIGGER AS $$
DECLARE
    v_pagado DECIMAL(10,2);
BEGIN
    IF NEW.estado = 'pagado' THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(monto), 0.00) INTO v_pagado
    FROM transacciones
    WHERE id_pedido = NEW.id_pedido
      AND estado_transaccion = 'completada';

    NEW.estado_pago := calcular_estado_pago(NEW.total, v_pagado);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_estado_pago_al_cambiar_total ON pedidos;
CREATE TRIGGER tr_estado_pago_al_cambiar_total
    BEFORE UPDATE OF total ON pedidos
    FOR EACH ROW
    WHEN (NEW.total IS DISTINCT FROM OLD.total)
    EXECUTE FUNCTION fn_tr_estado_pago_al_cambiar_total();

-- 3. FILAS QUE YA QUEDARON MAL: 'parcial' con el saldo en 0 (o a favor)
UPDATE pedidos p
SET estado_pago = 'pagado',
    actualizado_en = CURRENT_TIMESTAMP
FROM (
    SELECT id_pedido, SUM(monto) AS pagado
    FROM transacciones
    WHERE estado_transaccion = 'completada'
    GROUP BY id_pedido
) tx
WHERE p.id_pedido = tx.id_pedido
  AND p.estado_pago = 'parcial'
  AND p.estado <> 'pagado'
  AND calcular_estado_pago(p.total, tx.pagado) = 'pagado';
