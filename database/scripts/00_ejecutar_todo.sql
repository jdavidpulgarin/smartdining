-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT MASTER: 00_ejecutar_todo.sql
-- DESCRIPCIÓN: Ejecución en secuencia ordenada de todos los 12 módulos SQL
-- USO EN PSQL: \i '00_ejecutar_todo.sql'
-- ==============================================================================

\echo '===> [1/12] Ejecutando 01_tablas_complementarias.sql...'
\i 01_tablas_complementarias.sql

\echo '===> [2/12] Ejecutando 02_funciones_pagos.sql...'
\i 02_funciones_pagos.sql

\echo '===> [3/12] Ejecutando 03_funciones_pedidos.sql...'
\i 03_funciones_pedidos.sql

\echo '===> [4/12] Ejecutando 04_funciones_mesas.sql...'
\i 04_funciones_mesas.sql

\echo '===> [5/12] Ejecutando 05_funciones_menu.sql...'
\i 05_funciones_menu.sql

\echo '===> [6/12] Ejecutando 06_funciones_auditoria.sql...'
\i 06_funciones_auditoria.sql

\echo '===> [7/12] Ejecutando 07_funciones_notificaciones.sql...'
\i 07_funciones_notificaciones.sql

\echo '===> [8/12] Ejecutando 08_triggers.sql...'
\i 08_triggers.sql

\echo '===> [9/12] Ejecutando 09_indices.sql...'
\i 09_indices.sql

\echo '===> [10/12] Ejecutando 10_vistas.sql...'
\i 10_vistas.sql

\echo '===> [11/12] Ejecutando 11_seed_data.sql...'
\i 11_seed_data.sql

\echo '===> [12/12] Ejecutando 12_documentacion.sql...'
\i 12_documentacion.sql

\echo '====================================================='
\echo '  SmartDining: Todos los scripts se ejecutaron con éxito. '
\echo '====================================================='
