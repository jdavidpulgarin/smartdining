-- ==============================================================================
-- PRUEBA REPRODUCIBLE: P-23 · multicanal y domicilios (script 36)
-- ARCHIVO: database/tests/test_36_multicanal.sql
-- ==============================================================================
-- Corre dentro de BEGIN ... ROLLBACK: no deja nada. No depende del seed: crea su
-- propia mesa, insumo, plato con receta, cliente, zona y usuarios. La reserva de
-- inventario es un trigger DIFERIDO; se fuerza con SET CONSTRAINTS ... IMMEDIATE
-- (pg_temp.confirmar), como en test_31.
-- La carrera entre pago y vencimiento con dos sesiones de verdad está en
-- test_36_carrera.sh (necesita COMMIT).
--
-- CASOS:
--  M. La MESA sigue exactamente igual: canal 'mesa' por defecto, reserva,
--     devolución (plato pendiente), merma (en cocina), pago y estado_pago,
--     cuenta de la mesa, KDS (obtener_pedidos_activos) y comprobante. Reglas:
--     mesa sin mesa y mesa en 'por_pagar' se rechazan.
--  L. PARA LLEVAR: exige cliente y no lleva mesa; nace en 'por_pagar'.
--  D. DOMICILIO: zona por barrio (sin tildes ni mayúsculas); total = platos +
--     envío y el envío también aparte; sin pedidos_domicilio no pasa el COMMIT;
--     'por_pagar' no sale en cocina; pago anticipado -> 'recibido', pagado,
--     sale en cocina sin mesa; reintento 'duplicado'; repartidor válido.
--  V. VENCIMIENTO: cancela solo lo vencido, el stock VUELVE (devolución, no
--     merma), respeta los minutos de configuracion_restaurante.
--  T. PAGO TARDE u otro monto: queda en pagos_por_devolver, nunca se pierde, y
--     no toca el pedido. La cancelación del cliente no cancela lo ya pagado.
--  Z. Zonas, clientes, refresh tokens, canal inmutable y rol 'repartidor'.
-- ==============================================================================

BEGIN;

CREATE TEMP TABLE t36 (clave TEXT PRIMARY KEY, id INTEGER) ON COMMIT DROP;

CREATE FUNCTION pg_temp.id(p TEXT) RETURNS INTEGER AS $$ SELECT id FROM t36 WHERE clave = p $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.guardar(p TEXT, v INTEGER) RETURNS VOID AS $$ INSERT INTO t36 VALUES (p, v) $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.exigir(p_ok BOOLEAN, p_que TEXT) RETURNS VOID AS $$
BEGIN
    IF NOT COALESCE(p_ok, FALSE) THEN RAISE EXCEPTION 'FALLA: %', p_que; END IF;
    RAISE NOTICE 'OK   %', p_que;
END;
$$ LANGUAGE plpgsql;
-- Dispara ahora las reservas pendientes, como lo haría el COMMIT.
CREATE FUNCTION pg_temp.confirmar() RETURNS VOID AS $$
BEGIN
    SET CONSTRAINTS tr_reservar_inventario IMMEDIATE;
    SET CONSTRAINTS tr_reservar_inventario DEFERRED;
END;
$$ LANGUAGE plpgsql;
-- TRUE si la sentencia la rechaza la base (cualquier error).
CREATE FUNCTION pg_temp.rechaza(p_sql TEXT) RETURNS BOOLEAN AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
        -- Código propio: P0001 es el de cualquier RAISE EXCEPTION de la base.
        RAISE EXCEPTION 'deshacer' USING ERRCODE = 'T3600';
    EXCEPTION
        WHEN SQLSTATE 'T3600' THEN RETURN FALSE;
        WHEN OTHERS THEN RETURN TRUE;
    END;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION pg_temp.stock() RETURNS NUMERIC AS $$
    SELECT stock_actual FROM insumos WHERE id_insumo = (SELECT id FROM t36 WHERE clave = 'insumo')
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.estado(p TEXT) RETURNS TEXT AS $$
    SELECT estado FROM pedidos WHERE id_pedido = (SELECT id FROM t36 WHERE clave = p)
