-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 21_fix_h06_limites_pedido.sql
-- HALLAZGO: H-06 (ALTO) — Sin límites de cantidad en pedidos (desbordamiento / abusos)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- PROBLEMA:
-- detalles_pedido solo exigía (cantidad > 0). Esto permitía registrar órdenes con
-- 500 ítems ($12.000.000) o enteros gigantes (100000000) provocando desbordamientos
-- o saturación de cocina sin ningún tope defensivo en la base de datos.
--
-- SOLUCIÓN:
-- 1. Agregar restricción CHECK (cantidad BETWEEN 1 AND 20) sobre detalles_pedido.
-- 2. Implementar un trigger de integridad tr_validar_limite_items_pedido que
--    garantice un máximo de 50 ítems totales por comanda/pedido.

-- 1. RESTRICCIÓN CHECK EN detalles_pedido
DO $$
BEGIN
    -- Eliminar check previo si existía con nombre automático
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'detalles_pedido'::regclass 
          AND conname = 'detalles_pedido_cantidad_check'
    ) THEN
        ALTER TABLE detalles_pedido DROP CONSTRAINT detalles_pedido_cantidad_check;
    END IF;

    -- Eliminar constraint explícito si ya existía para idempotencia
    ALTER TABLE detalles_pedido DROP CONSTRAINT IF EXISTS chk_detalles_pedido_cantidad;

    -- Aplicar restricción de 1 a 20 unidades por ítem
    ALTER TABLE detalles_pedido
        ADD CONSTRAINT chk_detalles_pedido_cantidad
        CHECK (cantidad BETWEEN 1 AND 20);
END $$;

COMMENT ON CONSTRAINT chk_detalles_pedido_cantidad ON detalles_pedido IS 
    'Límite de seguridad: un comensal solo puede pedir entre 1 y 20 porciones de una misma línea.';

-- 2. TRIGGER PARA LÍMITE GLOBAL DE ÍTEMS POR PEDIDO (MÁXIMO 50 ÍTEMS)
CREATE OR REPLACE FUNCTION fn_tr_validar_limite_items_pedido()
RETURNS TRIGGER AS $$
DECLARE
    v_total_items_existentes BIGINT;
    v_nuevo_total BIGINT;
BEGIN
    -- Validar regla de cantidad por ítem (defensa en profundidad)
    IF NEW.cantidad < 1 OR NEW.cantidad > 20 THEN
        RAISE EXCEPTION 'La cantidad del ítem debe estar entre 1 y 20 (recibido: %)', NEW.cantidad;
    END IF;

    -- Calcular suma total de ítems en el pedido
    SELECT COALESCE(SUM(cantidad), 0)
    INTO v_total_items_existentes
    FROM detalles_pedido
    WHERE id_pedido = NEW.id_pedido
      AND (TG_OP = 'INSERT' OR id_detalle != NEW.id_detalle);

    v_nuevo_total := v_total_items_existentes + NEW.cantidad;

    IF v_nuevo_total > 50 THEN
        RAISE EXCEPTION 'El pedido % no puede superar el límite de 50 ítems totales (actual: %, intentado: %)',
            NEW.id_pedido, v_total_items_existentes, v_nuevo_total;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_limite_items_pedido ON detalles_pedido;
CREATE TRIGGER tr_validar_limite_items_pedido
    BEFORE INSERT OR UPDATE ON detalles_pedido
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_limite_items_pedido();
