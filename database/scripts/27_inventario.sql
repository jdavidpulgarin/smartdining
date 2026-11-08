-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 27_inventario.sql
-- MÓDULO: Inventario real (P-19, plan v1.1 §5.2)
-- ==============================================================================
-- Separa lo que se ofrece en la carta (platos e ingredientes del constructor) de
-- lo que hay en bodega (insumos). Cada plato y cada opción tiene una receta en
-- insumos. Al confirmar un pedido se reservan los insumos en la MISMA
-- transacción; si no alcanza, se revierte el pedido entero con la lista de
-- faltantes. La disponibilidad de la carta se recalcula sola desde el stock.
--
-- Contrato con el backend (D-17), documentado en backend/docs/api-spec.md:
--   - SD001 "sin stock": lo lanza el COMMIT de la transacción que crea el
--     pedido (la reserva es un trigger diferido) o el INSERT del detalle si el
--     plato ya se sabe sin stock. DETAIL = {"faltantes":[{tipo, id, nombre,
--     id_insumo, insumo, necesita, hay}]}. El backend responde 409 SIN_STOCK.
--   - SD002 "stock negativo": registrar_movimiento_inventario. DETAIL =
--     {id_insumo, insumo, stock_actual, cantidad}. El backend responde 400.
--   - pg_notify('inventario', json): {"tipo":"disponibilidad",...} cuando cambia
--     stock_suficiente de un plato o ingrediente, y {"tipo":"stock_bajo",...}
--     cuando un insumo cruza su mínimo hacia abajo. Solo llegan si la
--     transacción se confirma.
--   - Autor de un movimiento: app.id_usuario (fn_usuario_de_sesion, script 26).
--
-- Regla del libro: SUM(movimientos.cantidad) de un insumo = su stock_actual. Por
-- eso la merma de un plato cancelado en preparación se registra con cantidad 0:
-- el stock ya se descontó en la reserva; la fila solo deja constancia.
--
-- Lo aplica database/migrar.sh. Idempotente donde es razonable.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TABLAS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insumos (
    id_insumo SERIAL PRIMARY KEY,
    nombre VARCHAR(80) NOT NULL UNIQUE,
    unidad VARCHAR(10) NOT NULL DEFAULT 'porcion'
        CHECK (unidad IN ('porcion', 'unidad', 'g', 'ml')),
    stock_actual NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Consumo base del plato por UNIDAD pedida.
CREATE TABLE IF NOT EXISTS recetas_plato (
    id_plato INTEGER NOT NULL REFERENCES platos(id_plato) ON DELETE CASCADE,
    id_insumo INTEGER NOT NULL REFERENCES insumos(id_insumo) ON DELETE RESTRICT,
    cantidad NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (id_plato, id_insumo)
);

-- Consumo de una opción del constructor en porción NORMAL.
CREATE TABLE IF NOT EXISTS recetas_ingrediente (
    id_ingrediente INTEGER NOT NULL REFERENCES ingredientes(id_ingrediente) ON DELETE CASCADE,
    id_insumo INTEGER NOT NULL REFERENCES insumos(id_insumo) ON DELETE RESTRICT,
    cantidad NUMERIC(10,2) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (id_ingrediente, id_insumo)
);

CREATE TABLE IF NOT EXISTS factores_porcion (
    porcion VARCHAR(10) PRIMARY KEY CHECK (porcion IN ('ligera', 'normal', 'extra')),
    factor NUMERIC(4,2) NOT NULL CHECK (factor > 0)
);
INSERT INTO factores_porcion (porcion, factor)
VALUES ('ligera', 0.5), ('normal', 1), ('extra', 1.5)
ON CONFLICT (porcion) DO NOTHING;

CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id SERIAL PRIMARY KEY,
    id_insumo INTEGER NOT NULL REFERENCES insumos(id_insumo) ON DELETE RESTRICT,
    tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('entrada', 'ajuste', 'merma', 'reserva', 'devolucion')),
    cantidad NUMERIC(12,2) NOT NULL,
    stock_resultante NUMERIC(12,2) NOT NULL CHECK (stock_resultante >= 0),
    id_detalle INTEGER REFERENCES detalles_pedido(id_detalle) ON DELETE SET NULL,
    id_usuario INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
    motivo TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_movimientos_insumo_fecha ON movimientos_inventario (id_insumo, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos_inventario (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_movimientos_detalle ON movimientos_inventario (id_detalle) WHERE id_detalle IS NOT NULL;
-- Guardas de idempotencia en la propia base: una reserva y un cierre
-- (devolución o merma) por detalle e insumo, nunca dos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimiento_reserva
    ON movimientos_inventario (id_detalle, id_insumo) WHERE tipo = 'reserva';
CREATE UNIQUE INDEX IF NOT EXISTS uq_movimiento_cierre
    ON movimientos_inventario (id_detalle, id_insumo) WHERE tipo IN ('devolucion', 'merma') AND id_detalle IS NOT NULL;

-- disponible sigue siendo el interruptor MANUAL de la cocina; stock_suficiente
-- lo calcula la base. Lo que ve el comensal es disponible AND stock_suficiente.
ALTER TABLE platos ADD COLUMN IF NOT EXISTS stock_suficiente BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE ingredientes ADD COLUMN IF NOT EXISTS stock_suficiente BOOLEAN NOT NULL DEFAULT TRUE;

-- ------------------------------------------------------------------------------
-- 2. VISTAS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_carta_disponible AS
SELECT 'plato'::VARCHAR(12) AS tipo, p.id_plato AS id, p.nombre::VARCHAR(120) AS nombre,
       p.disponible, p.stock_suficiente,
       (p.disponible AND p.stock_suficiente) AS disponible_efectivo,
       CASE WHEN NOT p.disponible THEN 'manual' WHEN NOT p.stock_suficiente THEN 'stock' END::VARCHAR(10) AS motivo,
       EXISTS (SELECT 1 FROM recetas_plato r WHERE r.id_plato = p.id_plato) AS tiene_receta
FROM platos p
UNION ALL
SELECT 'ingrediente', i.id_ingrediente, i.nombre::VARCHAR(120),
       i.disponible, i.stock_suficiente,
       (i.disponible AND i.stock_suficiente),
       CASE WHEN NOT i.disponible THEN 'manual' WHEN NOT i.stock_suficiente THEN 'stock' END::VARCHAR(10),
       EXISTS (SELECT 1 FROM recetas_ingrediente r WHERE r.id_ingrediente = i.id_ingrediente)
FROM ingredientes i;

CREATE OR REPLACE VIEW v_stock_bajo AS
SELECT s.id_insumo, s.nombre, s.unidad, s.stock_actual, s.stock_minimo,
       (s.stock_actual = 0) AS agotado
FROM insumos s
WHERE s.activo AND s.stock_actual <= s.stock_minimo;

-- ------------------------------------------------------------------------------
-- 3. CONSUMO DE UN DETALLE
-- ------------------------------------------------------------------------------
-- Receta del plato × cantidad + Σ receta de cada opción × factor de su porción
-- × cantidad. Un plato u opción sin receta no consume nada (no controla stock).
CREATE OR REPLACE FUNCTION fn_consumo_detalle(id_detalle_param INTEGER)
RETURNS TABLE (id_insumo INTEGER, cantidad NUMERIC) AS $$
    SELECT c.id_insumo, SUM(c.cantidad)::NUMERIC
    FROM (
        SELECT rp.id_insumo, rp.cantidad * dp.cantidad AS cantidad
        FROM detalles_pedido dp
        JOIN recetas_plato rp ON rp.id_plato = dp.id_plato
        WHERE dp.id_detalle = id_detalle_param
        UNION ALL
        SELECT ri.id_insumo, ri.cantidad * fp.factor * dp.cantidad
        FROM detalles_pedido dp
        JOIN detalles_ingredientes di ON di.id_detalle = dp.id_detalle
        JOIN recetas_ingrediente ri ON ri.id_ingrediente = di.id_ingrediente
        JOIN factores_porcion fp ON fp.porcion = di.porcion
        WHERE dp.id_detalle = id_detalle_param
    ) c
    GROUP BY c.id_insumo
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------------------------
-- 4. DISPONIBILIDAD CALCULADA
-- ------------------------------------------------------------------------------
-- Una opción alcanza si cada insumo de su receta tiene, como mínimo, lo de una
-- porción normal y está activo.
CREATE OR REPLACE FUNCTION fn_recalcular_ingrediente(id_ingrediente_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    SELECT NOT EXISTS (
        SELECT 1 FROM recetas_ingrediente ri JOIN insumos s ON s.id_insumo = ri.id_insumo
        WHERE ri.id_ingrediente = id_ingrediente_param
          AND (NOT s.activo OR s.stock_actual < ri.cantidad)
    ) INTO v_ok;

    UPDATE ingredientes SET stock_suficiente = v_ok
    WHERE id_ingrediente = id_ingrediente_param AND stock_suficiente IS DISTINCT FROM v_ok;
    RETURN v_ok;
END;
$$ LANGUAGE plpgsql;

-- Un plato alcanza si su receta alcanza para UNA unidad y, si es personalizable,
-- cada paso obligatorio (obligatorio o min_sel > 0) conserva al menos
-- GREATEST(min_sel, 1) opciones disponibles (interruptor y stock).
CREATE OR REPLACE FUNCTION fn_recalcular_plato(id_plato_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_ok BOOLEAN;
BEGIN
    SELECT NOT EXISTS (
               SELECT 1 FROM recetas_plato rp JOIN insumos s ON s.id_insumo = rp.id_insumo
               WHERE rp.id_plato = id_plato_param
                 AND (NOT s.activo OR s.stock_actual < rp.cantidad)
           )
       AND NOT EXISTS (
               SELECT 1
               FROM platos p
               JOIN pasos_constructor pc ON pc.id_plato = p.id_plato
               WHERE p.id_plato = id_plato_param
                 AND p.personalizable
                 AND (pc.obligatorio OR pc.min_sel > 0)
                 AND (SELECT count(*) FROM ingredientes i
                      WHERE i.id_paso = pc.id_paso AND i.disponible AND i.stock_suficiente)
                     < GREATEST(pc.min_sel, 1)
           )
      INTO v_ok;

    UPDATE platos SET stock_suficiente = v_ok
    WHERE id_plato = id_plato_param AND stock_suficiente IS DISTINCT FROM v_ok;
    RETURN v_ok;
END;
$$ LANGUAGE plpgsql;

-- Tras un cambio de stock o de estado de un insumo: primero las opciones que lo
-- usan (sus cambios recalculan sus platos por trigger), luego los platos.
CREATE OR REPLACE FUNCTION fn_recalcular_disponibilidad(id_insumo_param INTEGER)
RETURNS VOID AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT ri.id_ingrediente FROM recetas_ingrediente ri
             WHERE ri.id_insumo = id_insumo_param ORDER BY ri.id_ingrediente LOOP
        PERFORM fn_recalcular_ingrediente(r.id_ingrediente);
    END LOOP;
    FOR r IN SELECT rp.id_plato FROM recetas_plato rp
             WHERE rp.id_insumo = id_insumo_param ORDER BY rp.id_plato LOOP
        PERFORM fn_recalcular_plato(r.id_plato);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Para el arranque del backend (si estuvo caído mientras cambió el stock):
-- recalcula toda la carta. Devuelve cuántos platos y opciones cambiaron.
CREATE OR REPLACE FUNCTION fn_recalcular_toda_la_carta()
RETURNS INTEGER AS $$
DECLARE
    r RECORD;
    v_cambios INTEGER := 0;
    v_antes BOOLEAN;
BEGIN
    FOR r IN SELECT id_ingrediente, stock_suficiente FROM ingredientes ORDER BY id_ingrediente LOOP
        IF fn_recalcular_ingrediente(r.id_ingrediente) IS DISTINCT FROM r.stock_suficiente THEN
            v_cambios := v_cambios + 1;
        END IF;
    END LOOP;
    FOR r IN SELECT id_plato FROM platos ORDER BY id_plato LOOP
        SELECT stock_suficiente INTO v_antes FROM platos WHERE id_plato = r.id_plato;
        IF fn_recalcular_plato(r.id_plato) IS DISTINCT FROM v_antes THEN
            v_cambios := v_cambios + 1;
        END IF;
    END LOOP;
    RETURN v_cambios;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 5. AVISOS (pg_notify) Y RECÁLCULO POR TRIGGERS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_tr_insumo_stock()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_insumo_actualizado ON insumos;
CREATE TRIGGER tr_insumo_actualizado
    BEFORE UPDATE ON insumos
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_insumo_stock();

CREATE OR REPLACE FUNCTION fn_tr_insumo_recalcular()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_disponibilidad(NEW.id_insumo);

    -- Cruza el mínimo hacia abajo (no en cada movimiento): aviso de stock bajo.
    IF NEW.activo
       AND NEW.stock_actual <= NEW.stock_minimo
       AND (OLD.stock_actual > OLD.stock_minimo OR NOT OLD.activo) THEN
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

DROP TRIGGER IF EXISTS tr_insumo_recalcular ON insumos;
CREATE TRIGGER tr_insumo_recalcular
    AFTER UPDATE OF stock_actual, activo ON insumos
    FOR EACH ROW
    WHEN (OLD.stock_actual IS DISTINCT FROM NEW.stock_actual OR OLD.activo IS DISTINCT FROM NEW.activo)
    EXECUTE FUNCTION fn_tr_insumo_recalcular();

CREATE OR REPLACE FUNCTION fn_tr_receta_plato()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_plato(CASE WHEN TG_OP = 'DELETE' THEN OLD.id_plato ELSE NEW.id_plato END);
    IF TG_OP = 'UPDATE' AND OLD.id_plato <> NEW.id_plato THEN
        PERFORM fn_recalcular_plato(OLD.id_plato);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_receta_plato ON recetas_plato;
CREATE TRIGGER tr_receta_plato
    AFTER INSERT OR UPDATE OR DELETE ON recetas_plato
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_receta_plato();

CREATE OR REPLACE FUNCTION fn_tr_receta_ingrediente()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_ingrediente(CASE WHEN TG_OP = 'DELETE' THEN OLD.id_ingrediente ELSE NEW.id_ingrediente END);
    IF TG_OP = 'UPDATE' AND OLD.id_ingrediente <> NEW.id_ingrediente THEN
        PERFORM fn_recalcular_ingrediente(OLD.id_ingrediente);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_receta_ingrediente ON recetas_ingrediente;
CREATE TRIGGER tr_receta_ingrediente
    AFTER INSERT OR UPDATE OR DELETE ON recetas_ingrediente
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_receta_ingrediente();

-- Una opción que cambia (interruptor o stock) puede dejar sin opciones a un
-- paso obligatorio: se recalcula su plato.
CREATE OR REPLACE FUNCTION fn_tr_ingrediente_recalcular_plato()
RETURNS TRIGGER AS $$
DECLARE
    v_id_plato INTEGER;
BEGIN
    SELECT pc.id_plato INTO v_id_plato FROM pasos_constructor pc WHERE pc.id_paso = NEW.id_paso;
    IF v_id_plato IS NOT NULL THEN
        PERFORM fn_recalcular_plato(v_id_plato);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_ingrediente_recalcular_plato ON ingredientes;
CREATE TRIGGER tr_ingrediente_recalcular_plato
    AFTER UPDATE OF disponible, stock_suficiente ON ingredientes
    FOR EACH ROW
    WHEN (OLD.disponible IS DISTINCT FROM NEW.disponible OR OLD.stock_suficiente IS DISTINCT FROM NEW.stock_suficiente)
    EXECUTE FUNCTION fn_tr_ingrediente_recalcular_plato();

-- Aviso solo cuando cambia lo CALCULADO (stock_suficiente). El interruptor
-- manual ya lo avisa el backend (plato:/ingrediente:disponibilidad); avisarlo
-- también aquí lo duplicaría.
CREATE OR REPLACE FUNCTION fn_tr_notificar_disponibilidad()
RETURNS TRIGGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'platos' THEN
        v_id := NEW.id_plato;
    ELSE
        v_id := NEW.id_ingrediente;
    END IF;
    PERFORM pg_notify('inventario', json_build_object(
        'tipo', 'disponibilidad',
        'entidad', CASE WHEN TG_TABLE_NAME = 'platos' THEN 'plato' ELSE 'ingrediente' END,
        'id', v_id,
        'disponible', (NEW.disponible AND NEW.stock_suficiente),
        'motivo', CASE WHEN NOT NEW.disponible THEN 'manual' WHEN NOT NEW.stock_suficiente THEN 'stock' END
    )::TEXT);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_notificar_stock_plato ON platos;
CREATE TRIGGER tr_notificar_stock_plato
    AFTER UPDATE OF stock_suficiente ON platos
    FOR EACH ROW
    WHEN (OLD.stock_suficiente IS DISTINCT FROM NEW.stock_suficiente)
    EXECUTE FUNCTION fn_tr_notificar_disponibilidad();

DROP TRIGGER IF EXISTS tr_notificar_stock_ingrediente ON ingredientes;
CREATE TRIGGER tr_notificar_stock_ingrediente
    AFTER UPDATE OF stock_suficiente ON ingredientes
    FOR EACH ROW
    WHEN (OLD.stock_suficiente IS DISTINCT FROM NEW.stock_suficiente)
    EXECUTE FUNCTION fn_tr_notificar_disponibilidad();

-- ------------------------------------------------------------------------------
-- 6. FALTANTES (formato común de SD001)
-- ------------------------------------------------------------------------------
-- Para un pedido y sus necesidades por insumo, arma la lista de qué plato u
-- opción usa cada insumo que no alcanza (es lo que la app deja quitar).
CREATE OR REPLACE FUNCTION fn_faltantes_pedido(id_pedido_param INTEGER, necesidades JSONB)
RETURNS JSONB AS $$
    SELECT COALESCE(jsonb_agg(f ORDER BY f->>'id_insumo', f->>'tipo', f->>'id'), '[]'::jsonb)
    FROM (
        SELECT DISTINCT jsonb_build_object(
                   'tipo', x.tipo, 'id', x.id, 'nombre', x.nombre,
                   'id_insumo', s.id_insumo, 'insumo', s.nombre,
                   'necesita', (n.value)::NUMERIC, 'hay', CASE WHEN s.activo THEN s.stock_actual ELSE 0 END
               ) AS f
        FROM jsonb_each_text(necesidades) n
        JOIN insumos s ON s.id_insumo = n.key::INTEGER
        JOIN LATERAL (
            SELECT 'plato'::TEXT AS tipo, pl.id_plato AS id, pl.nombre::TEXT AS nombre
            FROM detalles_pedido dp
            JOIN platos pl ON pl.id_plato = dp.id_plato
            JOIN recetas_plato rp ON rp.id_plato = dp.id_plato AND rp.id_insumo = s.id_insumo
            WHERE dp.id_pedido = id_pedido_param AND dp.estado_item <> 'cancelado'
            UNION
            SELECT 'ingrediente', i.id_ingrediente, i.nombre::TEXT
            FROM detalles_pedido dp
            JOIN detalles_ingredientes di ON di.id_detalle = dp.id_detalle
            JOIN ingredientes i ON i.id_ingrediente = di.id_ingrediente
            JOIN recetas_ingrediente ri ON ri.id_ingrediente = i.id_ingrediente AND ri.id_insumo = s.id_insumo
            WHERE dp.id_pedido = id_pedido_param AND dp.estado_item <> 'cancelado'
        ) x ON TRUE
        WHERE NOT s.activo OR s.stock_actual < (n.value)::NUMERIC
    ) t
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------------------------
-- 7. RESERVA AL CONFIRMAR EL PEDIDO (trigger diferido)
-- ------------------------------------------------------------------------------
-- Corre al final de la transacción, cuando ya están insertados el detalle y sus
-- ingredientes. La PRIMERA vez que se dispara para un pedido reserva el pedido
-- ENTERO (todos sus detalles todavía sin reserva) y bloquea todos sus insumos
-- de una vez, en orden de id_insumo: así dos pedidos con varios platos nunca se
-- bloquean en orden cruzado (deadlock). Las demás filas del mismo pedido ya no
-- encuentran nada que reservar.
CREATE OR REPLACE FUNCTION fn_tr_reservar_inventario()
RETURNS TRIGGER AS $$
DECLARE
    v_necesidades JSONB;
    v_faltantes JSONB;
    r RECORD;
    v_stock NUMERIC;
BEGIN
    WITH pendientes AS (
        SELECT dp.id_detalle
        FROM detalles_pedido dp
        WHERE dp.id_pedido = NEW.id_pedido
          AND dp.estado_item <> 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM movimientos_inventario m
                          WHERE m.id_detalle = dp.id_detalle AND m.tipo = 'reserva')
    ),
    consumo AS (
        SELECT c.id_insumo, SUM(c.cantidad) AS cantidad
        FROM pendientes p, LATERAL fn_consumo_detalle(p.id_detalle) c
        GROUP BY c.id_insumo
    )
    SELECT jsonb_object_agg(id_insumo::TEXT, cantidad) INTO v_necesidades FROM consumo;

    IF v_necesidades IS NULL THEN
        RETURN NULL;  -- nada que reservar (sin receta, o ya reservado)
    END IF;

    -- Bloqueo ordenado de todos los insumos del pedido.
    PERFORM 1 FROM insumos s
    WHERE s.id_insumo IN (SELECT key::INTEGER FROM jsonb_object_keys(v_necesidades) AS key)
    ORDER BY s.id_insumo
    FOR UPDATE;

    v_faltantes := fn_faltantes_pedido(NEW.id_pedido, v_necesidades);
    IF jsonb_array_length(v_faltantes) > 0 THEN
        RAISE EXCEPTION 'Sin stock suficiente para el pedido %', NEW.id_pedido
            USING ERRCODE = 'SD001',
                  DETAIL = jsonb_build_object('faltantes', v_faltantes)::TEXT;
    END IF;

    -- Descuenta y deja una fila "reserva" por detalle e insumo (para devolver
    -- exactamente lo reservado aunque la receta cambie después).
    FOR r IN
        SELECT dp.id_detalle, c.id_insumo, c.cantidad
        FROM detalles_pedido dp, LATERAL fn_consumo_detalle(dp.id_detalle) c
        WHERE dp.id_pedido = NEW.id_pedido
          AND dp.estado_item <> 'cancelado'
          AND NOT EXISTS (SELECT 1 FROM movimientos_inventario m
                          WHERE m.id_detalle = dp.id_detalle AND m.tipo = 'reserva')
        ORDER BY c.id_insumo, dp.id_detalle
    LOOP
        UPDATE insumos SET stock_actual = stock_actual - r.cantidad
        WHERE id_insumo = r.id_insumo
        RETURNING stock_actual INTO v_stock;

        INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, stock_resultante, id_detalle, id_usuario, motivo)
        VALUES (r.id_insumo, 'reserva', -r.cantidad, v_stock, r.id_detalle, fn_usuario_de_sesion(),
                format('Pedido %s', NEW.id_pedido));
    END LOOP;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_reservar_inventario ON detalles_pedido;
CREATE CONSTRAINT TRIGGER tr_reservar_inventario
    AFTER INSERT ON detalles_pedido
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_reservar_inventario();

-- ------------------------------------------------------------------------------
-- 8. DEVOLUCIÓN O MERMA AL CANCELAR (idempotente)
-- ------------------------------------------------------------------------------
-- Cierra lo reservado de un detalle UNA sola vez: devuelve al stock si no se
-- había empezado a cocinar, o lo deja como merma (cantidad 0: ya se descontó).
-- Se basa en las filas "reserva", no en la receta actual.
CREATE OR REPLACE FUNCTION fn_cerrar_reserva_detalle(id_detalle_param INTEGER, es_merma BOOLEAN)
RETURNS INTEGER AS $$
DECLARE
    r RECORD;
    v_stock NUMERIC;
    v_filas INTEGER := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM movimientos_inventario m
               WHERE m.id_detalle = id_detalle_param AND m.tipo IN ('devolucion', 'merma')) THEN
        RETURN 0;  -- ya se cerró (por el otro trigger o por una cancelación anterior)
    END IF;

    FOR r IN
        SELECT m.id_insumo, -m.cantidad AS reservado
        FROM movimientos_inventario m
        WHERE m.id_detalle = id_detalle_param AND m.tipo = 'reserva'
        ORDER BY m.id_insumo
    LOOP
        IF es_merma THEN
            SELECT stock_actual INTO v_stock FROM insumos WHERE id_insumo = r.id_insumo FOR UPDATE;
            INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, stock_resultante, id_detalle, id_usuario, motivo)
            VALUES (r.id_insumo, 'merma', 0, v_stock, id_detalle_param, fn_usuario_de_sesion(),
                    format('Cancelado en preparación: se pierden %s ya descontados en la reserva', r.reservado));
        ELSE
            UPDATE insumos SET stock_actual = stock_actual + r.reservado
            WHERE id_insumo = r.id_insumo
            RETURNING stock_actual INTO v_stock;
            INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, stock_resultante, id_detalle, id_usuario, motivo)
            VALUES (r.id_insumo, 'devolucion', r.reservado, v_stock, id_detalle_param, fn_usuario_de_sesion(),
                    'Cancelado antes de prepararse');
        END IF;
        v_filas := v_filas + 1;
    END LOOP;
    RETURN v_filas;
