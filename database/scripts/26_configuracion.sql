-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 26_configuracion.sql
-- MÓDULO: Administración y configuración (P-18, plan v1.1 §5.1)
-- ==============================================================================
-- Contenido:
--   1. configuracion_restaurante: datos del local, UNA sola fila (id = 1).
--   2. mesas.activa: desactivar en lugar de borrar (ADR-06). Una mesa inactiva
--      no se abre ni recibe QR.
--   3. historial_precios + triggers tr_historial_precio_plato y
--      tr_historial_precio_ingrediente.
--
-- Contrato con el backend (D-16):
--   - Autor de un cambio de precio: el backend hace, dentro de la MISMA
--     transacción del UPDATE,
--         SELECT set_config('app.id_usuario', '<id_usuario>', true);
--     (equivale a SET LOCAL app.id_usuario = '<id>'; set_config admite
--     parámetros $1 y SET LOCAL no). Si no se fija, id_usuario queda NULL.
--   - GET /api/configuracion (público) expone SOLO: nombre, url_logo, moneda,
--     horario y propina_sugerida_pct.
--
-- Idempotente: se puede ejecutar dos veces sin error ni duplicados.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CONFIGURACIÓN DEL RESTAURANTE (fila única)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion_restaurante (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    nombre VARCHAR(120) NOT NULL,
    telefono VARCHAR(30),
    direccion VARCHAR(200),
    url_logo VARCHAR(255),
    horario JSONB NOT NULL DEFAULT '{}'::jsonb,
    propina_sugerida_pct NUMERIC(4,2) NOT NULL DEFAULT 10
        CHECK (propina_sugerida_pct >= 0 AND propina_sugerida_pct <= 30),
    moneda CHAR(3) NOT NULL DEFAULT 'COP' CHECK (moneda ~ '^[A-Z]{3}$'),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_por INTEGER,

    -- La fila única: cualquier INSERT con otro id choca aquí.
    CONSTRAINT ck_configuracion_fila_unica CHECK (id = 1),
    CONSTRAINT ck_configuracion_horario_objeto CHECK (jsonb_typeof(horario) = 'object'),
    CONSTRAINT fk_configuracion_actualizado_por
        FOREIGN KEY (actualizado_por)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL
);

INSERT INTO configuracion_restaurante (id, nombre, moneda, propina_sugerida_pct, horario)
VALUES (
    1,
    'SmartDining',
    'COP',
    10,
    '{
        "lunes":     {"abre": "11:00", "cierra": "22:00"},
        "martes":    {"abre": "11:00", "cierra": "22:00"},
        "miercoles": {"abre": "11:00", "cierra": "22:00"},
        "jueves":    {"abre": "11:00", "cierra": "22:00"},
        "viernes":   {"abre": "11:00", "cierra": "23:00"},
        "sabado":    {"abre": "11:00", "cierra": "23:00"},
        "domingo":   {"abre": "12:00", "cierra": "21:00"}
    }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- actualizado_en y actualizado_por se ponen solos en cada UPDATE: el backend no
-- tiene que acordarse. El autor sale de app.id_usuario, como en el historial.
CREATE OR REPLACE FUNCTION fn_tr_configuracion_actualizada()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en := CURRENT_TIMESTAMP;
    NEW.actualizado_por := COALESCE(fn_usuario_de_sesion(), NEW.actualizado_por);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 2. Autor de la transacción: app.id_usuario
-- ------------------------------------------------------------------------------
-- current_setting('app.id_usuario', true) devuelve NULL si nunca se fijó y ''
-- si se fijó en otra transacción de la misma conexión y ya terminó (pasa con el
-- pool del backend). Las dos cosas significan "sin autor". Un valor que no sea
-- un entero también se trata como sin autor, para que un descuido del backend
-- no tumbe un cambio de precio.
CREATE OR REPLACE FUNCTION fn_usuario_de_sesion()
RETURNS INTEGER AS $$
DECLARE
    v_valor TEXT := NULLIF(current_setting('app.id_usuario', true), '');