$$ LANGUAGE sql;
-- Crea un pedido con N sanduches. Canal, mesa, cliente y estado los da quien llama.
CREATE FUNCTION pg_temp.pedido(p_clave TEXT, p_canal TEXT, p_mesa INTEGER, p_cliente INTEGER, p_estado TEXT, p_n INTEGER)
RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
    INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, canal, id_cliente)
    -- codigo_pedido es VARCHAR(16)
    VALUES (p_mesa, left('T36' || p_clave || md5(clock_timestamp()::text), 16), p_estado, 0, p_canal, p_cliente)
    RETURNING id_pedido INTO v;
    FOR i IN 1..p_n LOOP
        INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal)
        VALUES (v, pg_temp.id('plato'), 1, 10000, 10000);
    END LOOP;
    PERFORM pg_temp.guardar(p_clave, v);
    RETURN v;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION pg_temp.domicilio(p_clave TEXT, p_costo NUMERIC) RETURNS VOID AS $$
    INSERT INTO pedidos_domicilio (id_pedido, direccion_texto, barrio, id_zona, costo_envio, telefono_contacto)
    VALUES (pg_temp.id(p_clave), 'Calle 1 # 2-3', 'Centro Histórico', pg_temp.id('zona'), p_costo, '+573001234567')
$$ LANGUAGE sql;

-- ------------------------------------------------------------------ datos --
DO $$
DECLARE v INTEGER;
BEGIN
    INSERT INTO mesas (numero, capacidad, ubicacion, estado, sesion_iniciada_en)
    VALUES (9936, 4, 'T36 prueba', 'ocupada', now() - interval '1 hour') RETURNING id_mesa INTO v;
    PERFORM pg_temp.guardar('mesa', v);
    INSERT INTO categorias (nombre, descripcion, orden_visualizacion) VALUES ('T36 Prueba', 'prueba', 99) RETURNING id_categoria INTO v;
    PERFORM pg_temp.guardar('categoria', v);
    INSERT INTO platos (id_categoria, nombre, precio) VALUES (v, 'T36 Sanduche', 10000) RETURNING id_plato INTO v;
    PERFORM pg_temp.guardar('plato', v);
    INSERT INTO insumos (nombre, unidad, stock_minimo) VALUES ('T36 Pan', 'unidad', 1) RETURNING id_insumo INTO v;
    PERFORM pg_temp.guardar('insumo', v);
    PERFORM registrar_movimiento_inventario(v, 'entrada', 100, 'T36 carga');
    INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES (pg_temp.id('plato'), v, 1);
    INSERT INTO clientes (nombre, email, telefono, password_hash)
    VALUES ('Ana T36', 'Ana.T36@Correo.co', '+573001112233', '$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz12345')
    RETURNING id_cliente INTO v;
    PERFORM pg_temp.guardar('cliente', v);
    INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
    VALUES ('T36 Centro', ARRAY['Centro Histórico', 'Getsemaní'], 5000, 30) RETURNING id_zona INTO v;
    PERFORM pg_temp.guardar('zona', v);
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
    VALUES ('Rafa T36', 't36.rafa.' || md5(clock_timestamp()::text) || '@smartdining.com', 'x', 'repartidor', TRUE) RETURNING id_usuario INTO v;
    PERFORM pg_temp.guardar('repartidor', v);
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
    VALUES ('Memo T36', 't36.memo.' || md5(clock_timestamp()::text) || '@smartdining.com', 'x', 'mesero', TRUE) RETURNING id_usuario INTO v;
    PERFORM pg_temp.guardar('mesero', v);
END $$;
SELECT pg_temp.exigir(pg_temp.stock() = 100, 'datos: 100 panes');

