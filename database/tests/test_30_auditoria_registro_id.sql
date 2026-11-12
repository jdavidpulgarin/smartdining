-- ==============================================================================
-- PRUEBA REPRODUCIBLE: registro_id de auditoria_cambios (script 30)
-- ARCHIVO: database/tests/test_30_auditoria_registro_id.sql
-- ==============================================================================
-- COMPORTAMIENTO ESPERADO: en las tres tablas auditadas, registro_id es la
-- llave primaria de la fila, en INSERT, UPDATE y DELETE:
--   1. transacciones → id_transaccion (antes del script 30 guardaba id_pedido:
--      esta prueba FALLA sin el 30). Se crean DOS transacciones del mismo
--      pedido, así al menos una tiene id_transaccion distinto de id_pedido.
--   2. usuarios → id_usuario.
--   3. platos → id_plato (no id_categoria).
--
-- No depende del seed: crea su propia mesa, categoría, plato y pedido.
--
-- No deja nada: todo se hace dentro de un bloque que termina con una excepción
-- a propósito, que deshace las filas de prueba Y sus filas de auditoría. Las
-- variables de PL/pgSQL conservan lo leído, y se comprueban después.
-- ==============================================================================

DO $$
DECLARE
    v_mesa INTEGER;
    v_pedido INTEGER;
    v_categoria INTEGER;
    v_plato_base INTEGER;
    v_tx1 INTEGER;
    v_tx2 INTEGER;
    v_usuario INTEGER;
    v_plato INTEGER;
    v_auditoria_antes BIGINT;
    v_auditoria_despues BIGINT;
    -- 'tabla operacion pk esperada registro_id guardado' por cada fila revisada
    v_casos TEXT[] := ARRAY[]::TEXT[];
    v_caso TEXT;
    v_partes TEXT[];
    v_fallos INTEGER := 0;
