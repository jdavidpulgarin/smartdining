-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 36_multicanal.sql
-- TAREA: P-23 · Esquema multicanal y de domicilios (plan v1.1 §5.5)
-- ==============================================================================
-- Prepara la base para pedidos PARA LLEVAR y a DOMICILIO, además de los de mesa.
-- Diseño aprobado por Jarrinson (jue 12 nov 2026), sobre la propuesta de Daniel
-- en #199. Todo es aditivo: un pedido de mesa funciona EXACTAMENTE igual.
--
--   1. usuarios.rol admite 'repartidor'.
--   2. clientes, direcciones, zonas_envio (por barrios, sin mapa) y
--      refresh_tokens_cliente (sesión de la app; NUEVA, no estaba en el plan).
--   3. configuracion_restaurante.minutos_pago_anticipado (15 por defecto).
--   4. pedidos: canal ('mesa' | 'para_llevar' | 'domicilio'), id_mesa opcional,
--      id_cliente; estado nuevo 'por_pagar' (pago anticipado) con sus dos
--      transiciones. Reglas en la base:
--        - canal 'mesa'  <=> tiene mesa; los otros canales nunca tienen mesa;
--        - para_llevar y domicilio exigen cliente registrado;
--        - 'por_pagar' solo fuera de la mesa;
--        - el canal no cambia después de crear el pedido.
--   5. pedidos_domicilio: copia de la dirección al momento del pedido, zona,
--      costo de envío, repartidor y estado de la entrega. Todo pedido a
--      domicilio la tiene (se comprueba al COMMIT) y solo ellos.
--   6. El ENVÍO VA DENTRO DEL TOTAL (pagos, saldo y estado_pago funcionan sin
--      cambios) y queda además guardado aparte en pedidos_domicilio.costo_envio
--      para que los reportes separen ventas de envíos.
--   7. Inventario (script 27): la reserva no cambia (se hace al crear el pedido,
--      también en 'por_pagar'). Al cancelar un pedido que estaba en 'por_pagar'
--      el stock VUELVE (devolución), igual que desde 'recibido': nunca llegó a
--      cocina. Antes cualquier estado distinto de 'recibido' contaba como merma.
--   8. Pago anticipado y vencimiento, sin carreras:
--        - registrar_pago_anticipado(): bloquea el pedido (FOR UPDATE) y solo
--          pasa por_pagar -> recibido si sigue en 'por_pagar'. Un pago que llega
--          tarde (pedido ya cancelado) o por otro monto NO se pierde: queda en
--          pagos_por_devolver, marcado para devolución. Idempotente por
--          referencia.
--        - cancelar_por_pagar_vencidos(): cancela solo lo que SIGUE en
--          'por_pagar' y salta lo que otro tiene bloqueado (SKIP LOCKED).
--        - cancelar_pedido_por_pagar(): la cancelación del cliente, con la misma
--          guarda.
--      Así por_pagar -> recibido y por_pagar -> cancelado nunca pasan los dos.
--   9. obtener_pedidos_activos() y generar_comprobante_pago() con LEFT JOIN a
--      mesas: un pedido sin mesa ya no desaparece. La cocina sigue viendo solo
--      desde 'recibido' ('por_pagar' no sale).
--
-- No se auditan clientes ni refresh_tokens_cliente con la fila completa: la
-- auditoría copiaría el hash de la clave y los tokens.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ROL REPARTIDOR
-- ------------------------------------------------------------------------------
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_rol_check
    CHECK (rol IN ('admin', 'mesero', 'cajero', 'cocina', 'repartidor'));

-- ------------------------------------------------------------------------------
-- 2a. CLIENTES (la app; separados de usuarios, que es el personal)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clientes (
    id_cliente      SERIAL PRIMARY KEY,
    nombre          VARCHAR(80)  NOT NULL,
    email           VARCHAR(254) NOT NULL,
    telefono        VARCHAR(20),
    password_hash   VARCHAR(60)  NOT NULL,
    verificado      BOOLEAN      NOT NULL DEFAULT FALSE,
    activo          BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_clientes_nombre   CHECK (char_length(btrim(nombre)) BETWEEN 1 AND 80),
    -- Misma forma que el correo del local (scripts 29 y 34), sin espacios Unicode.
    CONSTRAINT ck_clientes_email    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$'
                                           AND NOT fn_tiene_espacio(email)),
    CONSTRAINT ck_clientes_telefono CHECK (telefono IS NULL OR telefono ~ '^\+?[0-9]{7,15}$'),
    -- bcrypt ($2a$/$2b$/$2y$ + costo): nunca una clave en texto plano.
    CONSTRAINT ck_clientes_hash     CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_email ON clientes (lower(email));

