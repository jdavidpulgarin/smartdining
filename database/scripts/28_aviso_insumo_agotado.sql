-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 28_aviso_insumo_agotado.sql
-- MÓDULO: Inventario (G-06) · aviso de insumo agotado
-- ==============================================================================
-- 1. Aviso "stock_bajo" también cuando un insumo LLEGA A 0.
--
--    En el 27, `fn_tr_insumo_recalcular` avisa solo cuando el insumo CRUZA su
--    mínimo hacia abajo. Un insumo que ya estaba bajo el mínimo y se agota no
--    avisaba nada: justo el caso más importante. En la demo de G-07 la Arepa de
--    Chócolo arranca con 2 y mínimo 4 (ya baja), así que al agotarse el panel
--    no se enteraba.
--
--    Ahora avisa en cualquiera de los dos casos, con el MISMO payload (el
--    socket-server calcula `agotado` = stock_actual 0; EVENTS.md §5.5):
--      a) cruza el mínimo hacia abajo (como antes), o
--      b) pasa de más de 0 a 0, aunque ya estuviera bajo el mínimo.
--    Un mismo UPDATE avisa una sola vez aunque cumpla los dos. Un pedido que
--    en la misma transacción cruza el mínimo y luego llega a 0 (dos detalles
--    del mismo insumo) deja DOS avisos, "bajo" y "agotado": decidido así con
--    Jarrinson (G-06).
--
--    No cambia nada más: el recálculo de la carta, los avisos de
--    disponibilidad y el trigger `tr_insumo_recalcular` siguen igual.
--
-- 2. Comentario de `configuracion_restaurante` alineado con lo que publica de
--    verdad GET /api/configuracion (siete campos; el 26 decía cinco).
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_tr_insumo_recalcular()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_disponibilidad(NEW.id_insumo);

    -- Aviso de stock bajo: al cruzar el mínimo hacia abajo, o al agotarse
    -- (aunque ya estuviera bajo). No en cada movimiento.
    IF NEW.activo
       AND (
            (NEW.stock_actual <= NEW.stock_minimo
             AND (OLD.stock_actual > OLD.stock_minimo OR NOT OLD.activo))
         OR (NEW.stock_actual = 0 AND OLD.stock_actual > 0)
       ) THEN
        PERFORM pg_notify('inventario', json_build_object(
            'tipo', 'stock_bajo',
            'id_insumo', NEW.id_insumo,
            'nombre', NEW.nombre,
            'unidad', NEW.unidad,
            'stock_actual', NEW.stock_actual,
            'stock_minimo', NEW.stock_minimo
        )::TEXT);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_tr_insumo_recalcular() IS
    'Tras cambiar stock_actual o activo de un insumo: recalcula la carta y avisa '
    'stock_bajo por pg_notify(''inventario'') al cruzar el mínimo hacia abajo o al '
    'llegar a 0 (script 28).';

COMMENT ON TABLE configuracion_restaurante IS
    'Datos del restaurante. Una sola fila (id = 1). GET /api/configuracion expone '
    'nombre, telefono, direccion, url_logo, horario, propina_sugerida_pct y moneda; '
    'id, actualizado_en y actualizado_por solo salen en /configuracion/completa (admin).';