-- =================================================================== MESA ==
SELECT pg_temp.pedido('M1', 'mesa', pg_temp.id('mesa'), NULL, 'recibido', 2);
SELECT pg_temp.confirmar();
SELECT pg_temp.exigir((SELECT canal FROM pedidos WHERE id_pedido = pg_temp.id('M1')) = 'mesa'
                  AND (SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('M1')) = 20000,
    'M: un pedido de mesa nace canal mesa, total 20000 (sin envío)');
SELECT pg_temp.exigir(pg_temp.stock() = 98, 'M: la reserva descuenta 2 panes');
-- devolución: plato pendiente con el pedido en recibido
UPDATE detalles_pedido SET estado_item = 'cancelado'
 WHERE id_detalle = (SELECT min(id_detalle) FROM detalles_pedido WHERE id_pedido = pg_temp.id('M1'));
SELECT pg_temp.exigir(pg_temp.stock() = 99, 'M: quitar un plato pendiente lo DEVUELVE (como antes)');
-- merma: en cocina
UPDATE pedidos SET estado = 'en_preparacion' WHERE id_pedido = pg_temp.id('M1');
UPDATE detalles_pedido SET estado_item = 'cancelado'
 WHERE id_detalle = (SELECT max(id_detalle) FROM detalles_pedido WHERE id_pedido = pg_temp.id('M1'));
SELECT pg_temp.exigir(pg_temp.stock() = 99
                  AND EXISTS (SELECT 1 FROM movimientos_inventario m JOIN detalles_pedido d USING (id_detalle)
                               WHERE d.id_pedido = pg_temp.id('M1') AND m.tipo = 'merma' AND m.cantidad = 0),
    'M: quitar un plato en cocina es MERMA (como antes)');
-- pago, cuenta, KDS y comprobante
SELECT pg_temp.pedido('M2', 'mesa', pg_temp.id('mesa'), NULL, 'recibido', 1);
SELECT pg_temp.confirmar();
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM obtener_pedidos_activos() a
                               WHERE a.id_pedido = pg_temp.id('M2') AND a.numero_mesa = 9936),
    'M: el KDS (obtener_pedidos_activos) lo ve con su número de mesa');
SELECT pg_temp.guardar('txM2', procesar_pago(pg_temp.id('M2'), 'efectivo', 10000, 'T36-M2-' || md5(clock_timestamp()::text), NULL));
SELECT pg_temp.exigir((SELECT estado_pago FROM pedidos WHERE id_pedido = pg_temp.id('M2')) = 'pagado'
                  AND pg_temp.estado('M2') = 'recibido',
    'M: pagar todo deja estado_pago pagado sin tocar el estado de cocina');
SELECT pg_temp.exigir((obtener_cuenta_mesa_json(pg_temp.id('mesa'))) IS NOT NULL
                  AND (SELECT count(*) FROM obtener_cuenta_mesa(pg_temp.id('mesa'))) >= 1,
    'M: la cuenta de la mesa responde (obtener_cuenta_mesa / _json)');
SELECT pg_temp.exigir((generar_comprobante_pago(pg_temp.id('txM2')) -> 'pedido' ->> 'mesa_numero') = '9936',
    'M: el comprobante trae el número de mesa');
-- reglas nuevas que la mesa no puede romper
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO pedidos (id_mesa, codigo_pedido, total, canal) VALUES (NULL, %L, 0, %L)', 'T36-x1', 'mesa')),
    'M: un pedido de mesa SIN mesa se rechaza');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total) VALUES (%s, %L, %L, 0)', pg_temp.id('mesa'), 'T36-x2', 'por_pagar')),
    'M: un pedido de mesa en por_pagar se rechaza');

-- ============================================================= PARA LLEVAR ==
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO pedidos (codigo_pedido, estado, total, canal) VALUES (%L, %L, 0, %L)', 'T36-x3', 'por_pagar', 'para_llevar')),
    'L: para llevar sin cliente se rechaza');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, canal, id_cliente) VALUES (%s, %L, %L, 0, %L, %s)',
    pg_temp.id('mesa'), 'T36-x4', 'por_pagar', 'para_llevar', pg_temp.id('cliente'))),
    'L: para llevar con mesa se rechaza');
