-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 01_tablas_complementarias.sql
-- AUTOR: DBA Senior PostgreSQL
-- DESCRIPCIÓN: Extensión pgcrypto, ajuste de version_control y creación de las
--              tablas complementarias de auditoría, KDS, métricas y seguridad.
-- ==============================================================================

-- 1. EXTENSIÓN CRIPTOGRÁFICA
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. CONTROL DE CONCURRENCIA EN MESAS (Versión Optimista)
ALTER TABLE mesas 
ADD COLUMN IF NOT EXISTS version_control INTEGER NOT NULL DEFAULT 1;

-- ==============================================================================
-- TABLA A.1: transiciones_validas
-- Define la máquina de estados estricta para el ciclo de vida de los pedidos.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS transiciones_validas (
    id_transicion SERIAL PRIMARY KEY,
    estado_desde VARCHAR(20) NOT NULL,
    estado_hacia VARCHAR(20) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    requiere_usuario BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_transicion_estados UNIQUE (estado_desde, estado_hacia)
);

-- ==============================================================================
-- TABLA A.2: auditoria_cambios
-- Bitácora inmutable de auditoría para operaciones DML en tablas críticas.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS auditoria_cambios (
    id_auditoria BIGSERIAL PRIMARY KEY,
    tabla_afectada VARCHAR(60) NOT NULL,
    operacion VARCHAR(10) NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
    registro_id INTEGER,
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id INTEGER,
    ip_origen VARCHAR(45) DEFAULT '127.0.0.1',
    fecha_cambio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    hash_verificacion VARCHAR(64) NOT NULL,
    CONSTRAINT fk_auditoria_usuario 
        FOREIGN KEY (usuario_id) 
        REFERENCES usuarios(id_usuario) 
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tabla ON auditoria_cambios(tabla_afectada);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha_desc ON auditoria_cambios(fecha_cambio DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria_cambios(usuario_id);

-- ==============================================================================
-- TABLA A.3: kds_metricas
-- Métricas de rendimiento y eficiencia en cocina (Kitchen Display System).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS kds_metricas (
    id_metrica SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    id_plato INTEGER,
    tiempo_preparacion_real NUMERIC(8,2) NOT NULL CHECK (tiempo_preparacion_real >= 0),
    tiempo_preparacion_estimado INTEGER NOT NULL CHECK (tiempo_preparacion_estimado > 0),
    variacion_porcentaje NUMERIC(6,2) NOT NULL,
    fecha_metrica TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_kds_pedido 
        FOREIGN KEY (id_pedido) 
        REFERENCES pedidos(id_pedido) 
        ON DELETE CASCADE,
    CONSTRAINT fk_kds_plato 
        FOREIGN KEY (id_plato) 
        REFERENCES platos(id_plato) 
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kds_metricas_pedido ON kds_metricas(id_pedido);
CREATE INDEX IF NOT EXISTS idx_kds_metricas_fecha ON kds_metricas(fecha_metrica DESC);

-- ==============================================================================
-- TABLA A.4: intentos_pago_fallidos
-- Detección de anomalías, fraude o rechazos en pasarela de pagos.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS intentos_pago_fallidos (
    id_intento SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    id_usuario INTEGER,
    metodo_pago VARCHAR(20),
    monto DECIMAL(10,2) CHECK (monto > 0),
    razon_rechazo TEXT NOT NULL,
    ip_origen VARCHAR(45) DEFAULT '127.0.0.1',
    fecha_intento TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_intento_pedido 
        FOREIGN KEY (id_pedido) 
        REFERENCES pedidos(id_pedido) 
        ON DELETE CASCADE,
    CONSTRAINT fk_intento_usuario 
        FOREIGN KEY (id_usuario) 
        REFERENCES usuarios(id_usuario) 
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_intentos_pago_pedido ON intentos_pago_fallidos(id_pedido);
CREATE INDEX IF NOT EXISTS idx_intentos_pago_fecha ON intentos_pago_fallidos(fecha_intento DESC);

-- ==============================================================================
-- TABLA A.5: token_qr_historico
-- Almacén de tokens QR invalidados para seguridad y control de accesos previos.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS token_qr_historico (
    id_historico_token SERIAL PRIMARY KEY,
    id_mesa INTEGER NOT NULL,
    token_antiguo VARCHAR(64) NOT NULL,
    fecha_invalidacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_historico_mesa 
        FOREIGN KEY (id_mesa) 
        REFERENCES mesas(id_mesa) 
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_hist_mesa ON token_qr_historico(id_mesa);
CREATE INDEX IF NOT EXISTS idx_token_hist_antiguo ON token_qr_historico(token_antiguo);

-- ==============================================================================
-- TABLA A.6: kds_alertas
-- Alertas automáticas para demoras críticas en tiempos de cocina.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS kds_alertas (
    id_alerta SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    mensaje TEXT NOT NULL,
    variacion_porcentaje NUMERIC(6,2),
    fecha_alerta TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_kds_alertas_pedido 
        FOREIGN KEY (id_pedido) 
        REFERENCES pedidos(id_pedido) 
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kds_alertas_pedido ON kds_alertas(id_pedido);
