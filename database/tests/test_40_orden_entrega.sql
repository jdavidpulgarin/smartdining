-- ==============================================================================
-- PRUEBA REPRODUCIBLE: orden de estado_entrega (script 40)
-- ARCHIVO: database/tests/test_40_orden_entrega.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. Crea su propio cliente,
-- zona (barrio único), repartidor y pedidos a domicilio. Correr desde
-- database/tests (usa \ir).
--
-- CASOS:
--  1. El camino feliz pasa: por_asignar → asignado → (reasignar) → en_camino
--     → entregado; y otro hasta fallido.
--  2. Una entrega nace en por_asignar: insertar en asignado se rechaza. SIN el
--     script 40 la prueba falla aquí.
--  3. Saltar pasos se rechaza: por_asignar → en_camino, por_asignar →
--     entregado, asignado → entregado, asignado → fallido.
--  4. Volver atrás se rechaza: en_camino → asignado, asignado → por_asignar.
--  5. Un UPDATE que no cambia estado_entrega (la referencia, reasignar) pasa.
--  6. Lo del 36 sigue: de entregado o fallido no se sale.
--  7. Correr el script otra vez no cambia nada (un solo trigger).
--  8. Un domicilio solo pasa a 'entregado' si su entrega ya está entregada:
--     con la entrega asignada o en camino, cambiar_estado_pedido() del script
--     03 y un UPDATE directo se rechazan; con la entrega entregada, pasa. Un
--     pedido para llevar sigue pasando a 'entregado'. SIN la regla del pedido
--     la prueba falla aquí.
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t40 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT p_ok THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.rechaza(p_sql TEXT) RETURNS BOOLEAN AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'deshacer' USING ERRCODE = 'T4000';
    EXCEPTION
        WHEN SQLSTATE 'T4000' THEN RETURN FALSE;
        WHEN OTHERS THEN RETURN TRUE;
    END;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS INTEGER AS $$ SELECT id FROM t40 WHERE clave = p $$ LANGUAGE sql;

DO $$
DECLARE v INTEGER;
BEGIN
    INSERT INTO clientes (nombre, email, telefono, password_hash)
    VALUES ('Ana T40', 'ana.t40.' || md5(clock_timestamp()::text) || '@correo.co', '+573001112233',
            '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345')
    RETURNING id_cliente INTO v;
    INSERT INTO t40 VALUES ('cliente', v);
    INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
    VALUES ('T40 ' || md5(clock_timestamp()::text), ARRAY['barrio t40 ' || md5(clock_timestamp()::text)], 5000, 30)
    RETURNING id_zona INTO v;
    INSERT INTO t40 VALUES ('zona', v);
    FOR i IN 1..2 LOOP
        INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
        VALUES ('Rafa T40 ' || i, 't40.rep' || i || '.' || md5(clock_timestamp()::text) || '@smartdining.com', 'x', 'repartidor', TRUE)
        RETURNING id_usuario INTO v;
        INSERT INTO t40 VALUES ('rep' || i, v);
    END LOOP;
END
$$;

-- Un pedido a domicilio con su fila (el trigger diferido del 36 pide las dos).
CREATE FUNCTION pg_temp.domicilio(p_clave TEXT, p_estado TEXT DEFAULT NULL) RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
    INSERT INTO pedidos (codigo_pedido, estado, total, canal, id_cliente)
    VALUES (left('T40' || p_clave || md5(clock_timestamp()::text), 16), 'recibido', 0, 'domicilio', pg_temp.id('cliente'))
    RETURNING id_pedido INTO v;
    IF p_estado IS NULL THEN
        INSERT INTO pedidos_domicilio (id_pedido, direccion_texto, barrio, id_zona, costo_envio)
        VALUES (v, 'Calle 1 # 2-3', 'barrio t40', pg_temp.id('zona'), 5000);
    ELSE
        INSERT INTO pedidos_domicilio (id_pedido, direccion_texto, barrio, id_zona, costo_envio, estado_entrega, id_repartidor)
        VALUES (v, 'Calle 1 # 2-3', 'barrio t40', pg_temp.id('zona'), 5000, p_estado, pg_temp.id('rep1'));
    END IF;
    INSERT INTO t40 VALUES (p_clave, v);
    RETURN v;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.poner(p_clave TEXT, p_estado TEXT, p_extra TEXT DEFAULT '') RETURNS TEXT AS $$
    SELECT format('UPDATE pedidos_domicilio SET estado_entrega = %L%s WHERE id_pedido = %s', p_estado, p_extra, pg_temp.id(p_clave))
$$ LANGUAGE sql;

-- 2. Nace en por_asignar (va primero: es lo que falla sin el script)
SELECT pg_temp.exigir(pg_temp.rechaza($q$SELECT pg_temp.domicilio('X', 'asignado')$q$),
    'caso 2: insertar una entrega ya en asignado (con repartidor) se rechaza');