SELECT pg_temp.pedido('L1', 'para_llevar', NULL, pg_temp.id('cliente'), 'por_pagar', 1);
SELECT pg_temp.confirmar();
SELECT pg_temp.exigir(pg_temp.estado('L1') = 'por_pagar' AND pg_temp.stock() = 97,
    'L: para llevar con cliente nace en por_pagar y RESERVA al crearse');
SELECT pg_temp.exigir(pg_temp.rechaza(format('INSERT INTO pedidos_domicilio (id_pedido, direccion_texto, barrio, id_zona, costo_envio) VALUES (%s, %L, %L, %s, 0)',
    pg_temp.id('L1'), 'x', 'x', pg_temp.id('zona'))),
    'L: un pedido para llevar no puede tener pedidos_domicilio');

-- =============================================================== DOMICILIO ==
SELECT pg_temp.exigir((SELECT id_zona FROM cotizar_zona('  centro   HISTORICO ')) = pg_temp.id('zona')
                  AND (SELECT costo_envio FROM cotizar_zona('getsemani')) = 5000
                  AND NOT EXISTS (SELECT 1 FROM cotizar_zona('Bocagrande')),
    'D: cotizar_zona encuentra el barrio sin tildes, mayúsculas ni espacios de más; fuera de cobertura, nada');
SELECT pg_temp.pedido('D1', 'domicilio', NULL, pg_temp.id('cliente'), 'por_pagar', 2);
SELECT pg_temp.domicilio('D1', 5000);
SELECT pg_temp.confirmar();
SELECT pg_temp.exigir((SELECT total FROM pedidos WHERE id_pedido = pg_temp.id('D1')) = 25000
                  AND (SELECT costo_envio FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('D1')) = 5000,
    'D: total = 20000 de platos + 5000 de envío, y el envío queda aparte en pedidos_domicilio');
SELECT pg_temp.exigir(pg_temp.stock() = 95, 'D: reserva al crearse, en por_pagar');
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM obtener_pedidos_activos() WHERE id_pedido = pg_temp.id('D1')),
    'D: en por_pagar la cocina NO lo ve');
-- sin pedidos_domicilio no pasa el COMMIT
DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.pedido('D_sin', 'domicilio', NULL, pg_temp.id('cliente'), 'por_pagar', 1);
        SET CONSTRAINTS tr_domicilio_completo IMMEDIATE;
        RAISE EXCEPTION 'FALLA: D: un domicilio sin pedidos_domicilio pasó la comprobación del COMMIT';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'OK   D: un domicilio sin dirección ni zona (pedidos_domicilio) no pasa el COMMIT';
    END;
END $$;
SET CONSTRAINTS tr_domicilio_completo DEFERRED;
-- pago anticipado
SELECT pg_temp.exigir((SELECT resultado FROM registrar_pago_anticipado(pg_temp.id('D1'), 25000, 'tarjeta_credito', 'T36-D1-pago')) = 'confirmado',
    'D: pago anticipado por el total → confirmado');
SELECT pg_temp.exigir(pg_temp.estado('D1') = 'recibido'
                  AND (SELECT estado_pago FROM pedidos WHERE id_pedido = pg_temp.id('D1')) = 'pagado'
                  AND (SELECT count(*) FROM transacciones WHERE id_pedido = pg_temp.id('D1') AND estado_transaccion = 'completada') = 1,
    'D: pasa a recibido, estado_pago pagado, una transacción');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM obtener_pedidos_activos() a WHERE a.id_pedido = pg_temp.id('D1') AND a.id_mesa IS NULL AND a.numero_mesa IS NULL),
    'D: ya pagado, la cocina lo ve (sin mesa: LEFT JOIN)');
