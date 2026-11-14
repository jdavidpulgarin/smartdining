-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 44_excedentes_pago_en_linea.sql
-- MÓDULO: Pagos en línea de mesa · excedente (T4, socket-server/EVENTS.md §8.4 y §8.7)
-- ==============================================================================
-- HALLAZGO (T4): un pago en línea de una MESA que Wompi ya aprobó podía superar
-- lo que se debía: se canceló un plato entre la intención y el webhook, la
-- intención era de un grupo anterior, o la mesa ya no tenía cuenta. El backend
-- respondía 409 y el dinero quedaba cobrado sin registrar. Devolverlo por Wompi
-- hoy no es viable: la Caja lo devuelve en efectivo.
--
-- SOLUCIÓN: un pago aprobado nunca se rechaza. Se aplica lo que se debía y lo
-- que sobra queda en esta tabla, en la MISMA transacción SQL del registro. La
-- Caja lista los pendientes y marca cada uno como devuelto (quién y cuándo).
--
-- Es una tabla APARTE de pagos_por_devolver (script 36): esa es la de los pagos
-- ANTICIPADOS de domicilio (registrar_pago_anticipado, por pedido y en pesos) y
-- no se toca. Esta es la de los pagos en línea de mesa (por mesa y comensal, en
-- centavos).
--
-- Columnas:
--   referencia_externa      la de Wompi, UNIQUE: idempotencia del registro (un
--                           reintento del webhook no crea otra fila).
--   id_transaccion          la primera transacción aplicada de ese pago, o NULL
--                           si no se aplicó nada (todo fue excedente).
--   monto / aplicado / excedente, en centavos: monto = aplicado + excedente.
--   motivo                  por qué sobró (los cuatro casos de §8.7).
--   estado                  'pendiente' -> 'devuelto' (con quién y cuándo).
--
-- id_mesa no lleva FK a mesas: el registro de un dinero por devolver no debe
-- impedir borrar una mesa, ni desaparecer con ella.
--
-- Idempotente: se puede correr dos veces. No toca datos existentes.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS excedentes_pago_en_linea (
    id                      SERIAL PRIMARY KEY,
    id_mesa                 INTEGER NOT NULL,
    comensal                VARCHAR(40),
    referencia_externa      VARCHAR(100) NOT NULL,
    id_transaccion_pasarela VARCHAR(100),
    id_transaccion          INTEGER,
    monto_centavos          BIGINT NOT NULL,
    aplicado_centavos       BIGINT NOT NULL,
    excedente_centavos      BIGINT NOT NULL,
    motivo                  VARCHAR(30) NOT NULL,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    devuelto_por            INTEGER,
    devuelto_en             TIMESTAMPTZ,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_excedentes_referencia UNIQUE (referencia_externa),
    CONSTRAINT ck_excedentes_id_mesa CHECK (id_mesa > 0),
    CONSTRAINT ck_excedentes_comensal CHECK (comensal IS NULL OR length(btrim(comensal)) > 0),
    CONSTRAINT ck_excedentes_monto CHECK (monto_centavos > 0),
    CONSTRAINT ck_excedentes_aplicado CHECK (aplicado_centavos >= 0),
    CONSTRAINT ck_excedentes_excedente CHECK (excedente_centavos > 0),
    -- El registro cuadra con lo que cobró Wompi.
    CONSTRAINT ck_excedentes_cuadra CHECK (monto_centavos = aplicado_centavos + excedente_centavos),
    CONSTRAINT ck_excedentes_motivo
        CHECK (motivo IN ('excede_saldo_comensal', 'excede_saldo_mesa', 'sin_cuenta', 'otra_visita')),
    CONSTRAINT ck_excedentes_estado CHECK (estado IN ('pendiente', 'devuelto')),
    -- 'devuelto' exige quién y cuándo; 'pendiente' no puede tenerlos.
    CONSTRAINT ck_excedentes_devuelto CHECK (
        (estado = 'devuelto' AND devuelto_por IS NOT NULL AND devuelto_en IS NOT NULL)
        OR (estado = 'pendiente' AND devuelto_por IS NULL AND devuelto_en IS NULL)
    ),
    CONSTRAINT fk_excedentes_devuelto_por
        FOREIGN KEY (devuelto_por) REFERENCES usuarios(id_usuario) ON DELETE RESTRICT,
    -- La transacción aplicada, si la hubo. Las transacciones no se borran en la
    -- operación; si alguna vez se borrara, el registro queda sin ella.
    CONSTRAINT fk_excedentes_transaccion
        FOREIGN KEY (id_transaccion) REFERENCES transacciones(id_transaccion) ON DELETE SET NULL
);

-- La Caja lista por estado (los pendientes), del más viejo al más nuevo.
CREATE INDEX IF NOT EXISTS idx_excedentes_estado
    ON excedentes_pago_en_linea (estado, creado_en);

-- Es dinero: se audita como transacciones y pagos_por_devolver.
DROP TRIGGER IF EXISTS tr_auditar_excedentes_pago_en_linea ON excedentes_pago_en_linea;
CREATE TRIGGER tr_auditar_excedentes_pago_en_linea
    AFTER INSERT OR UPDATE OR DELETE ON excedentes_pago_en_linea
    FOR EACH ROW EXECUTE FUNCTION fn_tr_auditar_cambios();

COMMENT ON TABLE excedentes_pago_en_linea IS
    'Excedentes de pagos en línea de mesa aprobados (T4, EVENTS.md §8.7): lo que sobró de un pago que no se rechaza. La Caja lo devuelve en efectivo y lo marca devuelto. Script 44.';
