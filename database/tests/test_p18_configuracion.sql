-- ==============================================================================
-- PRUEBA REPRODUCIBLE: P-18 (configuración, mesas.activa e historial de precios)
-- ARCHIVO: database/tests/test_p18_configuracion.sql
-- ==============================================================================
-- COMPORTAMIENTO ESPERADO:
-- 1. Cambiar platos.precio deja una fila en historial_precios con el usuario
--    fijado en app.id_usuario y los precios anterior y nuevo.
-- 2. Un UPDATE que no cambia el precio no deja fila.
-- 3. Sin app.id_usuario, la fila queda con id_usuario NULL.
-- 4. Cambiar ingredientes.precio_extra deja una fila de tipo 'ingrediente'.
-- 5. Una mesa inactiva no se abre, no recibe QR y no se resuelve por QR;
--    liberarla sí se puede. Una mesa ocupada no se desactiva.
-- 6. configuracion_restaurante no admite una segunda fila.
-- ==============================================================================

DO $$
DECLARE
    v_id_usuario INTEGER;
    v_id_plato INTEGER;
    v_precio_original DECIMAL(10,2);
    v_id_ingrediente INTEGER;
    v_extra_original DECIMAL(10,2);
    v_id_mesa INTEGER;
    v_fila historial_precios%ROWTYPE;
    v_conteo INTEGER;
    v_fallo BOOLEAN;
