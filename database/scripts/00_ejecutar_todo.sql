-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT MASTER: 00_ejecutar_todo.sql
-- DESCRIPCIÓN: Bootstrap reproducible del esquema base y la lógica complementaria.
-- USO EN PSQL: \i 'database/scripts/00_ejecutar_todo.sql'
-- ==============================================================================

\set ON_ERROR_STOP on

\echo '===> [0/18] Ejecutando schema.sql...'
\i ../schema.sql

\echo '===> [1/18] Ejecutando 01_tablas_complementarias.sql...'
\i 01_tablas_complementarias.sql

\echo '===> [2/18] Ejecutando 02_funciones_pagos.sql...'
\i 02_funciones_pagos.sql

\echo '===> [3/18] Ejecutando 03_funciones_pedidos.sql...'
\i 03_funciones_pedidos.sql

\echo '===> [4/18] Ejecutando 04_funciones_mesas.sql...'
\i 04_funciones_mesas.sql

\echo '===> [5/18] Ejecutando 05_funciones_menu.sql...'
\i 05_funciones_menu.sql

\echo '===> [6/18] Ejecutando 06_funciones_auditoria.sql...'
\i 06_funciones_auditoria.sql

\echo '===> [7/18] Ejecutando 07_funciones_notificaciones.sql...'
\i 07_funciones_notificaciones.sql

\echo '===> [8/18] Ejecutando 08_triggers.sql...'
\i 08_triggers.sql

\echo '===> [9/18] Ejecutando 09_indices.sql...'
\i 09_indices.sql

\echo '===> [10/18] Ejecutando 10_vistas.sql...'
\i 10_vistas.sql

\echo '===> [11/18] Ejecutando 11_seed_data.sql...'
\i 11_seed_data.sql

\echo '===> [12/18] Ejecutando 12_documentacion.sql...'
\i 12_documentacion.sql

\echo '===> [13/18] Ejecutando 13_constructor.sql...'
\i 13_constructor.sql

\echo '===> [14/18] Ejecutando 14_seed_constructor.sql...'
\i 14_seed_constructor.sql

\echo '===> [15/18] Ejecutando 15_pagos_comensal.sql...'
\i 15_pagos_comensal.sql

\echo '===> [16/18] Ejecutando 16_pagos_integracion.sql...'
\i 16_pagos_integracion.sql

\echo '===> [17/18] Ejecutando 17_sesion_mesa_cuenta.sql...'
\i 17_sesion_mesa_cuenta.sql

\echo '===> [18/19] Ejecutando 18_kds_variacion_tiempo.sql...'
\i 18_kds_variacion_tiempo.sql

\echo '===> [19/20] Ejecutando 19_fix_h01_bloqueo_pedidos.sql...'
\i 19_fix_h01_bloqueo_pedidos.sql

\echo '===> [20/21] Ejecutando 20_fix_h02_sesion_mesa_cuenta.sql...'
\i 20_fix_h02_sesion_mesa_cuenta.sql

\echo '===> [21/21] Ejecutando 21_fix_h06_limites_pedido.sql...'
\i 21_fix_h06_limites_pedido.sql

\echo '===> Finalizando bootstrap...'
\echo '====================================================='
\echo '  SmartDining: bootstrap del esquema y scripts completado. '




