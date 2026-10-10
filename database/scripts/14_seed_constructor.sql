-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 14_seed_constructor.sql
-- MÓDULO: Datos Semilla para el Constructor de Platos
-- ==============================================================================

-- 1. Insertar categoría especial para los platos armables
INSERT INTO categorias (id_categoria, nombre, descripcion, orden_visualizacion, activo)
VALUES (100, 'Arma tu plato', 'Crea tu propia combinación eligiendo tus ingredientes favoritos', 1, TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- 2. Insertar platos personalizables
INSERT INTO platos (id_plato, id_categoria, nombre, descripcion, precio, tiempo_preparacion_estimado, personalizable)
VALUES 
(1001, 100, 'Bowl Personalizado', 'Arma tu bowl con base, proteína, vegetales y salsa a tu gusto.', 20000.00, 10, TRUE),
(1002, 100, 'Wrap Personalizado', 'Tu combinación favorita envuelta en tortilla de harina fresca.', 18000.00, 8, TRUE),
(1003, 100, 'Arepa Rellena', 'Auténtica arepa de maíz con los rellenos que elijas.', 15000.00, 12, TRUE)
ON CONFLICT (id_plato) DO NOTHING;

-- ==========================================
-- 3. BOWL PERSONALIZADO (id_plato = 1001)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(101, 1001, 'Elige tu Base', 1, 1, TRUE, 1),
(102, 1001, 'Elige tu Proteína', 1, 1, TRUE, 2),
(103, 1001, 'Añade Toppings', 0, 3, FALSE, 3),
(104, 1001, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Base (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(101, 'Arroz Integral', 0.00, TRUE),
(101, 'Quinoa', 2000.00, TRUE),
(101, 'Lechuga Fresca', 0.00, TRUE);

-- Proteína (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(102, 'Pollo a la Plancha', 0.00, TRUE),
(102, 'Carne Desmechada', 2500.00, TRUE),
(102, 'Falafel (Vegano)', 0.00, TRUE),
(102, 'Panceta Crujiente', 3000.00, FALSE);

-- Toppings (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(103, 'Maíz Tierno', 0.00, TRUE),
(103, 'Tomate Picado', 0.00, TRUE),
(103, 'Aguacate', 1500.00, TRUE),
(103, 'Queso Rallado', 1000.00, TRUE),
(103, 'Cebolla Caramelizada', 0.00, TRUE);

-- Salsas (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(104, 'Salsa de Ajo', 0.00, TRUE),
(104, 'Salsa Picante', 0.00, TRUE),
(104, 'Mayonesa de Cilantro', 0.00, TRUE),
(104, 'Guacamole', 2000.00, TRUE);

-- ==========================================
-- 4. WRAP PERSONALIZADO (id_plato = 1002)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(201, 1002, 'Tipo de Tortilla', 1, 1, TRUE, 1),
(202, 1002, 'Elige tu Proteína', 1, 1, TRUE, 2),
(203, 1002, 'Añade Toppings', 0, 3, FALSE, 3),
(204, 1002, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Tortilla (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(201, 'Tortilla de Harina', 0.00, TRUE),
(201, 'Tortilla Integral', 0.00, TRUE);

-- Proteína (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(202, 'Pollo a la Plancha', 0.00, TRUE),
(202, 'Carne Desmechada', 2500.00, TRUE),
(202, 'Falafel (Vegano)', 0.00, TRUE);

-- Toppings (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(203, 'Maíz Tierno', 0.00, TRUE),
(203, 'Tomate Picado', 0.00, TRUE),
(203, 'Aguacate', 1500.00, TRUE),
(203, 'Queso Rallado', 1000.00, TRUE);

-- Salsas (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(204, 'Salsa de Ajo', 0.00, TRUE),
(204, 'Salsa Picante', 0.00, TRUE),
(204, 'Mayonesa de Cilantro', 0.00, TRUE);

-- ==========================================
-- 5. AREPA RELLENA (id_plato = 1003)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(301, 1003, 'Tipo de Arepa', 1, 1, TRUE, 1),
(302, 1003, 'Elige tu Relleno Principal', 1, 1, TRUE, 2),
(303, 1003, 'Añade Extras', 0, 2, FALSE, 3),
(304, 1003, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Arepa
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(301, 'Arepa de Maíz', 0.00, TRUE),
(301, 'Arepa de Chócolo', 1500.00, TRUE);

-- Relleno Principal (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(302, 'Pollo a la Plancha', 0.00, TRUE),
(302, 'Carne Desmechada', 2500.00, TRUE),
(302, 'Panceta Crujiente', 3000.00, TRUE);

-- Extras (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(303, 'Aguacate', 1500.00, TRUE),
(303, 'Queso Rallado', 1000.00, TRUE),
(303, 'Cebolla Caramelizada', 0.00, TRUE);

-- Salsas (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, disponible) VALUES 
(304, 'Salsa de Ajo', 0.00, TRUE),
(304, 'Salsa Picante', 0.00, TRUE),
(304, 'Guacamole', 2000.00, TRUE);

-- Resetear secuencias para que los próximos INSERTs funcionen bien
SELECT setval('categorias_id_categoria_seq', (SELECT MAX(id_categoria) FROM categorias));
SELECT setval('platos_id_plato_seq', (SELECT MAX(id_plato) FROM platos));
SELECT setval('ingredientes_id_ingrediente_seq', (SELECT MAX(id_ingrediente) FROM ingredientes));
SELECT setval('pasos_constructor_id_paso_seq', (SELECT MAX(id_paso) FROM pasos_constructor));