SELECT pg_temp.exigir((SELECT resultado FROM registrar_pago_anticipado(pg_temp.id('D1'), 25000, 'tarjeta_credito', 'T36-D1-pago')) = 'duplicado'
                  AND (SELECT count(*) FROM transacciones WHERE id_pedido = pg_temp.id('D1')) = 1,
    'D: el mismo pago otra vez (reintento del webhook) → duplicado, sin segunda transacción');
SELECT pg_temp.exigir((generar_comprobante_pago((SELECT id_transaccion FROM transacciones WHERE id_pedido = pg_temp.id('D1'))) -> 'pedido' ->> 'mesa_numero') IS NULL,
    'D: el comprobante de un domicilio sale (mesa_numero null)');
-- repartidor
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE pedidos_domicilio SET id_repartidor = %s, estado_entrega = %L WHERE id_pedido = %s',
    pg_temp.id('mesero'), 'asignado', pg_temp.id('D1'))),
    'D: asignar a un mesero (no repartidor) se rechaza');
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE pedidos_domicilio SET estado_entrega = %L WHERE id_pedido = %s', 'asignado', pg_temp.id('D1'))),
    'D: asignado sin repartidor se rechaza');
UPDATE pedidos_domicilio SET id_repartidor = pg_temp.id('repartidor'), estado_entrega = 'asignado' WHERE id_pedido = pg_temp.id('D1');
UPDATE pedidos_domicilio SET estado_entrega = 'en_camino' WHERE id_pedido = pg_temp.id('D1');
UPDATE pedidos_domicilio SET estado_entrega = 'entregado' WHERE id_pedido = pg_temp.id('D1');
SELECT pg_temp.exigir((SELECT asignado_en IS NOT NULL AND en_camino_en IS NOT NULL AND entregado_en IS NOT NULL
                         FROM pedidos_domicilio WHERE id_pedido = pg_temp.id('D1')),
    'D: el repartidor lo asigna, sale y entrega; la base pone las horas');
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE pedidos_domicilio SET estado_entrega = %L WHERE id_pedido = %s', 'en_camino', pg_temp.id('D1'))),
    'D: una entrega terminada no vuelve atrás');
SELECT pg_temp.exigir(pg_temp.rechaza(format('UPDATE pedidos_domicilio SET estado_entrega = %L WHERE id_pedido = %s', 'fallido', pg_temp.id('D1')))
                  AND pg_temp.rechaza(format('UPDATE pedidos SET canal = %L WHERE id_pedido = %s', 'para_llevar', pg_temp.id('D1'))),
    'D: fallido exige motivo (y aquí ya estaba entregado); el canal no se cambia');

-- ============================================================ VENCIMIENTO ==
SELECT pg_temp.pedido('V1', 'domicilio', NULL, pg_temp.id('cliente'), 'por_pagar', 3);
SELECT pg_temp.domicilio('V1', 5000);
SELECT pg_temp.pedido('V2', 'para_llevar', NULL, pg_temp.id('cliente'), 'por_pagar', 1);
SELECT pg_temp.confirmar();
UPDATE pedidos SET creado_en = now() - interval '20 minutes' WHERE id_pedido = pg_temp.id('V1');
UPDATE pedidos SET creado_en = now() - interval '7 minutes'  WHERE id_pedido = pg_temp.id('V2');
-- L1 (para llevar, recién creado) también está en por_pagar: no debe vencer.
SELECT pg_temp.guardar('stockV', pg_temp.stock()::INTEGER);
SELECT pg_temp.exigir(ARRAY(SELECT cancelar_por_pagar_vencidos(15)) = ARRAY[pg_temp.id('V1')],
    'V: con 15 minutos vence solo V1 (20 min); V2 (7 min) y L1 (recién) siguen');
SELECT pg_temp.exigir(pg_temp.estado('V1') = 'cancelado' AND pg_temp.estado('V2') = 'por_pagar' AND pg_temp.estado('L1') = 'por_pagar',
    'V: V1 cancelado; los demás intactos');