-- 1. Camino feliz
SELECT pg_temp.domicilio('A');
SELECT pg_temp.exigir((SELECT estado_entrega FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('A')) = 'por_asignar',
    'caso 1: la entrega nace en por_asignar');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('rep1'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('A');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('rep2'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('A');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('A');
UPDATE pedidos_domicilio SET estado_entrega = 'entregado' WHERE id_pedido = pg_temp.id('A');
SELECT pg_temp.exigir((SELECT estado_entrega = 'entregado' AND id_repartidor = pg_temp.id('rep2') FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('A')),
    'caso 1: por_asignar → asignado → reasignar → en_camino → entregado');
SELECT pg_temp.domicilio('F');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('rep1'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('F');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('F');
UPDATE pedidos_domicilio SET estado_entrega = 'fallido', motivo_fallo = 'Nadie abrió' WHERE id_pedido = pg_temp.id('F');
SELECT pg_temp.exigir((SELECT estado_entrega FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('F')) = 'fallido',
    'caso 1: en_camino → fallido con motivo');

-- 3. Saltar pasos
SELECT pg_temp.domicilio('S');
SELECT pg_temp.exigir(
    pg_temp.rechaza(pg_temp.poner('S', 'en_camino', format(', id_repartidor = %s', pg_temp.id('rep1'))))
    AND pg_temp.rechaza(pg_temp.poner('S', 'entregado', format(', id_repartidor = %s', pg_temp.id('rep1')))),
    'caso 3: por_asignar → en_camino y por_asignar → entregado se rechazan');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('rep1'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('S');
SELECT pg_temp.exigir(
    pg_temp.rechaza(pg_temp.poner('S', 'entregado'))
    AND pg_temp.rechaza(pg_temp.poner('S', 'fallido', ', motivo_fallo = ''x''')),
    'caso 3: asignado → entregado y asignado → fallido se rechazan (hay que salir antes)');

-- 4. Volver atrás
SELECT pg_temp.exigir(pg_temp.rechaza(pg_temp.poner('S', 'por_asignar', ', id_repartidor = NULL')),
    'caso 4: asignado → por_asignar (des-asignar) se rechaza');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('S');
SELECT pg_temp.exigir(pg_temp.rechaza(pg_temp.poner('S', 'asignado')),
    'caso 4: en_camino → asignado se rechaza');

-- 5. Sin cambio de estado
UPDATE pedidos_domicilio SET referencia = 'Portón azul' WHERE id_pedido = pg_temp.id('S');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('S');
SELECT pg_temp.exigir((SELECT referencia = 'Portón azul' AND estado_entrega = 'en_camino' FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('S')),
    'caso 5: tocar la referencia o repetir el mismo estado pasa');

-- 6. Lo del 36 sigue
SELECT pg_temp.exigir(pg_temp.rechaza(pg_temp.poner('A', 'en_camino')) AND pg_temp.rechaza(pg_temp.poner('F', 'entregado')),
    'caso 6: de entregado o fallido no se sale');

-- 7. Idempotente
\ir ../scripts/40_orden_estado_entrega.sql
SELECT pg_temp.exigir((SELECT count(*) FROM pg_trigger WHERE tgname = 'tr_orden_estado_entrega' AND NOT tgisinternal) = 1
                  AND pg_temp.rechaza(pg_temp.poner('S', 'asignado')),
    'caso 7: correr el script otra vez deja un solo trigger y sigue rechazando');

-- 8. El pedido de un domicilio solo se entrega con la entrega entregada
SELECT pg_temp.domicilio('E');
UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = pg_temp.id('E');
UPDATE pedidos SET estado = 'listo' WHERE id_pedido = pg_temp.id('E');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('rep1'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('E');
SELECT pg_temp.exigir(
    pg_temp.rechaza(format($f$SELECT cambiar_estado_pedido(%s, 'entregado', 'atajo', %s)$f$, pg_temp.id('E'), pg_temp.id('rep1')))
    AND pg_temp.rechaza(format('UPDATE pedidos SET estado = %L WHERE id_pedido = %s', 'entregado', pg_temp.id('E'))),
    'caso 8: con la entrega asignada, cambiar_estado_pedido() y un UPDATE directo a entregado se rechazan');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('E');
SELECT pg_temp.exigir(
    pg_temp.rechaza(format($f$SELECT cambiar_estado_pedido(%s, 'entregado', 'atajo', %s)$f$, pg_temp.id('E'), pg_temp.id('rep1'))),
    'caso 8: en camino tampoco');
UPDATE pedidos_domicilio SET estado_entrega = 'entregado' WHERE id_pedido = pg_temp.id('E');
SELECT cambiar_estado_pedido(pg_temp.id('E'), 'entregado', 'Entregado a domicilio', pg_temp.id('rep1'));
SELECT pg_temp.exigir((SELECT estado FROM pedidos WHERE id_pedido = pg_temp.id('E')) = 'entregado',
    'caso 8: con la entrega entregada, el pedido sí pasa a entregado');
DO $$
DECLARE v INTEGER;
BEGIN
    INSERT INTO pedidos (codigo_pedido, estado, total, canal, id_cliente)
    VALUES (left('T40L' || md5(clock_timestamp()::text), 16), 'recibido', 0, 'para_llevar', pg_temp.id('cliente'))
    RETURNING id_pedido INTO v;
    INSERT INTO t40 VALUES ('L', v);
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = v;
    UPDATE pedidos SET estado = 'listo' WHERE id_pedido = v;
    UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = v;
END
$$;
SELECT pg_temp.exigir((SELECT estado FROM pedidos WHERE id_pedido = pg_temp.id('L')) = 'entregado',
    'caso 8: un pedido para llevar sigue pasando a entregado');

ROLLBACK;