END;
$$ LANGUAGE plpgsql;

-- Por ítem. El KDS trabaja por PEDIDO y no cambia estado_item, así que un ítem
-- de un pedido en preparación sigue 'pendiente': el estado del pedido también
-- decide (si ya se cocina, es merma).
CREATE OR REPLACE FUNCTION fn_tr_devolver_inventario()
RETURNS TRIGGER AS $$
DECLARE
    v_estado_pedido VARCHAR(20);
BEGIN
    SELECT estado INTO v_estado_pedido FROM pedidos WHERE id_pedido = NEW.id_pedido;
    PERFORM fn_cerrar_reserva_detalle(
        NEW.id_detalle,
        OLD.estado_item <> 'pendiente' OR v_estado_pedido NOT IN ('recibido', 'cancelado')
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_devolver_inventario ON detalles_pedido;
CREATE TRIGGER tr_devolver_inventario
    AFTER UPDATE OF estado_item ON detalles_pedido
    FOR EACH ROW
    WHEN (NEW.estado_item = 'cancelado' AND OLD.estado_item IS DISTINCT FROM 'cancelado')
    EXECUTE FUNCTION fn_tr_devolver_inventario();

-- Por pedido: es como cancela el backend (UPDATE pedidos SET estado = 'cancelado').
CREATE OR REPLACE FUNCTION fn_tr_devolver_inventario_pedido()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT dp.id_detalle, dp.estado_item FROM detalles_pedido dp
             WHERE dp.id_pedido = NEW.id_pedido ORDER BY dp.id_detalle LOOP
        PERFORM fn_cerrar_reserva_detalle(
            r.id_detalle,
            OLD.estado <> 'recibido' OR r.estado_item IN ('cocinando', 'listo', 'servido')
        );
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_devolver_inventario_pedido ON pedidos;
CREATE TRIGGER tr_devolver_inventario_pedido
    AFTER UPDATE OF estado ON pedidos
    FOR EACH ROW
    WHEN (NEW.estado = 'cancelado' AND OLD.estado IS DISTINCT FROM 'cancelado')
    EXECUTE FUNCTION fn_tr_devolver_inventario_pedido();

-- ------------------------------------------------------------------------------
-- 9. ENTRADA, AJUSTE Y MERMA MANUAL
-- ------------------------------------------------------------------------------
-- entrada: cantidad > 0 (suma) · merma: cantidad > 0 (resta) · ajuste: cantidad
-- con signo, distinta de 0. Nunca deja el stock negativo (SD002).
CREATE OR REPLACE FUNCTION registrar_movimiento_inventario(
    id_insumo_param INTEGER,
    tipo_param VARCHAR,
    cantidad_param NUMERIC,
    motivo_param TEXT DEFAULT NULL
)
RETURNS movimientos_inventario AS $$
DECLARE
    v_insumo insumos%ROWTYPE;
    v_delta NUMERIC;
    v_mov movimientos_inventario%ROWTYPE;
BEGIN
    IF tipo_param NOT IN ('entrada', 'ajuste', 'merma') THEN
        RAISE EXCEPTION 'Tipo de movimiento "%" no válido: usa entrada, ajuste o merma', tipo_param
            USING ERRCODE = 'check_violation';
    END IF;
    IF cantidad_param IS NULL OR cantidad_param = 0
       OR (tipo_param IN ('entrada', 'merma') AND cantidad_param < 0) THEN
        RAISE EXCEPTION 'Cantidad no válida para %: %', tipo_param, cantidad_param
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_insumo FROM insumos WHERE id_insumo = id_insumo_param FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El insumo % no existe', id_insumo_param USING ERRCODE = 'no_data_found';
    END IF;

    v_delta := CASE tipo_param WHEN 'merma' THEN -cantidad_param ELSE cantidad_param END;

    IF v_insumo.stock_actual + v_delta < 0 THEN
        RAISE EXCEPTION 'El movimiento dejaría "%" en negativo: hay % %', v_insumo.nombre, v_insumo.stock_actual, v_insumo.unidad
            USING ERRCODE = 'SD002',
                  DETAIL = json_build_object('id_insumo', v_insumo.id_insumo, 'insumo', v_insumo.nombre,
                                             'stock_actual', v_insumo.stock_actual, 'cantidad', v_delta)::TEXT;
    END IF;

    UPDATE insumos SET stock_actual = stock_actual + v_delta WHERE id_insumo = id_insumo_param;

    INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, stock_resultante, id_usuario, motivo)
    VALUES (id_insumo_param, tipo_param, v_delta, v_insumo.stock_actual + v_delta, fn_usuario_de_sesion(), motivo_param)
    RETURNING * INTO v_mov;
    RETURN v_mov;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 10. VALIDACIONES AL PEDIR (ajustes de 08 y 13)