BEGIN
    IF v_valor IS NULL OR v_valor !~ '^[0-9]{1,9}$' THEN
        RETURN NULL;
    END IF;
    RETURN v_valor::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE;

DROP TRIGGER IF EXISTS tr_configuracion_actualizada ON configuracion_restaurante;
CREATE TRIGGER tr_configuracion_actualizada
    BEFORE UPDATE ON configuracion_restaurante
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_configuracion_actualizada();

-- ------------------------------------------------------------------------------
-- 3. MESAS: activa (desactivar en vez de borrar)
-- ------------------------------------------------------------------------------
ALTER TABLE mesas ADD COLUMN IF NOT EXISTS activa BOOLEAN NOT NULL DEFAULT TRUE;

-- La apertura de mesa NO pasa por una función SQL: el backend hace
-- UPDATE mesas SET token_qr = ..., estado = 'ocupada' (mesas.service.js,
-- abrirSesion/rotarQr). Por eso la regla vive en un trigger sobre la tabla y
-- cubre cualquier camino: backend, cambiar_estado_mesa, regenerar_token_qr o
-- una consulta a mano.
--
-- Rechaza en una mesa inactiva:
--   - pasar a 'ocupada' (abrirla),
--   - recibir un token_qr nuevo (generar o rotar QR).
-- Y rechaza desactivar una mesa ocupada (plan §5.1: 409 en el backend).
-- Liberarla (estado 'disponible', token_qr NULL) sí se permite siempre.
CREATE OR REPLACE FUNCTION fn_tr_validar_mesa_activa()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.activa AND NOT NEW.activa AND OLD.estado = 'ocupada' THEN
        RAISE EXCEPTION 'La mesa % está ocupada: libérala antes de desactivarla', OLD.numero
            USING ERRCODE = 'check_violation';
    END IF;

    IF NOT NEW.activa THEN
        IF NEW.estado = 'ocupada' AND OLD.estado IS DISTINCT FROM 'ocupada' THEN
            RAISE EXCEPTION 'La mesa % está inactiva y no se puede abrir', NEW.numero
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.token_qr IS NOT NULL AND NEW.token_qr IS DISTINCT FROM OLD.token_qr THEN
            RAISE EXCEPTION 'La mesa % está inactiva y no puede recibir un QR', NEW.numero
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_mesa_activa ON mesas;
CREATE TRIGGER tr_validar_mesa_activa
    BEFORE UPDATE ON mesas
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_mesa_activa();

