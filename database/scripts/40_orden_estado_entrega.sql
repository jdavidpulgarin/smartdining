-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 40_orden_estado_entrega.sql
-- MÓDULO: Domicilios · orden de la entrega (D-20a, #231)
-- ==============================================================================
-- El script 36 (tr_validar_pedido_domicilio) no impone un orden en
-- pedidos_domicilio.estado_entrega: solo impide salir de 'entregado' o
-- 'fallido'. El backend (#231) solo hace estas transiciones, y desde aquí la
-- base también las exige, para cualquiera que escriba en la tabla:
--
--   INSERT                   → 'por_asignar'   (una entrega nace sin repartidor)
--   por_asignar → asignado                      (asignar)
--   asignado    → asignado                      (reasignar: cambia id_repartidor)
--   asignado    → en_camino                     (sale el repartidor)
--   en_camino   → entregado | fallido           (entrega o no se pudo)
--
-- Cualquier otra (saltar pasos como por_asignar → en_camino o asignado →
-- entregado, volver atrás como en_camino → asignado, des-asignar) se rechaza
-- con check_violation. Un UPDATE que no cambia estado_entrega (por ejemplo
-- reasignar, o tocar la referencia) no se mira aquí.
--
-- Es un trigger aparte del del 36 (que sigue validando repartidor activo,
-- canal y marcas de tiempo): este solo mira el orden.
--
-- Además, del lado del PEDIDO: un pedido de canal 'domicilio' solo pasa a
-- 'entregado' si su entrega (pedidos_domicilio) ya está 'entregado'. Lo
-- entrega el repartidor (POST /domicilios/:id/entregar, que marca primero la
-- entrega y después el pedido, en la misma transacción). Así ningún otro
-- camino se lo salta: ni PATCH /pedidos/:id/estado (el backend ya da 409
-- entrega_por_repartidor desde el #232), ni cambiar_estado_pedido() del
-- script 03, ni un UPDATE directo. Mesa y para llevar no cambian.
--
-- No toca datos y se puede correr dos veces.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_tr_orden_estado_entrega()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.estado_entrega IS DISTINCT FROM 'por_asignar' THEN
            RAISE EXCEPTION 'La entrega del pedido % tiene que empezar en por_asignar (no en %)',
                NEW.id_pedido, NEW.estado_entrega USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.estado_entrega IS NOT DISTINCT FROM OLD.estado_entrega THEN
        RETURN NEW;
    END IF;

    IF (OLD.estado_entrega, NEW.estado_entrega) IN (
           ('por_asignar', 'asignado'),
           ('asignado',    'en_camino'),
           ('en_camino',   'entregado'),
           ('en_camino',   'fallido')) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'La entrega del pedido % no puede pasar de % a %',
        NEW.id_pedido, OLD.estado_entrega, NEW.estado_entrega USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_tr_orden_estado_entrega() IS
    'Orden de pedidos_domicilio.estado_entrega: nace en por_asignar; por_asignar→asignado→en_camino→entregado|fallido. Script 40.';

DROP TRIGGER IF EXISTS tr_orden_estado_entrega ON pedidos_domicilio;
CREATE TRIGGER tr_orden_estado_entrega
    BEFORE INSERT OR UPDATE OF estado_entrega ON pedidos_domicilio
    FOR EACH ROW EXECUTE FUNCTION fn_tr_orden_estado_entrega();

-- ------------------------------------------------------------------------------
-- Un domicilio solo se marca entregado si su entrega ya lo está
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_domicilio_entregado_por_repartidor()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.canal = 'domicilio'
       AND NEW.estado = 'entregado'
       AND OLD.estado IS DISTINCT FROM 'entregado'
       AND NOT EXISTS (SELECT 1 FROM pedidos_domicilio d
                        WHERE d.id_pedido = NEW.id_pedido AND d.estado_entrega = 'entregado') THEN
        RAISE EXCEPTION 'El pedido a domicilio % solo se marca entregado cuando el repartidor entrega',
            NEW.id_pedido USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_tr_domicilio_entregado_por_repartidor() IS
    'Un pedido de canal domicilio pasa a entregado solo con su pedidos_domicilio.estado_entrega = entregado (por cualquier camino). Script 40.';

DROP TRIGGER IF EXISTS tr_domicilio_entregado_por_repartidor ON pedidos;
CREATE TRIGGER tr_domicilio_entregado_por_repartidor
    BEFORE UPDATE OF estado ON pedidos
    FOR EACH ROW EXECUTE FUNCTION fn_tr_domicilio_entregado_por_repartidor();