COMMENT ON TABLE clientes IS
    'Clientes de la app (para llevar y domicilio). No se borran si tienen pedidos: se '
    'desactivan (activo). No se auditan con la fila completa (password_hash). Script 36.';

-- ------------------------------------------------------------------------------
-- 2b. DIRECCIONES DEL CLIENTE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direcciones (
    id_direccion  SERIAL PRIMARY KEY,
    id_cliente    INTEGER      NOT NULL REFERENCES clientes(id_cliente) ON DELETE CASCADE,
    direccion     VARCHAR(200) NOT NULL,
    barrio        VARCHAR(80)  NOT NULL,
    referencia    VARCHAR(200),
    lat           NUMERIC(9,6),
    lng           NUMERIC(9,6),
    principal     BOOLEAN      NOT NULL DEFAULT FALSE,
    creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_direcciones_direccion   CHECK (char_length(btrim(direccion)) > 0),
    CONSTRAINT ck_direcciones_barrio      CHECK (char_length(btrim(barrio)) > 0),
    CONSTRAINT ck_direcciones_lat         CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
    CONSTRAINT ck_direcciones_lng         CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
    CONSTRAINT ck_direcciones_coordenadas CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_direcciones_cliente ON direcciones (id_cliente);
-- Una sola principal por cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_direcciones_principal ON direcciones (id_cliente) WHERE principal;

-- ------------------------------------------------------------------------------
-- 2c. ZONAS DE ENVÍO (primera versión: por barrios, sin mapa)
-- ------------------------------------------------------------------------------
-- Clave de un barrio para compararlo: sin espacios de más (también Unicode, como
-- fn_tiene_espacio), sin tildes y en minúsculas. "Centro  Histórico" y
-- "centro historico" son el mismo barrio. NULL si queda vacío.
CREATE OR REPLACE FUNCTION fn_clave_barrio(p_barrio TEXT)
RETURNS TEXT AS $$
    SELECT NULLIF(lower(translate(
               btrim(regexp_replace(p_barrio,
                     '[\t\n\v\f\r    -     　﻿]+', ' ', 'g')),
               'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
               'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')), '')
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION fn_clave_barrio(TEXT) IS
    'Clave de comparación de un barrio: espacios normalizados, sin tildes, en minúsculas. Script 36.';

CREATE TABLE IF NOT EXISTS zonas_envio (
    id_zona              SERIAL PRIMARY KEY,
    nombre               VARCHAR(80)   NOT NULL UNIQUE,
    barrios              TEXT[]        NOT NULL DEFAULT '{}',
    costo_envio          NUMERIC(10,2) NOT NULL,
    tiempo_estimado_min  INTEGER       NOT NULL,
    activa               BOOLEAN       NOT NULL DEFAULT TRUE,
    creado_en            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_zonas_costo  CHECK (costo_envio >= 0),
    CONSTRAINT ck_zonas_tiempo CHECK (tiempo_estimado_min BETWEEN 1 AND 600)
);
CREATE INDEX IF NOT EXISTS idx_zonas_activa ON zonas_envio (activa);

-- Barrios de una zona: no vacíos, sin repetirse en la zona y, si la zona está
-- activa, sin estar en OTRA zona activa (si no, cotizar sería ambiguo). Un
-- candado de transacción serializa las escrituras de zonas: dos altas a la vez
-- no pueden colar el mismo barrio.
CREATE OR REPLACE FUNCTION fn_tr_validar_zona_envio()
RETURNS TRIGGER AS $$
DECLARE
    v_clave TEXT;
    v_otra  TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('zonas_envio'));

    IF EXISTS (SELECT 1 FROM unnest(NEW.barrios) b WHERE fn_clave_barrio(b) IS NULL) THEN
        RAISE EXCEPTION 'La zona "%" tiene un barrio vacío', NEW.nombre USING ERRCODE = 'check_violation';
    END IF;

    SELECT fn_clave_barrio(b) INTO v_clave
      FROM unnest(NEW.barrios) b
     GROUP BY fn_clave_barrio(b) HAVING count(*) > 1 LIMIT 1;
    IF v_clave IS NOT NULL THEN
        RAISE EXCEPTION 'El barrio "%" está repetido en la zona "%"', v_clave, NEW.nombre
            USING ERRCODE = 'unique_violation';
    END IF;

    IF NEW.activa THEN
        SELECT z.nombre, fn_clave_barrio(b) INTO v_otra, v_clave
          FROM zonas_envio z, unnest(z.barrios) b
         WHERE z.activa AND z.id_zona <> NEW.id_zona
           AND fn_clave_barrio(b) IN (SELECT fn_clave_barrio(n) FROM unnest(NEW.barrios) n)
         LIMIT 1;
        IF v_otra IS NOT NULL THEN
            RAISE EXCEPTION 'El barrio "%" ya está en la zona activa "%"', v_clave, v_otra
                USING ERRCODE = 'unique_violation';
        END IF;
    END IF;

    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_zona_envio ON zonas_envio;
