-- ==============================================================================
-- PROYECTO: SmartDining
-- MÓDULO: Base de Datos Relacional (PostgreSQL 14+)
-- AUTOR: Jarrison Pulgarin (Integrante 2 - Frontend Restaurante + Base de Datos)
-- FECHA: Septiembre 2026
-- DESCRIPCIÓN: Script DDL base con entidades del dominio, auditoría, métricas y
--              control de estado para el flujo de pedidos del restaurante.
-- ==============================================================================

-- 1. LIMPIEZA PREVIA (orden inverso de dependencias)
DROP TABLE IF EXISTS kds_alertas CASCADE;
DROP TABLE IF EXISTS token_qr_historico CASCADE;
DROP TABLE IF EXISTS intentos_pago_fallidos CASCADE;
DROP TABLE IF EXISTS kds_metricas CASCADE;
DROP TABLE IF EXISTS auditoria_cambios CASCADE;
DROP TABLE IF EXISTS transiciones_validas CASCADE;
DROP TABLE IF EXISTS suscripciones_push CASCADE;
DROP TABLE IF EXISTS historial_estados CASCADE;
DROP TABLE IF EXISTS transacciones CASCADE;
DROP TABLE IF EXISTS detalles_pedido CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS platos CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS mesas CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

-- 2. EXTENSIONES ÚTILES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================================
-- TABLA 1: usuarios
-- Gestiona el personal operativo y administrativo del restaurante con RBAC.
-- ==============================================================================
CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin', 'mesero', 'cajero', 'cocina')),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLA 2: mesas
-- Representación física de las mesas, estado operativo y token QR de acceso.
-- ==============================================================================
CREATE TABLE mesas (
    id_mesa SERIAL PRIMARY KEY,
    numero INTEGER NOT NULL UNIQUE CHECK (numero > 0),
    capacidad INTEGER NOT NULL DEFAULT 4 CHECK (capacidad > 0),
    ubicacion VARCHAR(50) NOT NULL DEFAULT 'Principal',
    estado VARCHAR(20) NOT NULL DEFAULT 'disponible'
        CHECK (estado IN ('disponible', 'ocupada', 'reservada', 'mantenimiento')),
    token_qr VARCHAR(255) NOT NULL UNIQUE,
    version_control INTEGER NOT NULL DEFAULT 1,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLA 3: transiciones_validas
-- Máquina de estados autorizada para pedidos.
-- ==============================================================================
CREATE TABLE transiciones_validas (
    id_transicion SERIAL PRIMARY KEY,
    estado_desde VARCHAR(20) NOT NULL,
    estado_hacia VARCHAR(20) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    requiere_usuario BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_transicion_estados UNIQUE (estado_desde, estado_hacia)
);

-- ==============================================================================
-- TABLA 4: categorias
-- Clasificación comercial para organizar los platos en la carta digital.
-- ==============================================================================
CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    descripcion TEXT,
    orden_visualizacion INTEGER NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- ==============================================================================
-- TABLA 5: platos
-- Catálogo de productos, precios y tiempos estimados para el menú.
-- ==============================================================================
CREATE TABLE platos (
    id_plato SERIAL PRIMARY KEY,
    id_categoria INTEGER NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
    url_imagen VARCHAR(255),
    disponible BOOLEAN NOT NULL DEFAULT TRUE,
    tiempo_preparacion_estimado INTEGER NOT NULL DEFAULT 15 CHECK (tiempo_preparacion_estimado > 0),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_platos_categoria
        FOREIGN KEY (id_categoria)
        REFERENCES categorias(id_categoria)
        ON DELETE RESTRICT
);

-- ==============================================================================
-- TABLA 6: pedidos
-- Cabecera de comanda por mesa en tiempo real.
-- ==============================================================================
CREATE TABLE pedidos (
    id_pedido SERIAL PRIMARY KEY,
    id_mesa INTEGER NOT NULL,
    codigo_pedido VARCHAR(16) NOT NULL UNIQUE,
    estado VARCHAR(20) NOT NULL DEFAULT 'recibido'
        CHECK (estado IN ('recibido', 'en_preparacion', 'listo', 'entregado', 'pagado', 'cancelado')),
    total DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (total >= 0),
    notas_generales TEXT,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pedidos_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES mesas(id_mesa)
        ON DELETE RESTRICT
);

-- ==============================================================================
-- TABLA 7: detalles_pedido
-- Ítems individuales dentro de cada pedido con preservación de precio histórico.
-- ==============================================================================
CREATE TABLE detalles_pedido (
    id_detalle SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    id_plato INTEGER NOT NULL,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
    subtotal DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
    notas_especiales TEXT,
    estado_item VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado_item IN ('pendiente', 'cocinando', 'listo', 'servido', 'cancelado')),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_detalles_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES pedidos(id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT fk_detalles_plato
        FOREIGN KEY (id_plato)
        REFERENCES platos(id_plato)
        ON DELETE RESTRICT
);

-- ==============================================================================
-- TABLA 8: transacciones
-- Registro de cobros, métodos de pago y liquidación de pedidos.
-- ==============================================================================
CREATE TABLE transacciones (
    id_transaccion SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    metodo_pago VARCHAR(20) NOT NULL
        CHECK (metodo_pago IN ('efectivo', 'tarjeta_debito', 'tarjeta_credito', 'transferencia', 'online')),
    monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),
    estado_transaccion VARCHAR(20) NOT NULL DEFAULT 'completada'
        CHECK (estado_transaccion IN ('pendiente', 'completada', 'fallida', 'reembolsada')),
    referencia_externa VARCHAR(100),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_transacciones_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES pedidos(id_pedido)
        ON DELETE RESTRICT
);

