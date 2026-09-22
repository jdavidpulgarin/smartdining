-- ==============================================================================
-- PROYECTO: SmartDining
-- MÓDULO: Base de Datos Relacional (PostgreSQL 14+)
-- AUTOR: Jarrison Pulgarin (Integrante 2 - Frontend Restaurante + Base de Datos)
-- FECHA: Septiembre 2026
-- DESCRIPCIÓN: Script DDL de creación de las 9 tablas, llaves primarias,
--              foráneas, restricciones de integridad e índices estratégicos.
-- ==============================================================================

-- 1. LIMPIEZA PREVIA (En orden inverso de dependencias por FKs)
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
-- Representación física de las mesas en sala y sus tokens QR de acceso.
-- ==============================================================================
CREATE TABLE mesas (
    id_mesa SERIAL PRIMARY KEY,
    numero INTEGER NOT NULL UNIQUE CHECK (numero > 0),
    capacidad INTEGER NOT NULL DEFAULT 4 CHECK (capacidad > 0),
    ubicacion VARCHAR(50) DEFAULT 'Principal',
    estado VARCHAR(20) NOT NULL DEFAULT 'disponible' 
        CHECK (estado IN ('disponible', 'ocupada', 'reservada', 'mantenimiento')),
    token_qr VARCHAR(64) NOT NULL UNIQUE,
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- TABLA 3: categorias
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
-- TABLA 4: platos
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
-- TABLA 5: pedidos
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
-- TABLA 6: detalles_pedido
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
-- TABLA 7: transacciones
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
-- TABLA 8: historial_estados
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
-- TABLA 9: suscripciones_push
-- Almacén de credenciales Web Push API para notificaciones en el celular.
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
-- 3. ÍNDICES ESTRATÉGICOS (Optimización para consultas de alta concurrencia)
-- ==============================================================================
CREATE INDEX idx_mesas_token ON mesas(token_qr);
CREATE INDEX idx_platos_categoria ON platos(id_categoria);
CREATE INDEX idx_pedidos_mesa ON pedidos(id_mesa);
CREATE INDEX idx_pedidos_estado ON pedidos(estado);
CREATE INDEX idx_detalles_pedido_pedido ON detalles_pedido(id_pedido);
CREATE INDEX idx_detalles_pedido_plato ON detalles_pedido(id_plato);
CREATE INDEX idx_detalles_pedido_estado ON detalles_pedido(estado_item);
CREATE INDEX idx_transacciones_pedido ON transacciones(id_pedido);
CREATE INDEX idx_historial_pedido ON historial_estados(id_pedido);
CREATE INDEX idx_push_pedido ON suscripciones_push(id_pedido);