CREATE TRIGGER tr_validar_zona_envio
    BEFORE INSERT OR UPDATE ON zonas_envio
    FOR EACH ROW EXECUTE FUNCTION fn_tr_validar_zona_envio();

-- La zona activa que cubre un barrio (o ninguna fila: fuera de cobertura).
CREATE OR REPLACE FUNCTION cotizar_zona(p_barrio TEXT)
RETURNS TABLE (id_zona INTEGER, nombre VARCHAR, costo_envio NUMERIC, tiempo_estimado_min INTEGER) AS $$
    SELECT z.id_zona, z.nombre, z.costo_envio, z.tiempo_estimado_min
      FROM zonas_envio z
     WHERE z.activa
       AND EXISTS (SELECT 1 FROM unnest(z.barrios) b WHERE fn_clave_barrio(b) = fn_clave_barrio(p_barrio))
     ORDER BY z.id_zona
     LIMIT 1
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------------------------
-- 2d. REFRESH TOKENS DE LA APP (contrato de #199; NUEVA respecto del plan)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens_cliente (
    id               BIGSERIAL   PRIMARY KEY,
    id_cliente       INTEGER     NOT NULL REFERENCES clientes(id_cliente) ON DELETE CASCADE,
    hash             CHAR(64)    NOT NULL UNIQUE,   -- SHA-256 en hex; nunca el token
    familia          UUID        NOT NULL,          -- la del primer login; se hereda al rotar
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_en        TIMESTAMPTZ NOT NULL,
    revocado_en      TIMESTAMPTZ,
    reemplazado_por  BIGINT REFERENCES refresh_tokens_cliente(id),
    CONSTRAINT ck_refresh_hash    CHECK (hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_refresh_vigencia CHECK (expira_en > creado_en)
);
CREATE INDEX IF NOT EXISTS idx_refresh_familia ON refresh_tokens_cliente (familia);
CREATE INDEX IF NOT EXISTS idx_refresh_cliente ON refresh_tokens_cliente (id_cliente);
CREATE INDEX IF NOT EXISTS idx_refresh_expira  ON refresh_tokens_cliente (expira_en);

-- ------------------------------------------------------------------------------
-- 3. MINUTOS PARA PAGAR UN PEDIDO ANTICIPADO (configurable desde el panel)
-- ------------------------------------------------------------------------------
ALTER TABLE configuracion_restaurante
    ADD COLUMN IF NOT EXISTS minutos_pago_anticipado SMALLINT NOT NULL DEFAULT 15;
ALTER TABLE configuracion_restaurante DROP CONSTRAINT IF EXISTS ck_configuracion_minutos_pago;
ALTER TABLE configuracion_restaurante
    ADD CONSTRAINT ck_configuracion_minutos_pago CHECK (minutos_pago_anticipado BETWEEN 5 AND 120);
COMMENT ON COLUMN configuracion_restaurante.minutos_pago_anticipado IS
    'Minutos que tiene un pedido para llevar o a domicilio en por_pagar antes de cancelarse '
    '(cancelar_por_pagar_vencidos). De 5 a 120, 15 por defecto. Script 36.';

-- ------------------------------------------------------------------------------
-- 4. PEDIDOS: CANAL, MESA OPCIONAL, CLIENTE Y 'por_pagar'
-- ------------------------------------------------------------------------------
-- Los dos ADD COLUMN no reescriben la tabla (DEFAULT constante / NULL); los
-- pedidos existentes quedan como canal 'mesa', con su mesa, y cumplen todo.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS canal VARCHAR(12) NOT NULL DEFAULT 'mesa';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS id_cliente INTEGER;
ALTER TABLE pedidos ALTER COLUMN id_mesa DROP NOT NULL;

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS fk_pedidos_cliente;
ALTER TABLE pedidos
    ADD CONSTRAINT fk_pedidos_cliente FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente) ON DELETE RESTRICT;

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_canal;
ALTER TABLE pedidos
    ADD CONSTRAINT ck_pedidos_canal CHECK (canal IN ('mesa', 'para_llevar', 'domicilio'));

-- Mesa si y solo si el canal es 'mesa'.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_canal_mesa;
ALTER TABLE pedidos
    ADD CONSTRAINT ck_pedidos_canal_mesa CHECK ((canal = 'mesa') = (id_mesa IS NOT NULL));

