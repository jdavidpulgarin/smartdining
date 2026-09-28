-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 11_seed_data.sql
-- MÓDULO: Datos Semilla Iniciales para Máquina de Estados y Entorno de Desarrollo
-- ==============================================================================

-- 1. POBLAR TABLA: transiciones_validas (Máquina de estados estricta)
INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario) VALUES
('recibido', 'en_preparacion', 'Comanda tomada e iniciada por el personal de cocina en KDS', TRUE),
('en_preparacion', 'listo', 'Platos terminados y listos en barra/pase de cocina', TRUE),
('listo', 'entregado', 'Platos llevados y servidos físicamente en la mesa por el mesero', TRUE),
('entregado', 'pagado', 'Cuenta liquidada satisfactoriamente en caja o pago virtual', FALSE),
('recibido', 'cancelado', 'Pedido cancelado oportunamente antes de preparación', FALSE),
('en_preparacion', 'cancelado', 'Pedido cancelado durante preparación por falta de insumos o fuerza mayor', TRUE)
ON CONFLICT (estado_desde, estado_hacia) DO NOTHING;

-- 2. REGISTRAR HISTÓRICOS INICIALES PARA TOKENS QR BASE
INSERT INTO token_qr_historico (id_mesa, token_antiguo, fecha_invalidacion)
SELECT id_mesa, 'legacy-initial-qr-' || numero, CURRENT_TIMESTAMP
FROM mesas
ON CONFLICT DO NOTHING;

-- 3. DATOS DE AUDITORÍA INICIAL (Registro de arranque de base de datos)
INSERT INTO auditoria_cambios (
    tabla_afectada,
    operacion,
    registro_id,
    datos_anteriores,
    datos_nuevos,
    hash_verificacion
) VALUES (
    'transiciones_validas',
    'INSERT',
    1,
    NULL,
    jsonb_build_object('descripcion', 'Inicialización de la máquina de estados SmartDining'),
    md5('seed_transiciones_validas_' || clock_timestamp()::text)
);