-- ------------------------------------------------------------------------------
-- Plato: el interruptor manual sigue igual (con su bypass OVERRIDE_ADMIN); si
-- ya se sabe que no hay stock, SD001 de inmediato con el mismo formato que la
-- reserva, en vez de esperar al COMMIT.
CREATE OR REPLACE FUNCTION fn_tr_validar_disponibilidad_plato()
RETURNS TRIGGER AS $$
DECLARE
    v_disponible BOOLEAN;
    v_stock_suficiente BOOLEAN;
    v_nombre_plato VARCHAR(120);
    v_faltantes JSONB;
BEGIN
    SELECT disponible, stock_suficiente, nombre INTO v_disponible, v_stock_suficiente, v_nombre_plato
    FROM platos
    WHERE id_plato = NEW.id_plato;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El plato con ID % no existe', NEW.id_plato;
    END IF;

    IF NOT v_disponible THEN
        IF NEW.notas_especiales IS NOT NULL AND NEW.notas_especiales LIKE '%OVERRIDE_ADMIN%' THEN
            RETURN NEW; -- Permitir por bypass administrativo
        ELSE
            RAISE EXCEPTION 'El plato "%" no se encuentra disponible actualmente en la cocina', v_nombre_plato;
        END IF;
    END IF;

    IF NOT v_stock_suficiente THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'tipo', 'plato', 'id', NEW.id_plato, 'nombre', v_nombre_plato,
                   'id_insumo', s.id_insumo, 'insumo', s.nombre,
                   'necesita', rp.cantidad * NEW.cantidad, 'hay', CASE WHEN s.activo THEN s.stock_actual ELSE 0 END
               ) ORDER BY s.id_insumo), '[]'::jsonb)
          INTO v_faltantes
        FROM recetas_plato rp JOIN insumos s ON s.id_insumo = rp.id_insumo
        WHERE rp.id_plato = NEW.id_plato
          AND (NOT s.activo OR s.stock_actual < rp.cantidad * NEW.cantidad);

        -- Sin insumo propio que falte: lo que falta son opciones de un paso obligatorio.
        IF jsonb_array_length(v_faltantes) = 0 THEN
            v_faltantes := jsonb_build_array(jsonb_build_object(
                'tipo', 'plato', 'id', NEW.id_plato, 'nombre', v_nombre_plato,
                'id_insumo', NULL, 'insumo', NULL, 'necesita', NULL, 'hay', NULL));
        END IF;

        RAISE EXCEPTION 'El plato "%" no tiene stock suficiente', v_nombre_plato
            USING ERRCODE = 'SD001',
                  DETAIL = jsonb_build_object('faltantes', v_faltantes)::TEXT;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Opción del constructor: igual que en 13_constructor.sql, más el stock.