BEGIN
    SELECT count(*) INTO v_auditoria_antes FROM auditoria_cambios;

    BEGIN
        -- 0. Datos propios: la prueba no depende del seed (desde #182 el seed ya
        --    no trae pedidos). Mesa, categoría, plato y un pedido con una línea,
        --    para que el total permita las transacciones. Todo se deshace al final.
        INSERT INTO mesas (numero, capacidad, ubicacion, estado)
        VALUES (9930, 2, 'T30 prueba', 'disponible') RETURNING id_mesa INTO v_mesa;
        INSERT INTO categorias (nombre, descripcion, orden_visualizacion)
        VALUES ('T30 Prueba', 'prueba', 99) RETURNING id_categoria INTO v_categoria;
        INSERT INTO platos (id_categoria, nombre, precio)
        VALUES (v_categoria, 'T30 Plato base', 1000) RETURNING id_plato INTO v_plato_base;
        INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total)
        VALUES (v_mesa, 'T30-' || substr(md5(clock_timestamp()::text), 1, 10), 'recibido', 0) RETURNING id_pedido INTO v_pedido;
        INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
        VALUES (v_pedido, v_plato_base, 1, 1000, 1000);

        -- 1. transacciones: dos del mismo pedido, luego UPDATE y DELETE de la segunda
        INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, creado_en)
        VALUES (v_pedido, 'efectivo', 0.01, 'pendiente', 'test30-' || clock_timestamp()::text, NOW())
        RETURNING id_transaccion INTO v_tx1;
        INSERT INTO transacciones (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, creado_en)
        VALUES (v_pedido, 'efectivo', 0.01, 'pendiente', 'test30b-' || clock_timestamp()::text, NOW())
        RETURNING id_transaccion INTO v_tx2;
        UPDATE transacciones SET metodo_pago = 'transferencia' WHERE id_transaccion = v_tx2;
        DELETE FROM transacciones WHERE id_transaccion = v_tx2;

        SELECT v_casos || array_agg(format('transacciones %s %s %s', a.operacion, x.pk, COALESCE(a.registro_id::text, 'NULL')) ORDER BY a.id_auditoria)
          INTO v_casos
          FROM auditoria_cambios a
          JOIN LATERAL (SELECT COALESCE(a.datos_nuevos, a.datos_anteriores) ->> 'id_transaccion' AS pk) x ON TRUE
         WHERE a.tabla_afectada = 'transacciones'
           AND (x.pk)::int IN (v_tx1, v_tx2);

        -- 2. usuarios: alta, cambio de nombre y baja
        INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
        VALUES ('Prueba 30', 'test30.' || md5(clock_timestamp()::text) || '@smartdining.com', 'x', 'mesero', TRUE)
        RETURNING id_usuario INTO v_usuario;
        UPDATE usuarios SET nombre = 'Prueba 30 bis' WHERE id_usuario = v_usuario;
        DELETE FROM usuarios WHERE id_usuario = v_usuario;

        SELECT v_casos || array_agg(format('usuarios %s %s %s', a.operacion, v_usuario, COALESCE(a.registro_id::text, 'NULL')) ORDER BY a.id_auditoria)
          INTO v_casos
          FROM auditoria_cambios a
         WHERE a.tabla_afectada = 'usuarios'
           AND (COALESCE(a.datos_nuevos, a.datos_anteriores) ->> 'id_usuario')::int = v_usuario;

        -- 3. platos: alta, cambio de precio y baja (con categoría, para que
        --    id_categoria esté en la fila y no se confunda con la llave)
        INSERT INTO platos (nombre, descripcion, precio, id_categoria)
        VALUES ('Plato prueba 30 ' || md5(clock_timestamp()::text), 'prueba', 1000, v_categoria)
        RETURNING id_plato INTO v_plato;
        UPDATE platos SET descripcion = 'prueba bis' WHERE id_plato = v_plato;
        DELETE FROM platos WHERE id_plato = v_plato;

        SELECT v_casos || array_agg(format('platos %s %s %s', a.operacion, v_plato, COALESCE(a.registro_id::text, 'NULL')) ORDER BY a.id_auditoria)
          INTO v_casos
          FROM auditoria_cambios a
         WHERE a.tabla_afectada = 'platos'
           AND (COALESCE(a.datos_nuevos, a.datos_anteriores) ->> 'id_plato')::int = v_plato;

        RAISE EXCEPTION USING ERRCODE = 'P0030', MESSAGE = 'deshacer prueba 30';
    EXCEPTION WHEN SQLSTATE 'P0030' THEN
        NULL; -- se deshizo todo lo de arriba; v_casos conserva lo leído
    END;

    IF v_tx1 = v_pedido AND v_tx2 = v_pedido THEN
        RAISE EXCEPTION 'No se pudo separar id_transaccion de id_pedido (%, %).', v_tx1, v_pedido;
    END IF;

    -- transacciones 4 filas (2 INSERT, UPDATE, DELETE), usuarios 3, platos 3
    IF coalesce(array_length(v_casos, 1), 0) <> 10 THEN
        RAISE EXCEPTION 'Se esperaban 10 filas de auditoría, hay %: %', coalesce(array_length(v_casos, 1), 0), v_casos;
    END IF;

    FOREACH v_caso IN ARRAY v_casos LOOP
        v_partes := string_to_array(v_caso, ' ');
        IF v_partes[3] IS DISTINCT FROM v_partes[4] THEN
            v_fallos := v_fallos + 1;
            RAISE NOTICE 'MAL: % % → registro_id % (debía ser la llave %; id_pedido = %)',
                v_partes[1], v_partes[2], v_partes[4], v_partes[3], v_pedido;
        ELSE
            RAISE NOTICE 'ok:  % % → registro_id %', v_partes[1], v_partes[2], v_partes[4];
        END IF;
    END LOOP;

    SELECT count(*) INTO v_auditoria_despues FROM auditoria_cambios;
    IF v_auditoria_despues <> v_auditoria_antes THEN
        RAISE EXCEPTION 'La prueba dejó % filas en auditoria_cambios.', v_auditoria_despues - v_auditoria_antes;
    END IF;

    IF v_fallos > 0 THEN
        RAISE EXCEPTION '% de 10 filas de auditoría con un registro_id que no es la llave primaria (¿falta el script 30?)', v_fallos;
    END IF;

    RAISE NOTICE 'test_30_auditoria_registro_id: OK (10 filas, la base queda igual)';
END $$;