-- Para llevar y domicilio: cliente registrado (por ahora solo se pide desde la app).
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_canal_cliente;
ALTER TABLE pedidos
    ADD CONSTRAINT ck_pedidos_canal_cliente CHECK (canal = 'mesa' OR id_cliente IS NOT NULL);

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
ALTER TABLE pedidos
    ADD CONSTRAINT pedidos_estado_check
    CHECK (estado IN ('por_pagar', 'recibido', 'en_preparacion', 'listo', 'entregado', 'pagado', 'cancelado'));

-- 'por_pagar' es del pago anticipado: nunca en la mesa.
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS ck_pedidos_por_pagar;
ALTER TABLE pedidos
    ADD CONSTRAINT ck_pedidos_por_pagar CHECK (estado <> 'por_pagar' OR canal <> 'mesa');

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos (id_cliente) WHERE id_cliente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_por_pagar ON pedidos (creado_en) WHERE estado = 'por_pagar';

COMMENT ON COLUMN pedidos.canal IS
    'mesa (QR o mesero), para_llevar o domicilio (app). No cambia después de crear el pedido. Script 36.';

-- El canal no cambia: las reglas de mesa, cliente, envío y pago dependen de él.
CREATE OR REPLACE FUNCTION fn_tr_canal_inmutable()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.canal IS DISTINCT FROM OLD.canal THEN
        RAISE EXCEPTION 'El canal de un pedido no se cambia (pedido %: % -> %)', OLD.id_pedido, OLD.canal, NEW.canal
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_canal_inmutable ON pedidos;
CREATE TRIGGER tr_canal_inmutable
    BEFORE UPDATE OF canal ON pedidos
    FOR EACH ROW EXECUTE FUNCTION fn_tr_canal_inmutable();

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
VALUES ('por_pagar', 'recibido',
        'Pago anticipado aprobado: el pedido llega a cocina (registrar_pago_anticipado)', FALSE),
       ('por_pagar', 'cancelado',
        'Pago anticipado no aprobado a tiempo o cancelado por el cliente: el stock vuelve', FALSE)