-- ==============================================================================
-- TABLA 9: historial_estados
-- Trazabilidad cronológica de estados para auditoría y métricas del KDS.
-- ==============================================================================
CREATE TABLE historial_estados (
    id_historial SERIAL PRIMARY KEY,
    id_pedido INTEGER NOT NULL,
    id_usuario INTEGER,
    estado_anterior VARCHAR(20),
    estado_nuevo VARCHAR(20) NOT NULL,
    observaciones TEXT,
    fecha_cambio TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_historial_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES pedidos(id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT fk_historial_usuario
        FOREIGN KEY (id_usuario)
        REFERENCES usuarios(id_usuario)
        ON DELETE SET NULL
);

-- ==============================================================================
-- TABLA 10: suscripciones_push
-- Almacén de credenciales Web Push API para notificaciones en el móvil.
-- ==============================================================================
CREATE TABLE suscripciones_push (
    id_suscripcion SERIAL PRIMARY KEY,
    id_pedido INTEGER,
    id_mesa INTEGER,
    endpoint TEXT NOT NULL UNIQUE,
    clave_p256dh TEXT NOT NULL,
    clave_auth TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_push_pedido
        FOREIGN KEY (id_pedido)
        REFERENCES pedidos(id_pedido)
        ON DELETE CASCADE,

    CONSTRAINT fk_push_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES mesas(id_mesa)
        ON DELETE SET NULL
);

-- ==============================================================================
-- TABLAS COMPLEMENTARIAS: auditoría, métricas y seguridad
-- ==============================================================================
CREATE TABLE auditoria_cambios (
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

CREATE TABLE kds_metricas (
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

CREATE TABLE intentos_pago_fallidos (
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

CREATE TABLE token_qr_historico (
    id_historico_token SERIAL PRIMARY KEY,
    id_mesa INTEGER NOT NULL,
    token_antiguo VARCHAR(255) NOT NULL,
    fecha_invalidacion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_historico_mesa
        FOREIGN KEY (id_mesa)
        REFERENCES mesas(id_mesa)
        ON DELETE CASCADE
);

CREATE TABLE kds_alertas (
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

-- ==============================================================================
-- 3. ÍNDICES ESTRATÉGICOS
-- ==============================================================================
CREATE INDEX idx_mesas_token ON mesas(token_qr);
CREATE INDEX idx_mesas_estado_capacidad ON mesas(estado, capacidad) WHERE estado = 'disponible';
CREATE INDEX idx_platos_categoria ON platos(id_categoria);
CREATE INDEX idx_platos_categoria_disponible ON platos(id_categoria, disponible) WHERE disponible = TRUE;
CREATE INDEX idx_pedidos_mesa ON pedidos(id_mesa);
CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_pedidos_estado_fecha_activos ON pedidos(estado, creado_en DESC) WHERE estado IN ('recibido', 'en_preparacion', 'listo');
CREATE INDEX idx_detalles_pedido_pedido ON detalles_pedido(id_pedido);
CREATE INDEX idx_detalles_pedido_plato ON detalles_pedido(id_plato);
CREATE INDEX idx_detalles_pedido_estado ON detalles_pedido(estado_item);
CREATE INDEX idx_detalles_estado_pedido_prioritario ON detalles_pedido(estado_item, id_pedido, id_plato) WHERE estado_item IN ('pendiente', 'cocinando');
CREATE INDEX idx_transacciones_pedido ON transacciones(id_pedido);
CREATE INDEX idx_transacciones_estado_fecha ON transacciones(estado_transaccion, creado_en DESC, monto);
CREATE INDEX idx_historial_pedido ON historial_estados(id_pedido);
CREATE INDEX idx_historial_fecha_usuario ON historial_estados(fecha_cambio DESC, id_usuario);
CREATE INDEX idx_push_pedido ON suscripciones_push(id_pedido);
CREATE INDEX idx_push_endpoint_activo ON suscripciones_push(endpoint, creado_en DESC);
CREATE INDEX idx_auditoria_tabla ON auditoria_cambios(tabla_afectada);
CREATE INDEX idx_auditoria_fecha_desc ON auditoria_cambios(fecha_cambio DESC);
CREATE INDEX idx_auditoria_usuario ON auditoria_cambios(usuario_id);
CREATE INDEX idx_kds_metricas_pedido ON kds_metricas(id_pedido);
CREATE INDEX idx_kds_metricas_fecha ON kds_metricas(fecha_metrica DESC);
CREATE INDEX idx_intentos_pago_pedido ON intentos_pago_fallidos(id_pedido);
CREATE INDEX idx_intentos_pago_fecha ON intentos_pago_fallidos(fecha_intento DESC);
CREATE INDEX idx_token_hist_mesa ON token_qr_historico(id_mesa);
CREATE INDEX idx_token_hist_antiguo ON token_qr_historico(token_antiguo);
CREATE INDEX idx_kds_alertas_pedido ON kds_alertas(id_pedido);
