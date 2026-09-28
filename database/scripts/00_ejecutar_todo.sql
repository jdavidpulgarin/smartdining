-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT MASTER: 00_ejecutar_todo.sql
-- DESCRIPCIÓN: Bootstrap reproducible del esquema base y la lógica complementaria.
-- USO EN PSQL: \i 'database/scripts/00_ejecutar_todo.sql'
-- ==============================================================================

\set ON_ERROR_STOP on

\echo '===> [0/13] Ejecutando schema.sql...'
\i ../schema.sql

\echo '===> [1/13] Ejecutando 01_tablas_complementarias.sql...'
\i 01_tablas_complementarias.sql

\echo '===> [2/13] Ejecutando 02_funciones_pagos.sql...'
\i 02_funciones_pagos.sql

\echo '===> [3/13] Ejecutando 03_funciones_pedidos.sql...'
\i 03_funciones_pedidos.sql

\echo '===> [4/13] Ejecutando 04_funciones_mesas.sql...'
\i 04_funciones_mesas.sql

\echo '===> [5/13] Ejecutando 05_funciones_menu.sql...'
\i 05_funciones_menu.sql

\echo '===> [6/13] Ejecutando 06_funciones_auditoria.sql...'
\i 06_funciones_auditoria.sql

\echo '===> [7/13] Ejecutando 07_funciones_notificaciones.sql...'
\i 07_funciones_notificaciones.sql

\echo '===> [8/13] Ejecutando 08_triggers.sql...'
\i 08_triggers.sql

\echo '===> [9/13] Ejecutando 09_indices.sql...'
\i 09_indices.sql

\echo '===> [10/13] Ejecutando 10_vistas.sql...'
\i 10_vistas.sql

\echo '===> [11/13] Ejecutando 11_seed_data.sql...'
\i 11_seed_data.sql

\echo '===> [12/13] Ejecutando 12_documentacion.sql...'
\i 12_documentacion.sql

\echo '===> [13/13] Finalizando bootstrap...'
\echo '====================================================='
\echo '  SmartDining: bootstrap del esquema y scripts completado. '
