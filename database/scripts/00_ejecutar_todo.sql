-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT MASTER: 00_ejecutar_todo.sql
-- DESCRIPCIÓN: Bootstrap reproducible del esquema base y la lógica complementaria.
-- USO EN PSQL: \i 'database/scripts/00_ejecutar_todo.sql'
-- ==============================================================================

\set ON_ERROR_STOP on

\echo '===> [0/14] Ejecutando schema.sql...'
\i ../schema.sql

\echo '===> [1/14] Ejecutando 01_tablas_complementarias.sql...'
\i 01_tablas_complementarias.sql

\echo '===> [2/14] Ejecutando 02_funciones_pagos.sql...'
\i 02_funciones_pagos.sql

\echo '===> [3/14] Ejecutando 03_funciones_pedidos.sql...'
\i 03_funciones_pedidos.sql

\echo '===> [4/14] Ejecutando 04_funciones_mesas.sql...'
\i 04_funciones_mesas.sql

\echo '===> [5/14] Ejecutando 05_funciones_menu.sql...'
\i 05_funciones_menu.sql

\echo '===> [6/14] Ejecutando 06_funciones_auditoria.sql...'
\i 06_funciones_auditoria.sql

\echo '===> [7/14] Ejecutando 07_funciones_notificaciones.sql...'
\i 07_funciones_notificaciones.sql

\echo '===> [8/14] Ejecutando 08_triggers.sql...'
\i 08_triggers.sql

\echo '===> [9/14] Ejecutando 09_indices.sql...'
\i 09_indices.sql

\echo '===> [10/14] Ejecutando 10_vistas.sql...'
\i 10_vistas.sql

\echo '===> [11/14] Ejecutando 11_seed_data.sql...'
\i 11_seed_data.sql

\echo '===> [12/14] Ejecutando 12_documentacion.sql...'
\i 12_documentacion.sql

\echo '===> [13/15] Ejecutando 13_constructor.sql...'
\i 13_constructor.sql

\echo '===> [14/15] Ejecutando 14_seed_constructor.sql...'
\i 14_seed_constructor.sql

\echo '===> [15/15] Finalizando bootstrap...'
\echo '====================================================='
\echo '  SmartDining: bootstrap del esquema y scripts completado. '
