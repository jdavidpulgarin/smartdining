-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 37_refresh_rotado_en.sql
-- MÓDULO: Clientes · sesión de la app (D-19, contrato de #199)
-- ==============================================================================
-- El script 36 creó refresh_tokens_cliente sin la columna que el contrato de
-- #199 usa para la ventana de gracia al rotar. Este script la agrega.
--
--   rotado_en TIMESTAMPTZ NULL: cuándo se rotó el token por PRIMERA vez.
--     - Rotación normal (en una transacción): se inserta el nuevo con la misma
--       familia y el viejo queda con reemplazado_por = <nuevo> y
--       rotado_en = now(). revocado_en NO se toca: significa solo "revocado a
--       propósito" (logout, reuso o reemplazo anulado por la gracia).
--     - Ventana de gracia: se mide desde rotado_en. Si un reintento cambia
--       reemplazado_por, rotado_en NO se mueve: así la ventana no se alarga
--       reintentando.
--
-- Reglas en la base:
--   ck_refresh_rotado:          (rotado_en IS NULL) = (reemplazado_por IS NULL)
--                               (lo sugiere el contrato).
--   ck_refresh_rotado_tras_creado: rotado_en >= creado_en.
--   ck_refresh_no_se_reemplaza_a_si_mismo: reemplazado_por <> id.
--   tr_refresh_rotacion (BEFORE INSERT OR UPDATE):
--     - rotado_en, una vez puesto, no cambia ni vuelve a NULL;
--     - el reemplazo es del MISMO cliente y de la MISMA familia.
--
-- Filas de antes (si las hubiera): una ya reemplazada sin rotado_en recibe
-- COALESCE(revocado_en, creado_en) antes del CHECK. Con el 36 recién aplicado la
-- tabla está vacía; la app (D-19 parte B) aún no escribe en ella.
--
-- No se audita (decisión del 36: el hash nunca va a la auditoría).
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

ALTER TABLE refresh_tokens_cliente
    ADD COLUMN IF NOT EXISTS rotado_en TIMESTAMPTZ;

COMMENT ON COLUMN refresh_tokens_cliente.rotado_en IS
    'Cuándo se rotó por primera vez (ventana de gracia). Va con reemplazado_por y no cambia una vez puesto.';

-- Filas de antes: las ya reemplazadas quedan rotadas cuando se revocaron, o al crearse.
UPDATE refresh_tokens_cliente
   SET rotado_en = GREATEST(COALESCE(revocado_en, creado_en), creado_en)
 WHERE reemplazado_por IS NOT NULL AND rotado_en IS NULL;

-- Se recrean para que una segunda corrida deje exactamente esta versión.
ALTER TABLE refresh_tokens_cliente DROP CONSTRAINT IF EXISTS ck_refresh_rotado;
ALTER TABLE refresh_tokens_cliente
    ADD CONSTRAINT ck_refresh_rotado CHECK ((rotado_en IS NULL) = (reemplazado_por IS NULL));

ALTER TABLE refresh_tokens_cliente DROP CONSTRAINT IF EXISTS ck_refresh_rotado_tras_creado;
ALTER TABLE refresh_tokens_cliente
    ADD CONSTRAINT ck_refresh_rotado_tras_creado CHECK (rotado_en IS NULL OR rotado_en >= creado_en);

ALTER TABLE refresh_tokens_cliente DROP CONSTRAINT IF EXISTS ck_refresh_no_se_reemplaza_a_si_mismo;
ALTER TABLE refresh_tokens_cliente
    ADD CONSTRAINT ck_refresh_no_se_reemplaza_a_si_mismo CHECK (reemplazado_por IS NULL OR reemplazado_por <> id);

-- Buscar el reemplazo de un token (la gracia sigue la cadena).
CREATE INDEX IF NOT EXISTS idx_refresh_reemplazado_por
    ON refresh_tokens_cliente (reemplazado_por) WHERE reemplazado_por IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_tr_refresh_rotacion()
RETURNS TRIGGER AS $$
DECLARE
    v_cliente INTEGER;
    v_familia UUID;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.rotado_en IS NOT NULL
       AND NEW.rotado_en IS DISTINCT FROM OLD.rotado_en THEN
        RAISE EXCEPTION 'rotado_en no cambia una vez puesto (token %): la ventana de gracia no se alarga', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.reemplazado_por IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.reemplazado_por IS DISTINCT FROM OLD.reemplazado_por) THEN
        SELECT id_cliente, familia INTO v_cliente, v_familia
          FROM refresh_tokens_cliente WHERE id = NEW.reemplazado_por;
        -- Si no existe, la FK lo rechaza después con su propio error.
        IF FOUND AND (v_cliente <> NEW.id_cliente OR v_familia <> NEW.familia) THEN
            RAISE EXCEPTION 'El reemplazo del token % debe ser del mismo cliente y de la misma familia', NEW.id
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_refresh_rotacion ON refresh_tokens_cliente;
CREATE TRIGGER tr_refresh_rotacion
    BEFORE INSERT OR UPDATE ON refresh_tokens_cliente
    FOR EACH ROW EXECUTE FUNCTION fn_tr_refresh_rotacion();