CREATE OR REPLACE FUNCTION fn_tr_validar_detalle_ingrediente()
RETURNS TRIGGER AS $$
DECLARE
    v_id_plato_detalle INTEGER;
    v_estado_pedido VARCHAR(20);
    v_personalizable BOOLEAN;
    v_nombre_plato VARCHAR(120);
    v_id_plato_ingrediente INTEGER;
    v_nombre_ingrediente VARCHAR(80);
    v_precio_extra DECIMAL(10,2);
    v_disponible BOOLEAN;
    v_stock_suficiente BOOLEAN;
BEGIN
    SELECT dp.id_plato, p.estado, pl.personalizable, pl.nombre
      INTO v_id_plato_detalle, v_estado_pedido, v_personalizable, v_nombre_plato
    FROM detalles_pedido dp
    JOIN pedidos p ON p.id_pedido = dp.id_pedido
    JOIN platos pl ON pl.id_plato = dp.id_plato
    WHERE dp.id_detalle = NEW.id_detalle;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El detalle de pedido % no existe', NEW.id_detalle;
    END IF;

    IF v_estado_pedido <> 'recibido' THEN
        RAISE EXCEPTION 'No se pueden cambiar los ingredientes: el pedido ya está en estado "%"', v_estado_pedido;
    END IF;

    IF NOT v_personalizable THEN
        RAISE EXCEPTION 'El plato "%" no es personalizable', v_nombre_plato;
    END IF;

    SELECT pc.id_plato, i.nombre, i.precio_extra, i.disponible, i.stock_suficiente
      INTO v_id_plato_ingrediente, v_nombre_ingrediente, v_precio_extra, v_disponible, v_stock_suficiente
    FROM ingredientes i
    JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
    WHERE i.id_ingrediente = NEW.id_ingrediente;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El ingrediente % no existe', NEW.id_ingrediente;
    END IF;

    IF v_id_plato_ingrediente <> v_id_plato_detalle THEN
        RAISE EXCEPTION 'El ingrediente "%" no pertenece al plato "%"', v_nombre_ingrediente, v_nombre_plato;
    END IF;

    IF TG_OP = 'INSERT' OR NEW.id_ingrediente <> OLD.id_ingrediente THEN
        IF NOT v_disponible THEN
            RAISE EXCEPTION 'El ingrediente "%" está agotado', v_nombre_ingrediente;
        END IF;
        IF NOT v_stock_suficiente THEN
            RAISE EXCEPTION 'El ingrediente "%" no tiene stock suficiente', v_nombre_ingrediente
                USING ERRCODE = 'SD001',
                      DETAIL = jsonb_build_object('faltantes', jsonb_build_array(jsonb_build_object(
                          'tipo', 'ingrediente', 'id', NEW.id_ingrediente, 'nombre', v_nombre_ingrediente,
                          'id_insumo', NULL, 'insumo', NULL, 'necesita', NULL, 'hay', NULL)))::TEXT;
        END IF;
    END IF;

    -- Precio congelado: si no cambia ni el ingrediente ni la porción, se conserva
    IF TG_OP = 'UPDATE'
       AND NEW.id_ingrediente = OLD.id_ingrediente
       AND NEW.porcion = OLD.porcion THEN
        NEW.precio_aplicado := OLD.precio_aplicado;
    ELSE
        NEW.precio_aplicado := CASE WHEN NEW.porcion = 'extra' THEN v_precio_extra ELSE 0.00 END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 11. MENÚ DEL COMENSAL
