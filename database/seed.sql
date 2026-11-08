-- ==============================================================================
-- PROYECTO: SmartDining
-- MÓDULO: Datos Semilla / Pruebas Iniciales (PostgreSQL)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- DESCRIPCIÓN: Semilla base para entorno de desarrollo. Script idempotente y
--              compatibles con la máquina de estados del sistema.
-- ==============================================================================

-- 1. USUARIOS DEMO (Admin, Mesero, Cocina, Caja)
INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
SELECT 'Jarrison Pulgarin', 'admin@smartdining.com', '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2', 'admin', true
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'admin@smartdining.com');

INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
SELECT 'Carlos Chef', 'cocina@smartdining.com', '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2', 'cocina', true
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'cocina@smartdining.com');

INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
SELECT 'Juan Mesero', 'mesero@smartdining.com', '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2', 'mesero', true
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'mesero@smartdining.com');

INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
SELECT 'Roberto Cajero', 'caja@smartdining.com', '$2b$10$4PaqDdBb5R6V5Yu1t3LQiu9fDdwQ/wtILW/rcfAhvKJXTaKg6cmh2', 'cajero', true
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE email = 'caja@smartdining.com');

-- 2. MESAS
INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
SELECT 1, 2, 'Terraza', 'disponible', 'qr-token-mesa-01-a1b2c3d4'
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = 1);

INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
SELECT 2, 4, 'Terraza', 'disponible', 'qr-token-mesa-02-e5f6g7h8'
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = 2);

INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
SELECT 3, 4, 'Salón Principal', 'ocupada', 'qr-token-mesa-03-i9j0k1l2'
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = 3);

INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
SELECT 4, 6, 'Salón Principal', 'disponible', 'qr-token-mesa-04-m3n4o5p6'
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = 4);

INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
SELECT 5, 8, 'VIP', 'disponible', 'qr-token-mesa-05-q7r8s9t0'
WHERE NOT EXISTS (SELECT 1 FROM mesas WHERE numero = 5);

-- 3. MÁQUINA DE ESTADOS DEL PEDIDO
INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'recibido', 'en_preparacion', 'Comanda tomada e iniciada por el personal de cocina en KDS', TRUE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'recibido' AND estado_hacia = 'en_preparacion');

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'en_preparacion', 'listo', 'Platos terminados y listos en barra/pase de cocina', TRUE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'en_preparacion' AND estado_hacia = 'listo');

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'listo', 'entregado', 'Platos llevados y servidos físicamente en la mesa por el mesero', TRUE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'listo' AND estado_hacia = 'entregado');

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'entregado', 'pagado', 'Cuenta liquidada satisfactoriamente en caja o pago virtual', FALSE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'entregado' AND estado_hacia = 'pagado');

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'recibido', 'cancelado', 'Pedido cancelado oportunamente antes de preparación', FALSE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'recibido' AND estado_hacia = 'cancelado');

INSERT INTO transiciones_validas (estado_desde, estado_hacia, descripcion, requiere_usuario)
SELECT 'en_preparacion', 'cancelado', 'Pedido cancelado durante preparación por falta de insumos o fuerza mayor', TRUE
WHERE NOT EXISTS (SELECT 1 FROM transiciones_validas WHERE estado_desde = 'en_preparacion' AND estado_hacia = 'cancelado');

-- 4. CATEGORÍAS
INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
SELECT 'Entradas', 'Para comenzar y compartir al centro de mesa', 1, true
WHERE NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Entradas');

INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
SELECT 'Hamburguesas & Fuertes', 'Nuestras especialidades artesanales a la parrilla', 2, true
WHERE NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Hamburguesas & Fuertes');

INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
SELECT 'Bebidas & Cocteles', 'Refrescos naturales, cervezas y coctelería de autor', 3, true
WHERE NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Bebidas & Cocteles');

INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
SELECT 'Postres', 'El toque dulce perfecto para finalizar', 4, true
WHERE NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Postres');

INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
SELECT 'Adicionales', 'Toppings, extras y adiciones para personalizar tus platos', 5, true
WHERE NOT EXISTS (SELECT 1 FROM categorias WHERE nombre = 'Adicionales');

-- 5. PLATOS
INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Nachos Supremos', 'Totopos crujientes con guacamole, queso cheddar fundido, pico de gallo y frijol refrito.', 24000.00, 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d?w=600&q=80&auto=format', true, 10
FROM categorias c
WHERE c.nombre = 'Entradas'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Nachos Supremos');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Alitas BBQ x8', 'Alitas de pollo crujientes bañadas en salsa BBQ artesanal con bastones de apio.', 28000.00, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=600&q=80&auto=format', true, 12
FROM categorias c
WHERE c.nombre = 'Entradas'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Alitas BBQ x8');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Hamburguesa Smart Angus', '200g de carne Angus, queso cheddar madurado, tocineta ahumada, cebolla caramelizada y pan brioche.', 34000.00, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80&auto=format', true, 15
FROM categorias c
WHERE c.nombre = 'Hamburguesas & Fuertes'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Hamburguesa Smart Angus');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Costillas BBQ St. Louis', 'Costillar de cerdo glaseado a fuego lento acompañado de papas rústicas y ensalada coleslaw.', 42000.00, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80&auto=format', true, 20
FROM categorias c
WHERE c.nombre = 'Hamburguesas & Fuertes'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Costillas BBQ St. Louis');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Limonada de Coco', 'Limonada cremosa granizada preparada con leche de coco natural.', 12000.00, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=600&q=80&auto=format', true, 5
FROM categorias c
WHERE c.nombre = 'Bebidas & Cocteles'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Limonada de Coco');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Cerveza Artesanal IPA', 'Botella 330ml de cerveza rubia lupulada de la casa.', 14000.00, 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=600&q=80&auto=format', true, 3
FROM categorias c
WHERE c.nombre = 'Bebidas & Cocteles'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Cerveza Artesanal IPA');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Volcán de Chocolate', 'Bizcocho tibio de chocolate relleno de fudge fluido con helado de vainilla.', 18000.00, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&q=80&auto=format', true, 10
FROM categorias c
WHERE c.nombre = 'Postres'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Volcán de Chocolate');

-- PLATOS: Adicionales / Extras
INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Aguacate Extra', 'Porción fresca de aguacate hass en láminas.', 4000.00, 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80&auto=format', true, 3
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Aguacate Extra');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Chicharrón Crocante Extra', 'Porción adicional de chicharrón carnudo frito al punto crocante.', 8000.00, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80&auto=format', true, 8
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Chicharrón Crocante Extra');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Arepa Adicional', 'Arepa de maíz blanco asada a la plancha con mantequilla.', 2000.00, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80&auto=format', true, 5
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Arepa Adicional');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Aros de Cebolla', 'Aros de cebolla rebozados y crujientes con salsa tártara.', 2500.00, 'https://images.unsplash.com/photo-1639024471287-032f66442657?w=600&q=80&auto=format', true, 6
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Aros de Cebolla');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Tocineta Crocante', 'Tiras de tocineta ahumada dorada y crocante.', 3500.00, 'https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80&auto=format', true, 5
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Tocineta Crocante');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Queso Cheddar Extra', 'Porción de queso cheddar americano fundido.', 3000.00, 'https://images.unsplash.com/photo-1618160702438-9b02ab6515c9?w=600&q=80&auto=format', true, 2
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Queso Cheddar Extra');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Queso Parmesano Reggiano', 'Láminas de queso parmesano madurado reggiano.', 3000.00, 'https://images.unsplash.com/photo-1452195100486-9cc805987862?w=600&q=80&auto=format', true, 2
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Queso Parmesano Reggiano');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Aceite de Trufa Blanca', 'Gotas de aceite de oliva infusionado con trufa blanca.', 4500.00, 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&q=80&auto=format', true, 1
FROM categorias c
WHERE c.nombre = 'Adicionales'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Aceite de Trufa Blanca');


