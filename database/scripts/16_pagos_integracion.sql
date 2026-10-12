-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 16_pagos_integracion.sql
-- MÓDULO: Soporte para Integración de Pagos en Línea, Idempotencia y Registro Forense
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. TRANSACCIONES: ÍNDICE ÚNICO PARCIAL EN referencia_externa
-- Garantiza idempotencia estricta en el registro de pagos confirmados por pasarela.
-- Si un webhook o reintento de pasarela envía la misma referencia_externa, la base
-- de datos rechaza duplicados. Solo aplica cuando referencia_externa IS NOT NULL.
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_transacciones_referencia_externa
    ON transacciones (referencia_externa)
    WHERE referencia_externa IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. INTENTOS_PAGO_FALLIDOS: SOPORTE PARA INTENTOS SIN PEDIDO Y METADATOS DE PASARELA
-- Cuando la pasarela reporta una referencia desconocida o alterada (EVENTS.md §8.5),
-- no existe id_pedido asociado. Permitimos id_pedido NULL y asociamos la mesa
-- directamente, junto con los metadatos forenses requeridos para auditoría.
-- ------------------------------------------------------------------------------

-- 2.1 Permitir id_pedido NULL (idempotente)
ALTER TABLE intentos_pago_fallidos
    ALTER COLUMN id_pedido DROP NOT NULL;

-- 2.2 Agregar columnas de auditoría y conciliación de pasarela
ALTER TABLE intentos_pago_fallidos
    ADD COLUMN IF NOT EXISTS id_mesa INTEGER,
    ADD COLUMN IF NOT EXISTS referencia_externa VARCHAR(100),
    ADD COLUMN IF NOT EXISTS id_transaccion_pasarela VARCHAR(100),
    ADD COLUMN IF NOT EXISTS pasarela VARCHAR(20),
    ADD COLUMN IF NOT EXISTS moneda VARCHAR(3);

-- 2.3 Llave foránea a mesas (id_mesa)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_intento_mesa'
    ) THEN
        ALTER TABLE intentos_pago_fallidos
            ADD CONSTRAINT fk_intento_mesa
            FOREIGN KEY (id_mesa)
            REFERENCES mesas(id_mesa)
            ON DELETE SET NULL;
    END IF;
END $$;

-- 2.4 Índices para consultas de auditoría, conciliación y alertas en tiempo real
CREATE INDEX IF NOT EXISTS idx_intentos_pago_referencia_externa
    ON intentos_pago_fallidos (referencia_externa)
    WHERE referencia_externa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intentos_pago_mesa
    ON intentos_pago_fallidos (id_mesa)
    WHERE id_mesa IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intentos_pago_transaccion_pasarela
    ON intentos_pago_fallidos (id_transaccion_pasarela)
    WHERE id_transaccion_pasarela IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. DOCUMENTACIÓN DEL CATÁLOGO
-- ------------------------------------------------------------------------------
COMMENT ON INDEX uq_transacciones_referencia_externa IS 'Garantiza idempotencia en el procesamiento de transacciones externas de pasarela.';
COMMENT ON COLUMN intentos_pago_fallidos.id_mesa IS 'Mesa asociada al intento fallido cuando no existe pedido confirmado o la referencia es desconocida.';
COMMENT ON COLUMN intentos_pago_fallidos.referencia_externa IS 'Referencia única generada para la transacción de pago.';
COMMENT ON COLUMN intentos_pago_fallidos.id_transaccion_pasarela IS 'Identificador asignado por la pasarela de pagos (ej. Wompi).';
COMMENT ON COLUMN intentos_pago_fallidos.pasarela IS 'Nombre de la pasarela proveedora (ej. wompi).';
COMMENT ON COLUMN intentos_pago_fallidos.moneda IS 'Código ISO de la moneda de la transacción (ej. COP).';