ON CONFLICT (estado_desde, estado_hacia) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. PEDIDOS A DOMICILIO
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pedidos_domicilio (
    id_pedido          INTEGER       PRIMARY KEY REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    -- De dónde salió (informativo); lo que vale es la COPIA de abajo, al momento del pedido.
    id_direccion       INTEGER       REFERENCES direcciones(id_direccion) ON DELETE SET NULL,
    direccion_texto    VARCHAR(200)  NOT NULL,
    barrio             VARCHAR(80)   NOT NULL,
    referencia         VARCHAR(200),
    lat                NUMERIC(9,6),
    lng                NUMERIC(9,6),
    telefono_contacto  VARCHAR(20),
    id_zona            INTEGER       NOT NULL REFERENCES zonas_envio(id_zona) ON DELETE RESTRICT,
    -- Copia del costo al momento del pedido. Va DENTRO de pedidos.total y queda
    -- aquí aparte para que los reportes separen ventas de envíos.
    costo_envio        NUMERIC(10,2) NOT NULL,
    id_repartidor      INTEGER       REFERENCES usuarios(id_usuario) ON DELETE RESTRICT,
    estado_entrega     VARCHAR(12)   NOT NULL DEFAULT 'por_asignar',
    asignado_en        TIMESTAMPTZ,
    en_camino_en       TIMESTAMPTZ,
    entregado_en       TIMESTAMPTZ,
    fallido_en         TIMESTAMPTZ,
    motivo_fallo       VARCHAR(200),
    creado_en          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT ck_domicilio_direccion   CHECK (char_length(btrim(direccion_texto)) > 0),
    CONSTRAINT ck_domicilio_barrio      CHECK (char_length(btrim(barrio)) > 0),
    CONSTRAINT ck_domicilio_coordenadas CHECK ((lat IS NULL) = (lng IS NULL)),
    CONSTRAINT ck_domicilio_telefono    CHECK (telefono_contacto IS NULL OR telefono_contacto ~ '^\+?[0-9]{7,15}$'),
    CONSTRAINT ck_domicilio_costo       CHECK (costo_envio >= 0),
    CONSTRAINT ck_domicilio_estado      CHECK (estado_entrega IN ('por_asignar', 'asignado', 'en_camino', 'entregado', 'fallido')),
    CONSTRAINT ck_domicilio_repartidor  CHECK (estado_entrega = 'por_asignar' OR id_repartidor IS NOT NULL),
    CONSTRAINT ck_domicilio_fallo       CHECK (estado_entrega <> 'fallido' OR char_length(btrim(motivo_fallo)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_domicilio_repartidor ON pedidos_domicilio (id_repartidor) WHERE id_repartidor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_domicilio_estado ON pedidos_domicilio (estado_entrega);

-- Reglas de la fila: solo para pedidos de canal 'domicilio'; el repartidor
-- tiene que ser un usuario activo con rol 'repartidor'; una entrega terminada
-- (entregado o fallido) no vuelve atrás; las marcas de tiempo las pone la base.
CREATE OR REPLACE FUNCTION fn_tr_validar_pedido_domicilio()
RETURNS TRIGGER AS $$
DECLARE
    v_canal VARCHAR(12);
BEGIN
    SELECT canal INTO v_canal FROM pedidos WHERE id_pedido = NEW.id_pedido;
    IF v_canal IS DISTINCT FROM 'domicilio' THEN
        RAISE EXCEPTION 'El pedido % no es a domicilio (canal %)', NEW.id_pedido, COALESCE(v_canal, '?')
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.id_repartidor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM usuarios WHERE id_usuario = NEW.id_repartidor AND rol = 'repartidor' AND activo
    ) THEN
        RAISE EXCEPTION 'El usuario % no es un repartidor activo', NEW.id_repartidor
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.estado_entrega IN ('entregado', 'fallido') AND NEW.estado_entrega IS DISTINCT FROM OLD.estado_entrega THEN
            RAISE EXCEPTION 'La entrega del pedido % ya terminó (%)', NEW.id_pedido, OLD.estado_entrega
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.id_pedido <> OLD.id_pedido THEN
            RAISE EXCEPTION 'id_pedido de pedidos_domicilio no se cambia' USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' OR NEW.estado_entrega IS DISTINCT FROM OLD.estado_entrega THEN
        CASE NEW.estado_entrega
            WHEN 'asignado'  THEN NEW.asignado_en  := COALESCE(NEW.asignado_en, now());
            WHEN 'en_camino' THEN NEW.en_camino_en := COALESCE(NEW.en_camino_en, now());
            WHEN 'entregado' THEN NEW.entregado_en := COALESCE(NEW.entregado_en, now());
            WHEN 'fallido'   THEN NEW.fallido_en   := COALESCE(NEW.fallido_en, now());
            ELSE NULL;
        END CASE;
    END IF;
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_pedido_domicilio ON pedidos_domicilio;
CREATE TRIGGER tr_validar_pedido_domicilio
    BEFORE INSERT OR UPDATE ON pedidos_domicilio
    FOR EACH ROW EXECUTE FUNCTION fn_tr_validar_pedido_domicilio();

-- Todo pedido a domicilio TIENE su fila en pedidos_domicilio. Se comprueba al
-- COMMIT (diferido): el backend inserta el pedido y su domicilio en la misma
-- transacción, en cualquier orden.
CREATE OR REPLACE FUNCTION fn_tr_domicilio_completo()
RETURNS TRIGGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    v_id := CASE WHEN TG_TABLE_NAME = 'pedidos' THEN NEW.id_pedido ELSE OLD.id_pedido END;
    IF EXISTS (SELECT 1 FROM pedidos WHERE id_pedido = v_id AND canal = 'domicilio')
       AND NOT EXISTS (SELECT 1 FROM pedidos_domicilio WHERE id_pedido = v_id) THEN
        RAISE EXCEPTION 'El pedido a domicilio % no tiene dirección ni zona (pedidos_domicilio)', v_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_domicilio_completo ON pedidos;
CREATE CONSTRAINT TRIGGER tr_domicilio_completo
    AFTER INSERT ON pedidos
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_tr_domicilio_completo();

DROP TRIGGER IF EXISTS tr_domicilio_completo_borrado ON pedidos_domicilio;
CREATE CONSTRAINT TRIGGER tr_domicilio_completo_borrado
    AFTER DELETE ON pedidos_domicilio
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_tr_domicilio_completo();

-- ------------------------------------------------------------------------------
-- 6. EL ENVÍO DENTRO DEL TOTAL
-- ------------------------------------------------------------------------------
-- total = platos vivos + envío. Una sola función para los dos disparos (cambio
-- en los detalles o en el costo de envío). El script 33 recalcula estado_pago
-- cuando el total cambia.
CREATE OR REPLACE FUNCTION fn_recalcular_total_pedido(p_id_pedido INTEGER)
RETURNS VOID AS $$
    UPDATE pedidos
       SET total = COALESCE((SELECT SUM(subtotal) FROM detalles_pedido
                              WHERE id_pedido = p_id_pedido AND estado_item <> 'cancelado'), 0.00)
                 + COALESCE((SELECT costo_envio FROM pedidos_domicilio WHERE id_pedido = p_id_pedido), 0.00),
           actualizado_en = CURRENT_TIMESTAMP
     WHERE id_pedido = p_id_pedido;
$$ LANGUAGE sql;

-- Misma firma y mismo disparador que el script 08 (tr_actualizar_total_pedido);
-- solo suma el envío.
CREATE OR REPLACE FUNCTION fn_tr_actualizar_total_pedido()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_total_pedido(CASE WHEN TG_OP = 'DELETE' THEN OLD.id_pedido ELSE NEW.id_pedido END);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_tr_total_por_envio()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM fn_recalcular_total_pedido(CASE WHEN TG_OP = 'DELETE' THEN OLD.id_pedido ELSE NEW.id_pedido END);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_total_por_envio ON pedidos_domicilio;
CREATE TRIGGER tr_total_por_envio
    AFTER INSERT OR DELETE OR UPDATE OF costo_envio ON pedidos_domicilio
    FOR EACH ROW EXECUTE FUNCTION fn_tr_total_por_envio();

-- ------------------------------------------------------------------------------
-- 7. INVENTARIO: 'por_pagar' devuelve como 'recibido' (nunca llegó a cocina)
-- ------------------------------------------------------------------------------
-- Las dos funciones son las del script 27; solo se agrega 'por_pagar' a los
-- estados en los que cancelar es DEVOLUCIÓN y no merma.
CREATE OR REPLACE FUNCTION fn_tr_devolver_inventario()
RETURNS TRIGGER AS $$
DECLARE
    v_estado_pedido VARCHAR(20);
BEGIN
    SELECT estado INTO v_estado_pedido FROM pedidos WHERE id_pedido = NEW.id_pedido;
    PERFORM fn_cerrar_reserva_detalle(
        NEW.id_detalle,
        OLD.estado_item <> 'pendiente' OR v_estado_pedido NOT IN ('por_pagar', 'recibido', 'cancelado')
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_tr_devolver_inventario_pedido()
RETURNS TRIGGER AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT dp.id_detalle, dp.estado_item FROM detalles_pedido dp
             WHERE dp.id_pedido = NEW.id_pedido ORDER BY dp.id_detalle LOOP
        PERFORM fn_cerrar_reserva_detalle(
            r.id_detalle,
            OLD.estado NOT IN ('por_pagar', 'recibido') OR r.estado_item IN ('cocinando', 'listo', 'servido')
        );
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 8. PAGO ANTICIPADO Y VENCIMIENTO, SIN CARRERAS
-- ------------------------------------------------------------------------------
-- Un pago que no puede aplicarse (pedido ya cancelado, ya no en por_pagar, u
-- otro monto) NO se pierde: queda aquí hasta que el personal lo devuelva.
CREATE TABLE IF NOT EXISTS pagos_por_devolver (
    id                  SERIAL        PRIMARY KEY,
    id_pedido           INTEGER       NOT NULL REFERENCES pedidos(id_pedido) ON DELETE RESTRICT,
    referencia_externa  VARCHAR(100)  NOT NULL UNIQUE,
    metodo_pago         VARCHAR(20)   NOT NULL,
    monto               NUMERIC(10,2) NOT NULL,
    motivo              VARCHAR(30)   NOT NULL,
    estado_pedido       VARCHAR(20)   NOT NULL,   -- cómo estaba el pedido cuando llegó el pago
    creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    devuelto_en         TIMESTAMPTZ,
    devuelto_por        INTEGER       REFERENCES usuarios(id_usuario) ON DELETE RESTRICT,
    nota                VARCHAR(200),
    CONSTRAINT ck_por_devolver_monto  CHECK (monto > 0),
    CONSTRAINT ck_por_devolver_motivo CHECK (motivo IN ('pedido_cancelado', 'pedido_no_por_pagar', 'monto_distinto')),
    CONSTRAINT ck_por_devolver_cierre CHECK ((devuelto_en IS NULL) = (devuelto_por IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_por_devolver_pendientes ON pagos_por_devolver (creado_en) WHERE devuelto_en IS NULL;

-- Es dinero: se audita como transacciones.
DROP TRIGGER IF EXISTS tr_auditar_pagos_por_devolver ON pagos_por_devolver;
CREATE TRIGGER tr_auditar_pagos_por_devolver
    AFTER INSERT OR UPDATE OR DELETE ON pagos_por_devolver
    FOR EACH ROW EXECUTE FUNCTION fn_tr_auditar_cambios();

COMMENT ON TABLE pagos_por_devolver IS
    'Pagos anticipados aprobados que no se aplicaron (pedido ya cancelado o fuera de por_pagar, '
    'u otro monto): quedan marcados para devolución, nunca se pierden. Script 36.';

/**
 * Aplica un pago anticipado aprobado (el webhook de la pasarela, vía backend).
 * Resultado:
 *   'confirmado'   el pedido seguía en por_pagar y el monto es su total: se
 *                  registra la transacción y pasa a 'recibido' (llega a cocina);
 *   'por_devolver' el pedido ya no está en por_pagar (cancelado por vencimiento,
 *                  etc.) o el monto no coincide: queda en pagos_por_devolver;
 *   'duplicado'    esa referencia ya se procesó (reintento del webhook).
 * Bloquea el pedido (FOR UPDATE): con cancelar_por_pagar_vencidos y
 * cancelar_pedido_por_pagar, las dos salidas de 'por_pagar' son excluyentes.
 */
CREATE OR REPLACE FUNCTION registrar_pago_anticipado(
    p_id_pedido   INTEGER,
    p_monto       NUMERIC,
    p_metodo      VARCHAR,
    p_referencia  VARCHAR
)
RETURNS TABLE (resultado TEXT, transaccion INTEGER, por_devolver INTEGER) AS $$
DECLARE
    v_estado  VARCHAR(20);
    v_total   NUMERIC(10,2);
    v_id      INTEGER;
    v_motivo  VARCHAR(30);
BEGIN
    IF p_referencia IS NULL OR btrim(p_referencia) = '' THEN
        RAISE EXCEPTION 'registrar_pago_anticipado: la referencia es obligatoria' USING ERRCODE = 'check_violation';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN
        RAISE EXCEPTION 'registrar_pago_anticipado: monto inválido (%)', p_monto USING ERRCODE = 'check_violation';
    END IF;

    SELECT p.estado, p.total INTO v_estado, v_total
      FROM pedidos p WHERE p.id_pedido = p_id_pedido
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pedido % no existe', p_id_pedido USING ERRCODE = 'no_data_found';
    END IF;

    -- Idempotente: la misma referencia no se procesa dos veces.
    SELECT t.id_transaccion INTO v_id FROM transacciones t WHERE t.referencia_externa = p_referencia;
    IF FOUND THEN
        RETURN QUERY SELECT 'duplicado'::TEXT, v_id, NULL::INTEGER;
        RETURN;
    END IF;
    SELECT d.id INTO v_id FROM pagos_por_devolver d WHERE d.referencia_externa = p_referencia;
    IF FOUND THEN
        RETURN QUERY SELECT 'duplicado'::TEXT, NULL::INTEGER, v_id;
        RETURN;
    END IF;

    IF v_estado = 'por_pagar' AND p_monto = v_total THEN
        -- Cinco argumentos: con cuatro, procesar_pago es ambigua (dos sobrecargas).
        v_id := procesar_pago(p_id_pedido, p_metodo, p_monto, p_referencia, NULL);
        UPDATE pedidos SET estado = 'recibido' WHERE id_pedido = p_id_pedido AND estado = 'por_pagar';
        INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
        VALUES (p_id_pedido, NULL, 'por_pagar', 'recibido', format('Pago anticipado aprobado (%s)', p_referencia));
        RETURN QUERY SELECT 'confirmado'::TEXT, v_id, NULL::INTEGER;
        RETURN;
    END IF;

    v_motivo := CASE
        WHEN v_estado = 'cancelado' THEN 'pedido_cancelado'
        WHEN v_estado <> 'por_pagar' THEN 'pedido_no_por_pagar'
        ELSE 'monto_distinto'
    END;
    INSERT INTO pagos_por_devolver (id_pedido, referencia_externa, metodo_pago, monto, motivo, estado_pedido)
    VALUES (p_id_pedido, p_referencia, p_metodo, p_monto, v_motivo, v_estado)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT 'por_devolver'::TEXT, NULL::INTEGER, v_id;
END;
$$ LANGUAGE plpgsql;

-- Minutos efectivos: el parámetro, o los de configuracion_restaurante, o 15.
CREATE OR REPLACE FUNCTION fn_minutos_pago_anticipado(p_minutos INTEGER DEFAULT NULL)
RETURNS INTEGER AS $$
    SELECT COALESCE(p_minutos,
                    (SELECT minutos_pago_anticipado FROM configuracion_restaurante WHERE id = 1),
                    15)
$$ LANGUAGE sql STABLE;

/**
 * Cancela los pedidos que siguen en 'por_pagar' después de N minutos (N: el
 * parámetro o configuracion_restaurante.minutos_pago_anticipado). La llama una
 * tarea del backend cada minuto (D-20). Devuelve los id cancelados.
 * Salta los pedidos que otra transacción tiene bloqueados (un pago en curso) y
 * solo cancela lo que SIGUE en 'por_pagar' al tomarlo: nunca cancela un pedido
 * que ya se pagó. El stock vuelve (devolución) por el trigger del 27.
 */
CREATE OR REPLACE FUNCTION cancelar_por_pagar_vencidos(p_minutos INTEGER DEFAULT NULL)
RETURNS SETOF INTEGER AS $$
DECLARE
    v_minutos INTEGER := fn_minutos_pago_anticipado(p_minutos);
    r RECORD;
BEGIN
    IF v_minutos IS NULL OR v_minutos < 1 THEN
        RAISE EXCEPTION 'cancelar_por_pagar_vencidos: minutos inválidos (%)', v_minutos USING ERRCODE = 'check_violation';
    END IF;

    FOR r IN SELECT p.id_pedido FROM pedidos p
              WHERE p.estado = 'por_pagar'
                AND p.creado_en < now() - make_interval(mins => v_minutos)
              ORDER BY p.id_pedido
                FOR UPDATE SKIP LOCKED LOOP
        UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = r.id_pedido AND estado = 'por_pagar';
        IF FOUND THEN
            INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
            VALUES (r.id_pedido, NULL, 'por_pagar', 'cancelado',
                    format('Pago anticipado no aprobado en %s minutos', v_minutos));
            RETURN NEXT r.id_pedido;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

/**
 * El cliente cancela su pedido mientras está en 'por_pagar'. TRUE si lo canceló;
 * FALSE si ya no estaba en 'por_pagar' (se pagó o venció en el mismo momento):
 * misma guarda que el vencimiento.
 */
CREATE OR REPLACE FUNCTION cancelar_pedido_por_pagar(p_id_pedido INTEGER, p_motivo VARCHAR DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
    v_estado VARCHAR(20);
BEGIN
    SELECT estado INTO v_estado FROM pedidos WHERE id_pedido = p_id_pedido FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El pedido % no existe', p_id_pedido USING ERRCODE = 'no_data_found';
    END IF;
    IF v_estado <> 'por_pagar' THEN
        RETURN FALSE;
    END IF;
    UPDATE pedidos SET estado = 'cancelado' WHERE id_pedido = p_id_pedido AND estado = 'por_pagar';
    INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
    VALUES (p_id_pedido, NULL, 'por_pagar', 'cancelado', COALESCE(NULLIF(btrim(p_motivo), ''), 'Cancelado por el cliente'));
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- 9. FUNCIONES QUE SUPONÍAN MESA: LEFT JOIN
-- ------------------------------------------------------------------------------
-- Misma firma y resultado que antes para los pedidos de mesa; un pedido sin
-- mesa sale con numero_mesa / mesa_numero NULL en vez de desaparecer.
CREATE OR REPLACE FUNCTION obtener_pedidos_activos()
RETURNS TABLE(id_pedido integer, id_mesa integer, numero_mesa integer, codigo_pedido character varying,
              estado character varying, total numeric, notas_generales text,
              minutos_transcurridos numeric, creado_en timestamp with time zone) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id_pedido,
        p.id_mesa,
        m.numero AS numero_mesa,
        p.codigo_pedido,
        p.estado,
        p.total,
        p.notas_generales,
        ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.creado_en)) / 60, 1) AS minutos_transcurridos,
        p.creado_en
    FROM pedidos p
    LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
    WHERE p.estado IN ('recibido', 'en_preparacion', 'listo')   -- 'por_pagar' no llega a cocina
    ORDER BY p.creado_en ASC;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION generar_comprobante_pago(id_transaccion_param integer)
RETURNS json AS $$
DECLARE
    v_resultado JSON;
BEGIN
    SELECT json_build_object(
        'comprobante_id', t.id_transaccion,
        'fecha_emision', t.creado_en,
        'pedido', json_build_object(
            'id_pedido', p.id_pedido,
            'codigo_pedido', p.codigo_pedido,
            'mesa_numero', m.numero,
            'total_pedido', p.total
        ),
        'pago', json_build_object(
            'monto', t.monto,
            'metodo_pago', t.metodo_pago,
            'estado', t.estado_transaccion,
            'referencia', t.referencia_externa
        ),
        'items', (
            SELECT json_agg(json_build_object(
                'plato', pl.nombre,
                'cantidad', dp.cantidad,
                'precio_unitario', dp.precio_unitario,
                'subtotal', dp.subtotal
            ))
            FROM detalles_pedido dp
            JOIN platos pl ON dp.id_plato = pl.id_plato
            WHERE dp.id_pedido = p.id_pedido
        )
    ) INTO v_resultado
    FROM transacciones t
    JOIN pedidos p ON t.id_pedido = p.id_pedido
    LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
    WHERE t.id_transaccion = id_transaccion_param;

    IF v_resultado IS NULL THEN
        RAISE EXCEPTION 'Transacción % no encontrada', id_transaccion_param;
    END IF;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;
