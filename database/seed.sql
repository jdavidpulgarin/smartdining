-- ==============================================================================
-- PROYECTO: SmartDining
-- MÓDULO: Datos Semilla / Pruebas Iniciales (PostgreSQL)
-- AUTOR: Jarrison Pulgarin (Líder de Base de Datos)
-- ==============================================================================

-- 1. USUARIOS DEMO (Admin, Mesero, Cocina, Caja)
INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES
('Jarrison Pulgarin', 'admin@smartdining.com', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPt.8lMvi', 'admin', true),
('Carlos Chef', 'cocina@smartdining.com', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPt.8lMvi', 'cocina', true),
('Juan Mesero', 'mesero@smartdining.com', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPt.8lMvi', 'mesero', true),
('Roberto Cajero', 'caja@smartdining.com', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPt.8lMvi', 'cajero', true);

-- 2. MESAS
INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr) VALUES
(1, 2, 'Terraza', 'disponible', 'qr-token-mesa-01-a1b2c3d4'),
(2, 4, 'Terraza', 'disponible', 'qr-token-mesa-02-e5f6g7h8'),
(3, 4, 'Salón Principal', 'ocupada', 'qr-token-mesa-03-i9j0k1l2'),
(4, 6, 'Salón Principal', 'disponible', 'qr-token-mesa-04-m3n4o5p6'),
(5, 8, 'VIP', 'disponible', 'qr-token-mesa-05-q7r8s9t0');

-- 3. CATEGORÍAS
INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo) VALUES
('Entradas', 'Para comenzar y compartir al centro de mesa', 1, true),
('Hamburguesas & Fuertes', 'Nuestras especialidades artesanales a la parrilla', 2, true),
('Bebidas & Cocteles', 'Refrescos naturales, cervezas y coctelería de autor', 3, true),
('Postres', 'El toque dulce perfecto para finalizar', 4, true);

-- 4. PLATOS
INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado) VALUES
(1, 'Nachos Supremos', 'Totopos crujientes con guacamole, queso cheddar fundido, pico de gallo y frijol refrito.', 24000.00, 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d', true, 10),
(1, 'Alitas BBQ x8', 'Alitas de pollo crujientes bañadas en salsa BBQ artesanal con bastones de apio.', 28000.00, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f', true, 12),
(2, 'Hamburguesa Smart Angus', '200g de carne Angus, queso cheddar madurado, tocineta ahumada, cebolla caramelizada y pan brioche.', 34000.00, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd', true, 15),
(2, 'Costillas BBQ St. Louis', 'Costillar de cerdo glaseado a fuego lento acompañado de papas rústicas y ensalada coleslaw.', 42000.00, 'https://images.unsplash.com/photo-1544025162-d76694265947', true, 20),
(3, 'Limonada de Coco', 'Limonada cremosa granizada preparada con leche de coco natural.', 12000.00, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd', true, 5),
(3, 'Cerveza Artesanal IPA', 'Botella 330ml de cerveza rubia lupulada de la casa.', 14000.00, 'https://images.unsplash.com/photo-1608270586620-248524c67de9', true, 3),
(4, 'Volcán de Chocolate', 'Bizcocho tibio de chocolate relleno de fudge fluido con helado de vainilla.', 18000.00, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c', true, 10);

-- 5. PEDIDO DEMO (Mesa 3)
INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, notas_generales) VALUES
(3, 'ORD-001', 'en_preparacion', 70000.00, 'Mesa de cumpleaños');

-- 6. DETALLES DEL PEDIDO DEMO
INSERT INTO detalles_pedido (id_pedido, id_plato, cantidad, precio_unitario, subtotal, notas_especiales, estado_item) VALUES
(1, 3, 1, 34000.00, 34000.00, 'Término 3/4, sin cebolla', 'cocinando'),
(1, 1, 1, 24000.00, 24000.00, 'Guacamole adicional', 'listo'),
(1, 5, 1, 12000.00, 12000.00, 'Poco dulce', 'servido');

-- 7. HISTORIAL DE ESTADOS DEMO
INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones) VALUES
(1, NULL, NULL, 'recibido', 'Pedido emitido desde el celular del cliente vía QR'),
(1, 2, 'recibido', 'en_preparacion', 'Comanda tomada por chef en cocina KDS');