-- ------------------------------------------------------------------------------
-- Mismo contrato que en 13_constructor.sql (solo platos disponibles; los
-- ingredientes con su "disponible"), pero "disponible" ahora es el EFECTIVO:
-- interruptor de la cocina Y stock. Incluir los agotados con su motivo es un
-- cambio de contrato aparte (pendiente de G-06).
CREATE OR REPLACE FUNCTION obtener_menu_completo()
RETURNS JSON AS $$
BEGIN
    RETURN COALESCE((
        SELECT json_agg(
            json_build_object(
                'id_categoria', c.id_categoria,
                'categoria', c.nombre,
                'descripcion', c.descripcion,
                'orden', c.orden_visualizacion,
                'platos', COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'id_plato', p.id_plato,
                            'nombre', p.nombre,
                            'descripcion', p.descripcion,
                            'precio', p.precio,
                            'url_imagen', p.url_imagen,
                            'tiempo_estimado', p.tiempo_preparacion_estimado,
                            'personalizable', p.personalizable,
                            'calorias', p.calorias,
                            'pasos', CASE WHEN p.personalizable THEN COALESCE((
                                SELECT json_agg(
                                    json_build_object(
                                        'id_paso', pc.id_paso,
                                        'nombre', pc.nombre,
                                        'orden', pc.orden,
                                        'min_sel', pc.min_sel,
                                        'max_sel', pc.max_sel,
                                        'obligatorio', pc.obligatorio,
                                        'ingredientes', COALESCE((
                                            SELECT json_agg(
                                                json_build_object(
                                                    'id_ingrediente', i.id_ingrediente,
                                                    'nombre', i.nombre,
                                                    'precio_extra', i.precio_extra,
                                                    'calorias', i.calorias,
                                                    'alergenos', i.alergenos,
                                                    'url_imagen', i.url_imagen,
                                                    'disponible', (i.disponible AND i.stock_suficiente)
                                                ) ORDER BY i.id_ingrediente ASC
                                            )
                                            FROM ingredientes i
                                            WHERE i.id_paso = pc.id_paso
                                        ), '[]'::json)
                                    ) ORDER BY pc.orden ASC
                                )
                                FROM pasos_constructor pc
                                WHERE pc.id_plato = p.id_plato
                            ), '[]'::json) ELSE '[]'::json END
                        ) ORDER BY p.nombre ASC
                    )
                    FROM platos p
                    WHERE p.id_categoria = c.id_categoria
                      AND p.disponible = TRUE
                      AND p.stock_suficiente = TRUE
                ), '[]'::json)
            ) ORDER BY c.orden_visualizacion ASC
        )
        FROM categorias c
        WHERE c.activo = TRUE
    ), '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- 12. DOCUMENTACIÓN EMBEBIDA
