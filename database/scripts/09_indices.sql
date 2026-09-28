-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 09_indices.sql
-- MÓDULO: Índices Estratégicos Compuestos y Parciales para Alta Concurrencia
-- ==============================================================================

-- 1. ÍNDICE KDS: ÍTEMS PRIORITARIOS EN COCINA
-- Optimiza la pantalla táctil de comandas de cocina filtrando solo ítems activos.
CREATE INDEX IF NOT EXISTS idx_detalles_estado_pedido_prioritario 
ON detalles_pedido(estado_item, id_pedido, id_plato) 
WHERE estado_item IN ('pendiente', 'cocinando');

-- 2. ÍNDICE PEDIDOS: COMANDAS ACTIVAS EN SALA
-- Acelera el tablero de supervisión de meseros y caja en tiempo real.
CREATE INDEX IF NOT EXISTS idx_pedidos_estado_fecha_activos 
ON pedidos(estado, creado_en DESC) 
WHERE estado IN ('recibido', 'en_preparacion', 'listo');

-- 3. ÍNDICE TRANSACCIONES: CUADRE DE CAJA Y REPORTES FINANCIEROS
-- Agiliza la suma de ingresos y la conciliación por estado de pago.
CREATE INDEX IF NOT EXISTS idx_transacciones_estado_fecha 
ON transacciones(estado_transaccion, creado_en DESC, monto);

-- 4. ÍNDICE HISTORIAL: AUDITORÍA CRONOLÓGICA POR USUARIO
-- Soporta el análisis forense de desempeño y cambios de turno.
CREATE INDEX IF NOT EXISTS idx_historial_fecha_usuario 
ON historial_estados(fecha_cambio DESC, id_usuario);

-- 5. ÍNDICE MENÚ: PLATOS DISPONIBLES POR CATEGORÍA
-- Optimiza la carga instantánea de la carta digital en el móvil del comensal.
CREATE INDEX IF NOT EXISTS idx_platos_categoria_disponible 
ON platos(id_categoria, disponible) 
WHERE disponible = TRUE;

-- 6. ÍNDICE MESAS: ASIGNACIÓN INMEDIATA DE SALA
-- Acelera la búsqueda de mesas libres según el número de comensales entrantes.
CREATE INDEX IF NOT EXISTS idx_mesas_estado_capacidad 
ON mesas(estado, capacidad) 
WHERE estado = 'disponible';

-- 7. ÍNDICE WEB PUSH: ENDPOINTS ACTIVOS
-- En PostgreSQL los predicados de índices parciales exigen funciones IMMUTABLE (CURRENT_TIMESTAMP es volatile).
-- Se crea un índice b-tree compuesto (endpoint, creado_en DESC) que optimiza las búsquedas por ventana de 30 días.
CREATE INDEX IF NOT EXISTS idx_push_endpoint_activo 
ON suscripciones_push(endpoint, creado_en DESC);
