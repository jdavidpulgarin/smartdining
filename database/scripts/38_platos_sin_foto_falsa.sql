-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 38_platos_sin_foto_falsa.sql
-- MÓDULO: Menú · imágenes de los platos (D-23)
-- ==============================================================================
-- Hasta el ajuste de imágenes del panel, cuando un plato no tenía imagen el
-- panel ponía una foto genérica de Unsplash:
--   - al crearlo con el campo vacío, la mandaba como url_imagen
--     (pages/Menu.jsx);
--   - al editarlo, el formulario venía con esa misma foto, que también se
--     mostraba en la tarjeta, y al guardar se mandaba.
-- Ese plato quedó en la base con una foto que no es la suya, en vez de "sin
-- foto".
--
-- Este script deja en NULL (sin foto) SOLO los platos cuyo url_imagen es
-- EXACTAMENTE el valor que ponía el panel. Las fotos de la semilla no se tocan:
-- el Bowl Personalizado usa la misma foto con otros parámetros
-- (?w=600&q=80&auto=format), y es la suya.
--
-- Ingredientes: no se tocan. El panel (EditorPasos) manda el campo tal como lo
-- escribe el admin, sin valor por defecto, y el backend tampoco pone uno; la
-- foto falsa solo podía caer en platos.
--
-- Va DESPUÉS del ajuste de imágenes del panel (que deja de mandarla), para
-- limpiar también los platos que se guardaron hasta ese momento. Se puede
-- correr las veces que haga falta. El cambio queda en auditoria_cambios
-- (tr_auditar_platos).
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

DO $$
DECLARE
    v_n INTEGER;
BEGIN
    UPDATE platos
       SET url_imagen = NULL
     WHERE url_imagen = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=500&q=80';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE '38: % plato(s) con la foto falsa del panel quedaron sin foto', v_n;
END;
$$;
