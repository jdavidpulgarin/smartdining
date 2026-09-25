-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 12_documentacion.sql
-- MÓDULO: Diccionario de Datos, Metadatos (COMMENT ON) y Guía de Uso
-- ==============================================================================

-- ==============================================================================
-- 1. COMENTARIOS SOBRE TABLAS
-- ==============================================================================
COMMENT ON TABLE transiciones_validas IS 'Almacena la matriz de estados legales permitidos para el flujo del pedido.';
COMMENT ON TABLE auditoria_cambios IS 'Bitácora inmutable de cambios DML para compliance, auditoría y seguridad.';
COMMENT ON TABLE kds_metricas IS 'Registro cronológico del rendimiento de preparación de platillos en cocina.';
COMMENT ON TABLE intentos_pago_fallidos IS 'Registro forense de rechazos y pagos fallidos en la pasarela o caja.';
COMMENT ON TABLE token_qr_historico IS 'Historial de tokens QR anteriores para revocación y control de accesos.';
COMMENT ON TABLE kds_alertas IS 'Alertas emitidas por retrasos significativos frente a los tiempos estimados de preparación.';

COMMENT ON VIEW v_pedidos_con_pagos IS 'Resumen consolidado de comandas con totales facturados, pagos y saldo pendiente.';
COMMENT ON VIEW v_detalles_completos IS 'Detalle de platos comandados con atributos de catálogo para visualización KDS.';
COMMENT ON VIEW v_mesas_con_pedidos IS 'Monitor en tiempo real del estado de sala, ocupación y antigüedad de órdenes.';

-- ==============================================================================
-- 2. COMENTARIOS SOBRE COLUMNAS CRÍTICAS
-- ==============================================================================
COMMENT ON COLUMN transiciones_validas.requiere_usuario IS 'Si es TRUE, la transición exige que un empleado autenticado firme la operación.';
COMMENT ON COLUMN auditoria_cambios.hash_verificacion IS 'Firma SHA-256 calculada al momento del cambio para detectar alteraciones en la bitácora.';
COMMENT ON COLUMN kds_metricas.variacion_porcentaje IS 'Diferencia porcentual entre el tiempo real registrado y el tiempo estimado del plato.';
COMMENT ON COLUMN mesas.version_control IS 'Contador para control de concurrencia optimista en modificaciones de sala.';

-- ==============================================================================
-- 3. COMENTARIOS SOBRE FUNCIONES Y EJEMPLOS DE USO
-- ==============================================================================
COMMENT ON FUNCTION crear_pedido(INTEGER, TEXT) IS 
'Genera una nueva comanda asignada a una mesa física.
Ejemplo de uso:
  SELECT crear_pedido(1, ''Cliente alérgico a los mariscos'');';

COMMENT ON FUNCTION cambiar_estado_pedido(INTEGER, VARCHAR, TEXT, INTEGER) IS 
'Aplica una transición de estado a un pedido validando reglas en transiciones_validas.
Ejemplo de uso:
  SELECT cambiar_estado_pedido(1, ''en_preparacion'', ''Comanda recibida en cocina'', 2);';

COMMENT ON FUNCTION procesar_pago(INTEGER, VARCHAR, DECIMAL, VARCHAR) IS 
'Registra un pago parcial o total para un pedido, liquidando la comanda si el saldo llega a 0.
Ejemplo de uso:
  SELECT procesar_pago(1, ''tarjeta_credito'', 70000.00, ''AUTH-9823471'');';

COMMENT ON FUNCTION obtener_mesa_por_qr(VARCHAR) IS 
'Retorna la información operativa de la mesa a partir del escaneo del token QR.
Ejemplo de uso:
  SELECT * FROM obtener_mesa_por_qr(''qr-token-mesa-01-a1b2c3d4'');';

COMMENT ON FUNCTION regenerar_token_qr(INTEGER) IS 
'Genera un nuevo token criptográfico para la mesa e invalida el anterior en el histórico.
Ejemplo de uso:
  SELECT regenerar_token_qr(1);';

COMMENT ON FUNCTION obtener_menu_completo() IS 
'Genera un JSON anidado con todas las categorías activas y sus platos disponibles.
Ejemplo de uso:
  SELECT obtener_menu_completo();';

COMMENT ON FUNCTION obtener_historial_pedido(INTEGER) IS 
'Retorna el timeline unificado de estados, cobros e incidentes de una orden.
Ejemplo de uso:
  SELECT * FROM obtener_historial_pedido(1);';

COMMENT ON FUNCTION registrar_suscripcion_push(INTEGER, VARCHAR, TEXT, TEXT, TEXT) IS 
'Registra un endpoint de notificación Web Push para un pedido o mesa.
Ejemplo de uso:
  SELECT registrar_suscripcion_push(1, ''pedido'', ''https://fcm.googleapis.com/...'', ''p256key'', ''authkey'');';

-- ==============================================================================
-- 4. GUÍA DE EJECUCIÓN DEL FLUJO COMPLETO EN PSQL
-- ==============================================================================
/*
  ORDEN RECOMENDADO DE EJECUCIÓN:
  1. schema.sql                    (Estructura base de 9 tablas)
  2. seed.sql                      (Usuarios demo, catálogo inicial, mesas)
  3. 01_tablas_complementarias.sql (Tablas de soporte, kds, auditoría)
  4. 02_funciones_pagos.sql        (Paquete pagos)
  5. 03_funciones_pedidos.sql      (Paquete pedidos)
  6. 04_funciones_mesas.sql        (Paquete mesas)
  7. 05_funciones_menu.sql         (Paquete menú)
  8. 06_funciones_auditoria.sql    (Paquete auditoría)
  9. 07_funciones_notificaciones.sql (Paquete Web Push)
  10. 08_triggers.sql              (10 disparadores automáticos)
  11. 09_indices.sql               (Índices de optimización de consultas)
  12. 10_vistas.sql                (Vistas operativas)
  13. 11_seed_data.sql             (Población de transiciones de estado)
  14. 12_documentacion.sql         (Comentarios y metadatos del catálogo)
*/