SELECT pg_temp.exigir(pg_temp.stock() = pg_temp.id('stockV') + 3
                  AND (SELECT count(*) FROM movimientos_inventario m JOIN detalles_pedido d USING (id_detalle)
                        WHERE d.id_pedido = pg_temp.id('V1') AND m.tipo = 'devolucion') = 3
                  AND NOT EXISTS (SELECT 1 FROM movimientos_inventario m JOIN detalles_pedido d USING (id_detalle)
                                   WHERE d.id_pedido = pg_temp.id('V1') AND m.tipo = 'merma'),
    'V: al vencer, el stock VUELVE (3 devoluciones, ninguna merma)');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM historial_estados WHERE id_pedido = pg_temp.id('V1')
                               AND estado_anterior = 'por_pagar' AND estado_nuevo = 'cancelado' AND observaciones LIKE '%15 minutos%'),
    'V: historial con el motivo y los minutos');
UPDATE configuracion_restaurante SET minutos_pago_anticipado = 5 WHERE id = 1;
SELECT pg_temp.exigir(ARRAY(SELECT cancelar_por_pagar_vencidos()) = ARRAY[pg_temp.id('V2')],
    'V: sin parámetro usa configuracion_restaurante (5 min) y vence V2');
SELECT pg_temp.exigir(pg_temp.rechaza('UPDATE configuracion_restaurante SET minutos_pago_anticipado = 2 WHERE id = 1'),
    'V: los minutos configurables van de 5 a 120');

-- ======================================================= PAGO TARDE / MONTO ==
SELECT pg_temp.exigir((SELECT resultado FROM registrar_pago_anticipado(pg_temp.id('V1'), 35000, 'tarjeta_credito', 'T36-V1-tarde')) = 'por_devolver',
    'T: el pago aprobado que llega con el pedido ya vencido → por_devolver');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM pagos_por_devolver WHERE referencia_externa = 'T36-V1-tarde'
                               AND motivo = 'pedido_cancelado' AND estado_pedido = 'cancelado' AND monto = 35000 AND devuelto_en IS NULL)
                  AND NOT EXISTS (SELECT 1 FROM transacciones WHERE id_pedido = pg_temp.id('V1'))
                  AND pg_temp.estado('V1') = 'cancelado',
    'T: queda registrado y marcado para devolución; ninguna transacción; el pedido sigue cancelado');
SELECT pg_temp.exigir((SELECT resultado FROM registrar_pago_anticipado(pg_temp.id('V1'), 35000, 'tarjeta_credito', 'T36-V1-tarde')) = 'duplicado',
    'T: el reintento del pago tardío → duplicado (una sola fila por devolver)');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM auditoria_cambios WHERE tabla_afectada = 'pagos_por_devolver' AND operacion = 'INSERT'),
    'T: pagos_por_devolver queda en la auditoría');
SELECT pg_temp.exigir((SELECT resultado FROM registrar_pago_anticipado(pg_temp.id('L1'), 999, 'tarjeta_credito', 'T36-L1-otro')) = 'por_devolver',
    'T: un pago por otro monto → por_devolver');
-- En sentencias separadas: dentro de un mismo SELECT, las subconsultas pueden
-- evaluarse ANTES que la llamada que escribe.
SELECT pg_temp.exigir((SELECT motivo FROM pagos_por_devolver WHERE referencia_externa = 'T36-L1-otro') = 'monto_distinto'
                  AND pg_temp.estado('L1') = 'por_pagar',
    'T: queda como monto_distinto y el pedido sigue esperando su pago');
SELECT pg_temp.exigir(NOT cancelar_pedido_por_pagar(pg_temp.id('D1'), 'me arrepentí'), 'T: cancelar_pedido_por_pagar sobre un pedido ya pagado → FALSE');
SELECT pg_temp.exigir(pg_temp.estado('D1') = 'recibido',
    'T: el cliente no puede cancelar por esta vía lo que ya se pagó (D1 sigue en recibido)');
