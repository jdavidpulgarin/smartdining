-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT MASTER: 00_ejecutar_todo.sql
-- DESCRIPCIÓN: Bootstrap reproducible del esquema base, migraciones y datos semilla.
-- CONGELADO desde P-17: es la línea base (00 a 25). Los scripts 26 en adelante
-- NO se agregan aquí; los aplica database/migrar.sh. Para cargar una base nueva
-- usa migrar.sh, que corre este archivo y luego los scripts nuevos.
-- USO EN PSQL: \i 'database/scripts/00_ejecutar_todo.sql'
-- ==============================================================================

\set ON_ERROR_STOP on

\echo '===> [0/26] Ejecutando schema.sql...'
\i ../schema.sql

\echo '===> [1/26] Ejecutando 01_tablas_complementarias.sql...'
\i 01_tablas_complementarias.sql

\echo '===> [2/26] Ejecutando 02_funciones_pagos.sql...'
\i 02_funciones_pagos.sql

\echo '===> [3/26] Ejecutando 03_funciones_pedidos.sql...'
\i 03_funciones_pedidos.sql

\echo '===> [4/26] Ejecutando 04_funciones_mesas.sql...'
\i 04_funciones_mesas.sql

\echo '===> [5/26] Ejecutando 05_funciones_menu.sql...'
\i 05_funciones_menu.sql

\echo '===> [6/26] Ejecutando 06_funciones_auditoria.sql...'
\i 06_funciones_auditoria.sql

\echo '===> [7/26] Ejecutando 07_funciones_notificaciones.sql...'
\i 07_funciones_notificaciones.sql

\echo '===> [8/26] Ejecutando 08_triggers.sql...'
\i 08_triggers.sql

\echo '===> [9/26] Ejecutando 09_indices.sql...'
\i 09_indices.sql

\echo '===> [10/26] Ejecutando 10_vistas.sql...'
\i 10_vistas.sql

\echo '===> [11/26] Ejecutando 11_seed_data.sql...'
\i 11_seed_data.sql

\echo '===> [12/26] Ejecutando 12_documentacion.sql...'
\i 12_documentacion.sql

\echo '===> [13/26] Ejecutando 13_constructor.sql...'
\i 13_constructor.sql

\echo '===> [14/26] Ejecutando 14_seed_constructor.sql...'
\i 14_seed_constructor.sql

\echo '===> [15/26] Ejecutando 15_pagos_comensal.sql...'
\i 15_pagos_comensal.sql

\echo '===> [16/26] Ejecutando 16_pagos_integracion.sql...'
\i 16_pagos_integracion.sql

\echo '===> [17/26] Ejecutando 17_sesion_mesa_cuenta.sql...'
\i 17_sesion_mesa_cuenta.sql

\echo '===> [18/26] Ejecutando 18_kds_variacion_tiempo.sql...'
\i 18_kds_variacion_tiempo.sql

\echo '===> [19/26] Ejecutando 19_fix_h01_bloqueo_pedidos.sql...'
\i 19_fix_h01_bloqueo_pedidos.sql

\echo '===> [20/26] Ejecutando 20_fix_h02_sesion_mesa_cuenta.sql...'
\i 20_fix_h02_sesion_mesa_cuenta.sql

\echo '===> [21/26] Ejecutando 21_fix_h06_limites_pedido.sql...'
\i 21_fix_h06_limites_pedido.sql

\echo '===> [22/26] Ejecutando 22_fix_h03_estado_pago.sql...'
\i 22_fix_h03_estado_pago.sql

\echo '===> [23/26] Ejecutando 23_fix_h08_intentos_pago_fallidos.sql...'
\i 23_fix_h08_intentos_pago_fallidos.sql

\echo '===> [24/26] Ejecutando 24_vistas_reportes.sql...'
\i 24_vistas_reportes.sql

\echo '===> [25/26] Ejecutando 25_schema_migraciones.sql...'
\i 25_schema_migraciones.sql

\echo '===> [26/26] Ejecutando seed.sql (datos iniciales de prueba: usuarios, mesas, platos)...'
\i ../seed.sql

\echo '===> Finalizando bootstrap...'
\echo '====================================================='
\echo '  SmartDining: bootstrap del esquema y datos iniciales completado.'