-- 5.1 CATEGORÍA Y PLATOS DEL CONSTRUCTOR (Arma tu plato)
INSERT INTO categorias (id_categoria, nombre, descripcion, orden_visualizacion, activo)
VALUES (100, 'Arma tu plato', 'Crea tu propia combinación eligiendo tus ingredientes favoritos', 0, true)
ON CONFLICT (nombre) DO UPDATE SET orden_visualizacion = 0;

INSERT INTO platos (id_plato, id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado, personalizable, calorias)
VALUES 
(1001, 100, 'Bowl Personalizado', 'Arma tu bowl con base, proteína, vegetales y salsa a tu gusto.', 20000.00, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80&auto=format', true, 10, true, 450),
(1002, 100, 'Wrap Personalizado', 'Tu combinación favorita envuelta en tortilla de harina fresca.', 18000.00, 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=600&q=80&auto=format', true, 8, true, 520),
(1003, 100, 'Arepa Rellena', 'Auténtica arepa de maíz con los rellenos que elijas.', 15000.00, 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=600&q=80&auto=format', true, 12, true, 380)
ON CONFLICT (id_plato) DO UPDATE SET calorias = EXCLUDED.calorias, url_imagen = EXCLUDED.url_imagen;

-- Pasos y componentes del Bowl Personalizado
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(101, 1001, 'Elige tu Base', 1, 1, TRUE, 1),
(102, 1001, 'Elige tu Proteína', 1, 1, TRUE, 2),
(103, 1001, 'Añade Toppings', 0, 3, FALSE, 3),
(104, 1001, 'Elige tu Salsa', 0, 1, FALSE, 4)
ON CONFLICT (id_paso) DO NOTHING;

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 101, 'Arroz Integral', 0.00, 180, 'https://images.unsplash.com/photo-1536304993881-ff6e9eefa2a6?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 101 AND nombre = 'Arroz Integral');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 101, 'Quinoa', 2000.00, 160, 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 101 AND nombre = 'Quinoa');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 101, 'Lechuga Fresca', 0.00, 15, 'https://images.unsplash.com/photo-1556801712-76c8eb07bbc9?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 101 AND nombre = 'Lechuga Fresca');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 102, 'Pollo a la Plancha', 0.00, 220, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 102 AND nombre = 'Pollo a la Plancha');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 102, 'Carne Desmechada', 2500.00, 260, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 102 AND nombre = 'Carne Desmechada');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 102, 'Falafel (Vegano)', 0.00, 190, 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 102 AND nombre = 'Falafel (Vegano)');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 102, 'Panceta Crujiente', 3000.00, 340, 'https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80&auto=format', FALSE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 102 AND nombre = 'Panceta Crujiente');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 103, 'Maíz Tierno', 0.00, 70, 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 103 AND nombre = 'Maíz Tierno');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 103, 'Tomate Picado', 0.00, 25, 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 103 AND nombre = 'Tomate Picado');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 103, 'Aguacate', 1500.00, 120, 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 103 AND nombre = 'Aguacate');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 103, 'Queso Rallado', 1000.00, 110, 'https://images.unsplash.com/photo-1618160702438-9b02ab6515c9?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 103 AND nombre = 'Queso Rallado');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 103, 'Cebolla Caramelizada', 0.00, 60, 'https://images.unsplash.com/photo-1580201092675-a0a6a6cafbb1?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 103 AND nombre = 'Cebolla Caramelizada');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 104, 'Salsa de Ajo', 0.00, 90, 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 104 AND nombre = 'Salsa de Ajo');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 104, 'Salsa Picante', 0.00, 15, 'https://images.unsplash.com/photo-1563865436874-9aef32095fad?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 104 AND nombre = 'Salsa Picante');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 104, 'Mayonesa de Cilantro', 0.00, 110, 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 104 AND nombre = 'Mayonesa de Cilantro');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 104, 'Guacamole', 2000.00, 100, 'https://images.unsplash.com/photo-1604467715878-83e57e8bc129?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 104 AND nombre = 'Guacamole');

-- Pasos y componentes del Wrap Personalizado
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(201, 1002, 'Tipo de Tortilla', 1, 1, TRUE, 1),
(202, 1002, 'Elige tu Proteína', 1, 1, TRUE, 2),
(203, 1002, 'Añade Toppings', 0, 3, FALSE, 3),
(204, 1002, 'Elige tu Salsa', 0, 1, FALSE, 4)
ON CONFLICT (id_paso) DO NOTHING;

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 201, 'Tortilla de Harina', 0.00, 190, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 201 AND nombre = 'Tortilla de Harina');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 201, 'Tortilla Integral', 0.00, 170, 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 201 AND nombre = 'Tortilla Integral');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 202, 'Pollo a la Plancha', 0.00, 220, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 202 AND nombre = 'Pollo a la Plancha');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 202, 'Carne Desmechada', 2500.00, 260, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 202 AND nombre = 'Carne Desmechada');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 202, 'Falafel (Vegano)', 0.00, 190, 'https://images.unsplash.com/photo-1593560708920-61dd98c46a4e?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 202 AND nombre = 'Falafel (Vegano)');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 203, 'Maíz Tierno', 0.00, 70, 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 203 AND nombre = 'Maíz Tierno');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 203, 'Tomate Picado', 0.00, 25, 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 203 AND nombre = 'Tomate Picado');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 203, 'Aguacate', 1500.00, 120, 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 203 AND nombre = 'Aguacate');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 203, 'Queso Rallado', 1000.00, 110, 'https://images.unsplash.com/photo-1618160702438-9b02ab6515c9?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 203 AND nombre = 'Queso Rallado');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 204, 'Salsa de Ajo', 0.00, 90, 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 204 AND nombre = 'Salsa de Ajo');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 204, 'Salsa Picante', 0.00, 15, 'https://images.unsplash.com/photo-1563865436874-9aef32095fad?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 204 AND nombre = 'Salsa Picante');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 204, 'Mayonesa de Cilantro', 0.00, 110, 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 204 AND nombre = 'Mayonesa de Cilantro');