BEGIN
    RAISE NOTICE '--- INICIANDO PRUEBA P-18: configuración, mesas.activa e historial de precios ---';

    SELECT id_usuario INTO v_id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1;
    SELECT id_plato, precio INTO v_id_plato, v_precio_original FROM platos ORDER BY id_plato LIMIT 1;
    SELECT id_ingrediente, precio_extra INTO v_id_ingrediente, v_extra_original
    FROM ingredientes ORDER BY id_ingrediente LIMIT 1;

    IF v_id_usuario IS NULL OR v_id_plato IS NULL OR v_id_ingrediente IS NULL THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: faltan datos semilla (usuarios, platos o ingredientes).';
    END IF;

    -- CASO 1: cambio de precio con autor
    PERFORM set_config('app.id_usuario', v_id_usuario::text, true);
    UPDATE platos SET precio = v_precio_original + 1000 WHERE id_plato = v_id_plato;

    SELECT * INTO v_fila FROM historial_precios
    WHERE tipo = 'plato' AND id_referencia = v_id_plato
    ORDER BY id DESC LIMIT 1;

    IF v_fila.id IS NULL THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: cambiar el precio del plato no dejó fila en historial_precios.';
    END IF;
    IF v_fila.id_usuario IS DISTINCT FROM v_id_usuario THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: el historial guardó id_usuario %, se esperaba %.', v_fila.id_usuario, v_id_usuario;
    END IF;
    IF v_fila.precio_anterior <> v_precio_original OR v_fila.precio_nuevo <> v_precio_original + 1000 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: precios del historial incorrectos (% -> %).', v_fila.precio_anterior, v_fila.precio_nuevo;
    END IF;
    RAISE NOTICE 'Caso 1 OK: historial con usuario % (% -> %)', v_fila.id_usuario, v_fila.precio_anterior, v_fila.precio_nuevo;

    -- CASO 2: mismo precio, sin fila nueva
    SELECT count(*) INTO v_conteo FROM historial_precios WHERE tipo = 'plato' AND id_referencia = v_id_plato;
    UPDATE platos SET precio = precio WHERE id_plato = v_id_plato;
    IF (SELECT count(*) FROM historial_precios WHERE tipo = 'plato' AND id_referencia = v_id_plato) <> v_conteo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: un UPDATE sin cambio de precio dejó fila en el historial.';
    END IF;
    RAISE NOTICE 'Caso 2 OK: sin cambio de precio no hay fila';

    -- CASO 3: sin autor -> id_usuario NULL (el valor '' es lo que queda en una
    -- conexión del pool tras una transacción anterior)
    PERFORM set_config('app.id_usuario', '', true);
    UPDATE platos SET precio = v_precio_original WHERE id_plato = v_id_plato;
    SELECT * INTO v_fila FROM historial_precios
    WHERE tipo = 'plato' AND id_referencia = v_id_plato
    ORDER BY id DESC LIMIT 1;
    IF v_fila.id_usuario IS NOT NULL OR v_fila.precio_nuevo <> v_precio_original THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: sin app.id_usuario se esperaba id_usuario NULL (llegó %).', v_fila.id_usuario;
    END IF;
    RAISE NOTICE 'Caso 3 OK: sin app.id_usuario queda NULL';

    -- CASO 4: ingrediente
    PERFORM set_config('app.id_usuario', v_id_usuario::text, true);
    UPDATE ingredientes SET precio_extra = v_extra_original + 500 WHERE id_ingrediente = v_id_ingrediente;
    SELECT * INTO v_fila FROM historial_precios
    WHERE tipo = 'ingrediente' AND id_referencia = v_id_ingrediente
    ORDER BY id DESC LIMIT 1;
    IF v_fila.id IS NULL OR v_fila.id_usuario IS DISTINCT FROM v_id_usuario
       OR v_fila.precio_anterior <> v_extra_original OR v_fila.precio_nuevo <> v_extra_original + 500 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: el cambio de precio_extra no quedó bien en el historial.';
    END IF;
    UPDATE ingredientes SET precio_extra = v_extra_original WHERE id_ingrediente = v_id_ingrediente;
    PERFORM set_config('app.id_usuario', '', true);
    RAISE NOTICE 'Caso 4 OK: historial del ingrediente con usuario';

    -- CASO 5: mesa inactiva
    INSERT INTO mesas (numero, capacidad, ubicacion, estado)
    VALUES (9901, 2, 'Prueba P-18', 'disponible')
    RETURNING id_mesa INTO v_id_mesa;

    UPDATE mesas SET activa = FALSE WHERE id_mesa = v_id_mesa;

    v_fallo := FALSE;
    BEGIN
        -- Lo mismo que hace abrirSesion en el backend.
        UPDATE mesas SET token_qr = 'qr-prueba-p18', estado = 'ocupada', sesion_iniciada_en = NOW()
        WHERE id_mesa = v_id_mesa;
    EXCEPTION WHEN check_violation THEN
        v_fallo := TRUE;
        RAISE NOTICE 'Apertura de mesa inactiva rechazada: %', SQLERRM;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: se abrió una mesa inactiva.';
    END IF;

    v_fallo := FALSE;
    BEGIN
        UPDATE mesas SET token_qr = 'qr-prueba-p18' WHERE id_mesa = v_id_mesa;
    EXCEPTION WHEN check_violation THEN
        v_fallo := TRUE;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: una mesa inactiva recibió QR.';
    END IF;

    IF EXISTS (SELECT 1 FROM obtener_mesas_disponibles(1) d WHERE d.id_mesa = v_id_mesa) THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: una mesa inactiva aparece como disponible.';
    END IF;
    RAISE NOTICE 'Caso 5a OK: mesa inactiva no se abre, no recibe QR ni sale como disponible';

    -- Una mesa que quedó con token y luego se desactivó no se resuelve por QR.
    UPDATE mesas SET activa = TRUE WHERE id_mesa = v_id_mesa;
    UPDATE mesas SET token_qr = 'qr-prueba-p18', estado = 'ocupada' WHERE id_mesa = v_id_mesa;

    v_fallo := FALSE;
    BEGIN
        UPDATE mesas SET activa = FALSE WHERE id_mesa = v_id_mesa;
    EXCEPTION WHEN check_violation THEN
        v_fallo := TRUE;
        RAISE NOTICE 'Desactivar mesa ocupada rechazado: %', SQLERRM;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: se desactivó una mesa ocupada.';
    END IF;

    -- Liberar dejando el token en la fila y desactivar después: ese token viejo
    -- no debe servir para entrar a una mesa inactiva.
    UPDATE mesas SET estado = 'disponible' WHERE id_mesa = v_id_mesa;
    UPDATE mesas SET activa = FALSE WHERE id_mesa = v_id_mesa;

    v_fallo := FALSE;
    BEGIN
        PERFORM * FROM obtener_mesa_por_qr('qr-prueba-p18');
    EXCEPTION WHEN OTHERS THEN
        v_fallo := TRUE;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: obtener_mesa_por_qr resolvió una mesa inactiva.';
    END IF;

    -- regenerar_token_qr (script 04) tampoco puede rotar el QR de una mesa
    -- inactiva. Se llama con token puesto: con token NULL falla antes por un
    -- defecto propio de la función (token_antiguo es NOT NULL en el histórico).
    v_fallo := FALSE;
    BEGIN
        PERFORM regenerar_token_qr(v_id_mesa);
    EXCEPTION WHEN check_violation THEN
        v_fallo := TRUE;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: regenerar_token_qr dio QR a una mesa inactiva.';
    END IF;

    -- Liberar (token_qr NULL) siempre se permite.
    UPDATE mesas SET token_qr = NULL, estado = 'disponible' WHERE id_mesa = v_id_mesa;
    RAISE NOTICE 'Caso 5b OK: mesa ocupada no se desactiva; inactiva no se resuelve por QR; liberar se permite';

    -- CASO 6: fila única
    v_fallo := FALSE;
    BEGIN
        INSERT INTO configuracion_restaurante (id, nombre) VALUES (2, 'Otro local');
    EXCEPTION WHEN check_violation THEN
        v_fallo := TRUE;
    END;
    IF NOT v_fallo THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: configuracion_restaurante aceptó una segunda fila.';
    END IF;
    IF (SELECT count(*) FROM configuracion_restaurante) <> 1 THEN
        RAISE EXCEPTION 'FALLÓ PRUEBA P-18: configuracion_restaurante no tiene exactamente una fila.';
    END IF;
    RAISE NOTICE 'Caso 6 OK: configuracion_restaurante tiene una sola fila';

    -- Limpieza
    DELETE FROM mesas WHERE id_mesa = v_id_mesa;
    DELETE FROM token_qr_historico WHERE id_mesa = v_id_mesa;
    DELETE FROM historial_precios
    WHERE (tipo = 'plato' AND id_referencia = v_id_plato)
       OR (tipo = 'ingrediente' AND id_referencia = v_id_ingrediente);

    RAISE NOTICE '=== PRUEBA P-18 PASADA SATISFACTORIAMENTE ===';
END;
$$;
