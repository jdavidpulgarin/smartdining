-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 30_fix_auditoria_registro_id.sql
-- MÓDULO: Auditoría · registro_id de auditoria_cambios
-- ==============================================================================
-- Corrige fn_tr_auditar_cambios() (script 08). Su `registro_id` debía ser la
-- llave primaria de la fila auditada, pero salía de esta expresión:
--
--     (v_nuevos->>'id_' || TG_TABLE_NAME)::integer
--
-- `->>` y `||` tienen la misma precedencia y se agrupan de izquierda a derecha:
-- es `(v_nuevos->>'id_') || TG_TABLE_NAME`, que siempre es NULL (no hay clave
-- 'id_'). Y aunque se agrupara bien, daría 'id_transacciones', 'id_platos'…, que
-- tampoco existen (las llaves son id_transaccion, id_plato, id_usuario). Así el
-- valor salía del COALESCE de respaldo, que prueba columnas en un orden fijo:
-- id_usuario, id_mesa, id_pedido, id_plato, id_transaccion, id_detalle.
--
-- Efecto en las tres tablas que se auditan:
--   usuarios       id_usuario  → correcto (es la primera del respaldo).
--   platos         id_plato    → correcto (no tiene id_usuario/id_mesa/id_pedido).
--   transacciones  id_pedido   → MAL: guarda el id del PEDIDO, no el de la
--                                transacción (id_pedido va antes que
--                                id_transaccion en el respaldo).
-- usuarios y platos salían bien por casualidad: bastaba con auditar una tabla
-- con id_usuario o id_pedido para que se equivocara también.
--
-- Arreglo: el registro_id se toma de la LLAVE PRIMARIA real de la tabla del
-- trigger, leída del catálogo (pg_index de TG_RELID). Sirve igual para las
-- tres tablas de hoy y para cualquiera que se audite después, sin listas que
-- mantener. Si la tabla no tiene una llave primaria de UNA columna entera,
-- registro_id queda NULL (la fila completa sigue en datos_anteriores/nuevos).
--
-- Lo demás no cambia: misma firma, mismos triggers (siguen apuntando a esta
-- función), y auditar_cambios() recibe los mismos argumentos; solo el
-- registro_id es distinto, y solo en transacciones.
--
-- Los registros VIEJOS no se tocan: las filas de transacciones que ya están en
-- auditoria_cambios conservan el id_pedido en registro_id. La transacción
-- correcta de esas filas está en datos_nuevos->>'id_transaccion' (o en
-- datos_anteriores para un DELETE). auditoria_cambios guarda un hash por fila
-- (hash_verificacion), así que reescribirlas también rompería esa verificación.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente
-- (CREATE OR REPLACE): se puede ejecutar dos veces sin error.
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_tr_auditar_cambios()
RETURNS TRIGGER AS $$
DECLARE
    v_operacion VARCHAR(10) := TG_OP;
    v_registro_id INTEGER;
    v_anteriores JSONB := NULL;
    v_nuevos JSONB := NULL;
    v_columna_pk TEXT;
    v_valor_pk TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_nuevos := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_anteriores := to_jsonb(OLD);
        v_nuevos := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_anteriores := to_jsonb(OLD);
    END IF;

    -- La llave primaria de la tabla del trigger, si es de una sola columna.
    SELECT a.attname
      INTO v_columna_pk
      FROM pg_index i
      JOIN pg_attribute a
        ON a.attrelid = i.indrelid
       AND a.attnum = i.indkey[0]
     WHERE i.indrelid = TG_RELID
       AND i.indisprimary
       AND i.indnatts = 1;

    IF v_columna_pk IS NOT NULL THEN
        -- La fila nueva si existe (INSERT, UPDATE); si no, la anterior (DELETE).
        v_valor_pk := COALESCE(v_nuevos, v_anteriores) ->> v_columna_pk;
        -- Solo un entero cabe en registro_id; cualquier otra cosa queda NULL.
        IF v_valor_pk ~ '^-?[0-9]{1,10}$' THEN
            BEGIN
                v_registro_id := v_valor_pk::INTEGER;
            EXCEPTION WHEN numeric_value_out_of_range THEN
                v_registro_id := NULL;
            END;
        END IF;
    END IF;

    PERFORM auditar_cambios(
        TG_TABLE_NAME::VARCHAR,
        v_operacion,
        v_registro_id,
        v_anteriores,
        v_nuevos,
        NULL
    );

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_tr_auditar_cambios() IS
    'Trigger de auditoría DML (usuarios, platos, transacciones). registro_id = llave primaria de la fila, leída del catálogo (script 30; antes, en transacciones, guardaba el id_pedido).';
