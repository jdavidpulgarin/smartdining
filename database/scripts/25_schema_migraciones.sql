-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 25_schema_migraciones.sql
-- MÓDULO: Migraciones versionadas (P-17)
-- ==============================================================================
-- Registro de los scripts de database/scripts/ ya aplicados a esta base. Lo
-- lee y lo escribe database/migrar.sh: aplica en orden los que no estén aquí y
-- se detiene si uno ya aplicado cambió (checksum distinto).
--
-- LÍNEA BASE: 00 a 25 se registran como aplicados con checksum NULL. Este
-- script corre dentro de 00_ejecutar_todo.sql (base nueva) o solo, sobre una
-- base cargada antes de P-17; en los dos casos los scripts 01 a 24 ya están
-- aplicados. SQL no puede leer los archivos para calcular su checksum, así que
-- migrar.sh lo "adopta" en su primera corrida (NULL -> sha256 del archivo) y
-- desde ahí lo vigila.
--
-- REGLA: un script registrado aquí NUNCA se edita. Los cambios van en uno
-- nuevo (26_..., 27_...), que solo aplica migrar.sh y que NO se agrega a
-- 00_ejecutar_todo.sql.
--
-- Idempotente: se puede ejecutar dos veces.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS schema_migraciones (
    nombre VARCHAR(200) PRIMARY KEY,
    checksum CHAR(64),
    aplicado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT ck_schema_migraciones_nombre CHECK (nombre ~ '^[0-9]{2,}_[A-Za-z0-9_]+\.sql$'),
    CONSTRAINT ck_schema_migraciones_checksum CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$')
);

INSERT INTO schema_migraciones (nombre, checksum)
VALUES
    ('00_ejecutar_todo.sql', NULL),
    ('01_tablas_complementarias.sql', NULL),
    ('02_funciones_pagos.sql', NULL),
    ('03_funciones_pedidos.sql', NULL),
    ('04_funciones_mesas.sql', NULL),
    ('05_funciones_menu.sql', NULL),
    ('06_funciones_auditoria.sql', NULL),
    ('07_funciones_notificaciones.sql', NULL),
    ('08_triggers.sql', NULL),
    ('09_indices.sql', NULL),
    ('10_vistas.sql', NULL),
    ('11_seed_data.sql', NULL),
    ('12_documentacion.sql', NULL),
    ('13_constructor.sql', NULL),
    ('14_seed_constructor.sql', NULL),
    ('15_pagos_comensal.sql', NULL),
    ('16_pagos_integracion.sql', NULL),
    ('17_sesion_mesa_cuenta.sql', NULL),
    ('18_kds_variacion_tiempo.sql', NULL),
    ('19_fix_h01_bloqueo_pedidos.sql', NULL),
    ('20_fix_h02_sesion_mesa_cuenta.sql', NULL),
    ('21_fix_h06_limites_pedido.sql', NULL),
    ('22_fix_h03_estado_pago.sql', NULL),
    ('23_fix_h08_intentos_pago_fallidos.sql', NULL),
    ('24_vistas_reportes.sql', NULL),
    ('25_schema_migraciones.sql', NULL)
ON CONFLICT (nombre) DO NOTHING;

COMMENT ON TABLE schema_migraciones IS 'Scripts de database/scripts/ aplicados a esta base. Lo administra database/migrar.sh (P-17). Un script registrado nunca se edita.';
COMMENT ON COLUMN schema_migraciones.checksum IS 'sha256 del archivo sin retornos de carro (\r). NULL = línea base pendiente de adoptar por migrar.sh.';