SELECT pg_temp.exigir(cancelar_pedido_por_pagar(pg_temp.id('L1'), NULL), 'T: el cliente cancela L1 mientras sigue en por_pagar');
SELECT pg_temp.exigir(pg_temp.estado('L1') = 'cancelado', 'T: L1 queda cancelado');

-- ================================================================ OTRAS REGLAS ==
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min) VALUES (%L, ARRAY[%L], 1000, 20)', 'T36 Otra', 'GETSEMANI')),
    'Z: un barrio no puede estar en dos zonas activas');
SELECT pg_temp.exigir(NOT pg_temp.rechaza(format(
    'INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min, activa) VALUES (%L, ARRAY[%L], 1000, 20, FALSE)', 'T36 Inactiva', 'Getsemaní')),
    'Z: en una zona inactiva sí puede repetirse');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min) VALUES (%L, ARRAY[%L, %L], 1000, 20)', 'T36 Rep', 'Manga', 'manga')),
    'Z: un barrio repetido dentro de la misma zona se rechaza');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO clientes (nombre, email, password_hash) VALUES (%L, %L, %L)', 'Otra', 'ana.t36@correo.co', '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')),
    'Z: el correo del cliente es único sin distinguir mayúsculas');
SELECT pg_temp.exigir(pg_temp.rechaza(format(
    'INSERT INTO clientes (nombre, email, password_hash) VALUES (%L, %L, %L)', 'Otra', E'ana x@correo.co', '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'))
                  AND pg_temp.rechaza(format(
    'INSERT INTO clientes (nombre, email, password_hash) VALUES (%L, %L, %L)', 'Otra', 'otra.t36@correo.co', 'clave-en-texto-plano')),
    'Z: correo con espacio Unicode y clave sin bcrypt se rechazan');
SELECT pg_temp.exigir(NOT pg_temp.rechaza(format(
    'INSERT INTO refresh_tokens_cliente (id_cliente, hash, familia, expira_en) VALUES (%s, %L, gen_random_uuid(), now() + interval %L)',
    pg_temp.id('cliente'), repeat('a', 64), '30 days'))
                  AND pg_temp.rechaza(format(
    'INSERT INTO refresh_tokens_cliente (id_cliente, hash, familia, expira_en) VALUES (%s, %L, gen_random_uuid(), now() + interval %L)',
    pg_temp.id('cliente'), 'token-en-claro', '30 days')),
    'Z: refresh token solo como hash SHA-256 en hex');
-- Ningún trigger de AUDITORÍA (los de validación, como el del script 37, sí pueden estar).
SELECT pg_temp.exigir(NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
                                   WHERE t.tgrelid IN ('clientes'::regclass, 'refresh_tokens_cliente'::regclass)
                                     AND NOT t.tgisinternal AND f.proname ILIKE '%auditar%'),
    'Z: clientes y refresh tokens no se auditan con la fila completa (sin el hash en la auditoría)');
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM usuarios WHERE id_usuario = pg_temp.id('repartidor') AND rol = 'repartidor'),
    'Z: usuarios admite el rol repartidor');
SELECT pg_temp.pedido('Z1', 'para_llevar', NULL, pg_temp.id('cliente'), 'por_pagar', 1);
SELECT pg_temp.exigir(EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'por_pagar' AND estado_hacia = 'recibido')
                  AND EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'por_pagar' AND estado_hacia = 'cancelado')
                  AND pg_temp.rechaza(format('UPDATE pedidos SET estado = %L WHERE id_pedido = %s', 'en_preparacion', pg_temp.id('Z1')))
                  AND pg_temp.rechaza(format('UPDATE pedidos SET estado = %L WHERE id_pedido = %s', 'listo', pg_temp.id('Z1'))),
    'Z: por_pagar solo sale a recibido o cancelado');

ROLLBACK;