-- Pasos y componentes de la Arepa Rellena
INSERT INTO pasos_constructor (id_paso, id_plato, nombre, min_sel, max_sel, obligatorio, orden) VALUES
(301, 1003, 'Tipo de Arepa', 1, 1, TRUE, 1),
(302, 1003, 'Elige tu Relleno Principal', 1, 1, TRUE, 2),
(303, 1003, 'Añade Extras', 0, 2, FALSE, 3),
(304, 1003, 'Elige tu Salsa', 0, 1, FALSE, 4)
ON CONFLICT (id_paso) DO NOTHING;

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 301, 'Arepa de Maíz', 0.00, 180, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 301 AND nombre = 'Arepa de Maíz');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 301, 'Arepa de Chócolo', 1500.00, 220, 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 301 AND nombre = 'Arepa de Chócolo');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 302, 'Pollo a la Plancha', 0.00, 220, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 302 AND nombre = 'Pollo a la Plancha');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 302, 'Carne Desmechada', 2500.00, 260, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 302 AND nombre = 'Carne Desmechada');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 302, 'Panceta Crujiente', 3000.00, 340, 'https://images.unsplash.com/photo-1528607929212-2636ec44253e?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 302 AND nombre = 'Panceta Crujiente');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 303, 'Aguacate', 1500.00, 120, 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 303 AND nombre = 'Aguacate');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 303, 'Queso Rallado', 1000.00, 110, 'https://images.unsplash.com/photo-1618160702438-9b02ab6515c9?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 303 AND nombre = 'Queso Rallado');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 303, 'Cebolla Caramelizada', 0.00, 60, 'https://images.unsplash.com/photo-1580201092675-a0a6a6cafbb1?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 303 AND nombre = 'Cebolla Caramelizada');

INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 304, 'Salsa de Ajo', 0.00, 90, 'https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 304 AND nombre = 'Salsa de Ajo');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 304, 'Salsa Picante', 0.00, 15, 'https://images.unsplash.com/photo-1563865436874-9aef32095fad?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 304 AND nombre = 'Salsa Picante');
INSERT INTO ingredientes (id_paso, nombre, precio_extra, calorias, url_imagen, disponible)
SELECT 304, 'Guacamole', 2000.00, 100, 'https://images.unsplash.com/photo-1604467715878-83e57e8bc129?w=600&q=80&auto=format', TRUE
WHERE NOT EXISTS (SELECT 1 FROM ingredientes WHERE id_paso = 304 AND nombre = 'Guacamole');

-- 6. PEDIDO DEMO
INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, notas_generales, creado_en)
SELECT m.id_mesa, 'ORD-001', 'en_preparacion', 70000.00, 'Mesa de cumpleaños', CURRENT_TIMESTAMP - INTERVAL '15 minutes'
FROM mesas m
WHERE m.numero = 3
  AND NOT EXISTS (SELECT 1 FROM pedidos WHERE codigo_pedido = 'ORD-001');

-- 7. DETALLES DEL PEDIDO DEMO
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, notas_especiales, estado_item)
SELECT p.id_pedido, pl.id_plato, 1, 34000.00, 34000.00, 'Término 3/4, sin cebolla', 'cocinando'
FROM pedidos p
JOIN platos pl ON pl.nombre = 'Hamburguesa Smart Angus'
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM detalles_pedido dp
      WHERE dp.id_pedido = p.id_pedido AND dp.id_plato = pl.id_plato
  );

INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, notas_especiales, estado_item)
SELECT p.id_pedido, pl.id_plato, 1, 24000.00, 24000.00, 'Guacamole adicional', 'listo'
FROM pedidos p
JOIN platos pl ON pl.nombre = 'Nachos Supremos'
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM detalles_pedido dp
      WHERE dp.id_pedido = p.id_pedido AND dp.id_plato = pl.id_plato
  );

INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, notas_especiales, estado_item)
SELECT p.id_pedido, pl.id_plato, 1, 12000.00, 12000.00, 'Poco dulce', 'servido'
FROM pedidos p
JOIN platos pl ON pl.nombre = 'Limonada de Coco'
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM detalles_pedido dp
      WHERE dp.id_pedido = p.id_pedido AND dp.id_plato = pl.id_plato
  );

-- 8. HISTORIAL DE ESTADOS DEMO
INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)
SELECT p.id_pedido, NULL, NULL, 'recibido', 'Pedido emitido desde el celular del cliente vía QR', CURRENT_TIMESTAMP - INTERVAL '15 minutes'
FROM pedidos p
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM historial_estados h
      WHERE h.id_pedido = p.id_pedido AND h.estado_nuevo = 'recibido'
  );

INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)
SELECT p.id_pedido, u.id_usuario, 'recibido', 'en_preparacion', 'Comanda tomada por chef en cocina KDS', CURRENT_TIMESTAMP - INTERVAL '10 minutes'
FROM pedidos p
JOIN usuarios u ON u.email = 'cocina@smartdining.com'
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM historial_estados h
      WHERE h.id_pedido = p.id_pedido AND h.estado_nuevo = 'en_preparacion'
  );

-- Actualizar fecha_cambio y creado_en si el pedido ya existia para evitar metricas KDS absurdas (+35.000 %)
UPDATE pedidos
SET creado_en = CURRENT_TIMESTAMP - INTERVAL '15 minutes'
WHERE codigo_pedido = 'ORD-001';

UPDATE historial_estados
SET fecha_cambio = CURRENT_TIMESTAMP - INTERVAL '15 minutes'
WHERE id_pedido = (SELECT id_pedido FROM pedidos WHERE codigo_pedido = 'ORD-001')
  AND estado_nuevo = 'recibido';

UPDATE historial_estados
SET fecha_cambio = CURRENT_TIMESTAMP - INTERVAL '10 minutes'
WHERE id_pedido = (SELECT id_pedido FROM pedidos WHERE codigo_pedido = 'ORD-001')
  AND estado_nuevo = 'en_preparacion';
