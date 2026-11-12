-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 35_transacciones_voucher.sql
-- MÓDULO: Pagos · cobro con tarjeta en caja
-- ==============================================================================
-- La Caja del panel pide el número de aprobación del voucher del datáfono cuando
-- se cobra con tarjeta, pero desde POST /transacciones/mesa (#167) no se
-- guardaba en ningún lado: se perdía al cerrar el recibo.
--
-- Agrega transacciones.voucher:
--   - VARCHAR(40), OPCIONAL (NULL = sin voucher). El cobro no se bloquea si el
--     datáfono no imprime.
--   - Solo con metodo_pago 'tarjeta_debito' o 'tarjeta_credito'. Efectivo,
--     transferencia y los pagos en línea (Wompi) siempre van sin voucher.
--   - Formato ^[A-Z0-9-]{1,40}$: mayúsculas, dígitos y guion. El backend recorta
--     los espacios de los extremos y pasa a mayúsculas antes de guardar; la base
--     no normaliza, solo rechaza lo que no cumple.
--
-- Un cobro de mesa se reparte en una transacción por pedido: todas llevan el
-- mismo voucher (lo escribe el backend). La auditoría de transacciones (scripts
-- 08 y 30) lo registra sola: guarda la fila completa.
--
-- Contrato (backend, Daniel): POST /transacciones/mesa acepta `voucher`
-- opcional (400 voucher_invalido / voucher_no_aplica) y GET /transacciones lo
-- devuelve. Hasta entonces la columna queda en NULL y nada cambia.
--
-- Lo aplica database/migrar.sh. Sin BEGIN/COMMIT propios. Idempotente.
-- ==============================================================================

ALTER TABLE transacciones
    ADD COLUMN IF NOT EXISTS voucher VARCHAR(40);

-- Se recrea para que una segunda corrida deje exactamente esta versión. Las
-- filas existentes tienen voucher NULL, así que se valida sin tocar datos.
ALTER TABLE transacciones DROP CONSTRAINT IF EXISTS ck_transacciones_voucher;
ALTER TABLE transacciones
    ADD CONSTRAINT ck_transacciones_voucher CHECK (
        voucher IS NULL
        OR (metodo_pago IN ('tarjeta_debito', 'tarjeta_credito')
            AND voucher ~ '^[A-Z0-9-]{1,40}$')
    );

COMMENT ON COLUMN transacciones.voucher IS
    'Número de aprobación del voucher del datáfono, opcional. Solo con tarjeta_debito o '
    'tarjeta_credito; formato ^[A-Z0-9-]{1,40}$ (el backend normaliza a mayúsculas). Script 35.';
COMMENT ON CONSTRAINT ck_transacciones_voucher ON transacciones IS
    'voucher NULL, o tarjeta (débito/crédito) con ^[A-Z0-9-]{1,40}$. Script 35.';