-- ------------------------------------------------------------------------------
COMMENT ON TABLE insumos IS 'Lo que hay en bodega. stock_actual nunca es negativo; lo mueven la reserva de pedidos y registrar_movimiento_inventario.';
COMMENT ON TABLE recetas_plato IS 'Consumo de insumos por UNIDAD de plato. Un plato sin receta no controla inventario.';
COMMENT ON TABLE recetas_ingrediente IS 'Consumo de insumos de una opción del constructor en porción normal (se multiplica por factores_porcion).';
COMMENT ON TABLE movimientos_inventario IS 'Libro de inventario: SUM(cantidad) por insumo = stock_actual. La merma por cancelación lleva cantidad 0 (ya se descontó en la reserva).';
COMMENT ON COLUMN platos.stock_suficiente IS 'Calculado por la base (P-19). Lo que ve el comensal es disponible AND stock_suficiente.';
COMMENT ON COLUMN ingredientes.stock_suficiente IS 'Calculado por la base (P-19). Lo que ve el comensal es disponible AND stock_suficiente.';
COMMENT ON FUNCTION registrar_movimiento_inventario(INTEGER, VARCHAR, NUMERIC, TEXT) IS 'Entrada (+), merma (-) o ajuste (con signo). SD002 si dejaría el stock negativo. Autor: app.id_usuario.';
COMMENT ON FUNCTION fn_recalcular_toda_la_carta() IS 'Recalcula stock_suficiente de toda la carta. El backend la llama al arrancar.';
