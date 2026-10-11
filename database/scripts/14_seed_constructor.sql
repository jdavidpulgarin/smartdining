-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 14_seed_constructor.sql
-- MÓDULO: Datos Semilla para el Constructor de Platos
-- ==============================================================================

-- 1. Insertar categoría especial para los platos armables (orden 0 para aparecer de primera)
INSERT INTO categorias (id_categoria, nombre, descripcion, orden_visualizacion, activo)
VALUES (100, 'Arma tu plato', 'Crea tu propia combinación eligiendo tus ingredientes favoritos', 0, TRUE)
ON CONFLICT (nombre) DO UPDATE SET orden_visualizacion = 0;

-- 2. Insertar platos personalizables con calorías base
INSERT INTO platos (id_plato, id_categoria, nombre, descripcion, precio, tiempo_preparacion_estimado, personalizable, calorias)
VALUES 
(1001, 100, 'Bowl Personalizado', 'Arma tu bowl con base, proteína, vegetales y salsa a tu gusto.', 20000.00, 10, TRUE, 450),
(1002, 100, 'Wrap Personalizado', 'Tu combinación favorita envuelta en tortilla de harina fresca.', 18000.00, 8, TRUE, 520),
(1003, 100, 'Arepa Rellena', 'Auténtica arepa de maíz con los rellenos que elijas.', 15000.00, 12, TRUE, 380)
ON CONFLICT (id_plato) DO UPDATE SET calorias = EXCLUDED.calorias;

-- ==========================================
-- 3. BOWL PERSONALIZADO (id_plato = 1001)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(101, 1001, 'Elige tu Base', 1, 1, TRUE, 1),
(102, 1001, 'Elige tu Proteína', 1, 1, TRUE, 2),
(103, 1001, 'Añade Toppings', 0, 3, FALSE, 3),
(104, 1001, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Base (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(101, 'Arroz Integral', 0.00, 180, TRUE),
(101, 'Quinoa', 2000.00, 160, TRUE),
(101, 'Lechuga Fresca', 0.00, 15, TRUE);

-- Proteína (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(102, 'Pollo a la Plancha', 0.00, 220, TRUE),
(102, 'Carne Desmechada', 2500.00, 260, TRUE),
(102, 'Falafel (Vegano)', 0.00, 190, TRUE),
(102, 'Panceta Crujiente', 3000.00, 340, FALSE);

-- Toppings (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(103, 'Maíz Tierno', 0.00, 70, TRUE),
(103, 'Tomate Picado', 0.00, 25, TRUE),
(103, 'Aguacate', 1500.00, 120, TRUE),
(103, 'Queso Rallado', 1000.00, 110, TRUE),
(103, 'Cebolla Caramelizada', 0.00, 60, TRUE);

-- Salsas (Bowl)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(104, 'Salsa de Ajo', 0.00, 90, TRUE),
(104, 'Salsa Picante', 0.00, 15, TRUE),
(104, 'Mayonesa de Cilantro', 0.00, 110, TRUE),
(104, 'Guacamole', 2000.00, 100, TRUE);

-- ==========================================
-- 4. WRAP PERSONALIZADO (id_plato = 1002)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(201, 1002, 'Tipo de Tortilla', 1, 1, TRUE, 1),
(202, 1002, 'Elige tu Proteína', 1, 1, TRUE, 2),
(203, 1002, 'Añade Toppings', 0, 3, FALSE, 3),
(204, 1002, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Tortilla (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(201, 'Tortilla de Harina', 0.00, 190, TRUE),
(201, 'Tortilla Integral', 0.00, 170, TRUE);

-- Proteína (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(202, 'Pollo a la Plancha', 0.00, 220, TRUE),
(202, 'Carne Desmechada', 2500.00, 260, TRUE),
(202, 'Falafel (Vegano)', 0.00, 190, TRUE);

-- Toppings (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(203, 'Maíz Tierno', 0.00, 70, TRUE),
(203, 'Tomate Picado', 0.00, 25, TRUE),
(203, 'Aguacate', 1500.00, 120, TRUE),
(203, 'Queso Rallado', 1000.00, 110, TRUE);

-- Salsas (Wrap)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(204, 'Salsa de Ajo', 0.00, 90, TRUE),
(204, 'Salsa Picante', 0.00, 15, TRUE),
(204, 'Mayonesa de Cilantro', 0.00, 110, TRUE);

-- ==========================================
-- 5. AREPA RELLENA (id_plato = 1003)
-- ==========================================
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(301, 1003, 'Tipo de Arepa', 1, 1, TRUE, 1),
(302, 1003, 'Elige tu Relleno Principal', 1, 1, TRUE, 2),
(303, 1003, 'Añade Extras', 0, 2, FALSE, 3),
(304, 1003, 'Elige tu Salsa', 0, 1, FALSE, 4);

-- Arepa
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(301, 'Arepa de Maíz', 0.00, 180, TRUE),
(301, 'Arepa de Chócolo', 1500.00, 220, TRUE);

-- Relleno Principal (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(302, 'Pollo a la Plancha', 0.00, 220, TRUE),
(302, 'Carne Desmechada', 2500.00, 260, TRUE),
(302, 'Panceta Crujiente', 3000.00, 340, TRUE);

-- Extras (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(303, 'Aguacate', 1500.00, 120, TRUE),
(303, 'Queso Rallado', 1000.00, 110, TRUE),
(303, 'Cebolla Caramelizada', 0.00, 60, TRUE);

-- Salsas (Arepa)
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, disponible) VALUES 
(304, 'Salsa de Ajo', 0.00, 90, TRUE),
(304, 'Salsa Picante', 0.00, 15, TRUE),
(304, 'Guacamole', 2000.00, 100, TRUE);

-- Resetear secuencias para que los próximos INSERTs funcionen bien
SELECT setval('categorias_id_categoria_seq', (SELECT MAX(id_categoria) FROM categorias));
SELECT setval('platos_id_plato_seq', (SELECT MAX(id_plato) FROM platos));
SELECT setval('ingredientes_id_ingrediente_seq', (SELECT MAX(id_ingrediente) FROM ingredientes));
SELECT setval('pasos_constructor_id_paso_seq', (SELECT MAX(id_paso) FROM pasos_constructor));