-- Una mesa inactiva tampoco se resuelve por QR (misma firma que 04, solo se
-- agrega el filtro m.activa).
CREATE OR REPLACE FUNCTION obtener_mesa_por_qr(token_qr_param VARCHAR)
RETURNS TABLE (
    id_mesa INTEGER,
    numero INTEGER,
    capacidad INTEGER,
    ubicacion VARCHAR,
    estado VARCHAR,
    token_qr VARCHAR,
    version_control INTEGER,
    actualizado_en TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id_mesa,
        m.numero,
        m.capacidad,
        m.ubicacion,
        m.estado,
        m.token_qr,
        m.version_control,
        m.actualizado_en
    FROM mesas m
    WHERE m.token_qr = token_qr_param
      AND m.activa;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Código QR inválido o expirado';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Las mesas inactivas no se ofrecen como disponibles.
CREATE OR REPLACE FUNCTION obtener_mesas_disponibles(capacidad_minima_param INTEGER DEFAULT 1)
RETURNS TABLE (
    id_mesa INTEGER,
    numero INTEGER,
    capacidad INTEGER,
    ubicacion VARCHAR,
    estado VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id_mesa,
        m.numero,
        m.capacidad,
        m.ubicacion,
        m.estado
    FROM mesas m
    WHERE m.estado = 'disponible'
      AND m.activa
      AND m.capacidad >= capacidad_minima_param
    ORDER BY m.capacidad ASC, m.numero ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ------------------------------------------------------------------------------
-- 4. HISTORIAL DE PRECIOS
-- ------------------------------------------------------------------------------
-- id_referencia es id_plato o id_ingrediente según `tipo`. Sin FK a propósito:
-- una sola columna no puede apuntar a dos tablas, y el historial debe
-- sobrevivir aunque el plato o el ingrediente se borre.
CREATE TABLE IF NOT EXISTS historial_precios (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(12) NOT NULL CHECK (tipo IN ('plato', 'ingrediente')),
    id_referencia INTEGER NOT NULL,
    precio_anterior DECIMAL(10,2) NOT NULL,
    precio_nuevo DECIMAL(10,2) NOT NULL,
    id_usuario INTEGER,
    cambiado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_historial_precios_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_historial_precios_referencia
    ON historial_precios (tipo, id_referencia, cambiado_en DESC);

CREATE OR REPLACE FUNCTION fn_tr_historial_precio_plato()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO historial_precios (tipo, id_referencia, precio_anterior, precio_nuevo, id_usuario)
    VALUES ('plato', NEW.id_plato, OLD.precio, NEW.precio, fn_usuario_de_sesion());
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_tr_historial_precio_ingrediente()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO historial_precios (tipo, id_referencia, precio_anterior, precio_nuevo, id_usuario)
    VALUES ('ingrediente', NEW.id_ingrediente, OLD.precio_extra, NEW.precio_extra, fn_usuario_de_sesion());
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- El WHEN hace que solo se registre cuando el valor cambia de verdad: un
-- UPDATE ... SET precio = precio (o un PUT que reenvía la fila entera) no deja
-- filas vacías en el historial.
DROP TRIGGER IF EXISTS tr_historial_precio_plato ON platos;
CREATE TRIGGER tr_historial_precio_plato
    AFTER UPDATE OF precio ON platos
    FOR EACH ROW
    WHEN (OLD.precio IS DISTINCT FROM NEW.precio)
    EXECUTE FUNCTION fn_tr_historial_precio_plato();

DROP TRIGGER IF EXISTS tr_historial_precio_ingrediente ON ingredientes;
CREATE TRIGGER tr_historial_precio_ingrediente
    AFTER UPDATE OF precio_extra ON ingredientes
    FOR EACH ROW
    WHEN (OLD.precio_extra IS DISTINCT FROM NEW.precio_extra)
    EXECUTE FUNCTION fn_tr_historial_precio_ingrediente();

-- ------------------------------------------------------------------------------
-- 5. DOCUMENTACIÓN EMBEBIDA
-- ------------------------------------------------------------------------------
COMMENT ON TABLE configuracion_restaurante IS 'Datos del restaurante. Una sola fila (id = 1). GET /api/configuracion expone solo nombre, url_logo, moneda, horario y propina_sugerida_pct.';
COMMENT ON COLUMN configuracion_restaurante.horario IS 'Objeto JSON por día: {"lunes": {"abre": "HH:MM", "cierra": "HH:MM"}, ...}. Un día ausente = cerrado.';
COMMENT ON COLUMN configuracion_restaurante.actualizado_por IS 'Lo pone el trigger tr_configuracion_actualizada desde app.id_usuario.';
COMMENT ON COLUMN mesas.activa IS 'FALSE = mesa retirada (ADR-06). No se abre, no recibe QR y no aparece como disponible.';
COMMENT ON TABLE historial_precios IS 'Cambios de platos.precio y de ingredientes.precio_extra. Lo llenan los triggers tr_historial_precio_*; el autor sale de app.id_usuario (SET LOCAL).';
COMMENT ON FUNCTION fn_usuario_de_sesion() IS 'id_usuario fijado por el backend con set_config(''app.id_usuario'', id, true); NULL si no hay.';
