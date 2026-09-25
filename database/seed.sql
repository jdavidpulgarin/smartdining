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

-- 5. PLATOS
INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Nachos Supremos', 'Totopos crujientes con guacamole, queso cheddar fundido, pico de gallo y frijol refrito.', 24000.00, 'https://images.unsplash.com/photo-1513456852971-30c0b8199d4d', true, 10
FROM categorias c
WHERE c.nombre = 'Entradas'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Nachos Supremos');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Alitas BBQ x8', 'Alitas de pollo crujientes bañadas en salsa BBQ artesanal con bastones de apio.', 28000.00, 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f', true, 12
FROM categorias c
WHERE c.nombre = 'Entradas'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Alitas BBQ x8');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Hamburguesa Smart Angus', '200g de carne Angus, queso cheddar madurado, tocineta ahumada, cebolla caramelizada y pan brioche.', 34000.00, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd', true, 15
FROM categorias c
WHERE c.nombre = 'Hamburguesas & Fuertes'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Hamburguesa Smart Angus');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Costillas BBQ St. Louis', 'Costillar de cerdo glaseado a fuego lento acompañado de papas rústicas y ensalada coleslaw.', 42000.00, 'https://images.unsplash.com/photo-1544025162-d76694265947', true, 20
FROM categorias c
WHERE c.nombre = 'Hamburguesas & Fuertes'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Costillas BBQ St. Louis');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Limonada de Coco', 'Limonada cremosa granizada preparada con leche de coco natural.', 12000.00, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd', true, 5
FROM categorias c
WHERE c.nombre = 'Bebidas & Cocteles'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Limonada de Coco');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Cerveza Artesanal IPA', 'Botella 330ml de cerveza rubia lupulada de la casa.', 14000.00, 'https://images.unsplash.com/photo-1608270586620-248524c67de9', true, 3
FROM categorias c
WHERE c.nombre = 'Bebidas & Cocteles'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Cerveza Artesanal IPA');

INSERT INTO platos (id_categoria, nombre, descripcion, precio, url_imagen, disponible, tiempo_preparacion_estimado)
SELECT c.id_categoria, 'Volcán de Chocolate', 'Bizcocho tibio de chocolate relleno de fudge fluido con helado de vainilla.', 18000.00, 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c', true, 10
FROM categorias c
WHERE c.nombre = 'Postres'
  AND NOT EXISTS (SELECT 1 FROM platos WHERE nombre = 'Volcán de Chocolate');

-- 6. PEDIDO DEMO
INSERT INTO pedidos (id_mesa, codigo_pedido, estado, total, notas_generales)
SELECT m.id_mesa, 'ORD-001', 'en_preparacion', 70000.00, 'Mesa de cumpleaños'
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
INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
SELECT p.id_pedido, NULL, NULL, 'recibido', 'Pedido emitido desde el celular del cliente vía QR'
FROM pedidos p
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM historial_estados h
      WHERE h.id_pedido = p.id_pedido AND h.estado_nuevo = 'recibido'
  );

INSERT INTO historial_estados (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
SELECT p.id_pedido, u.id_usuario, 'recibido', 'en_preparacion', 'Comanda tomada por chef en cocina KDS'
FROM pedidos p
JOIN usuarios u ON u.email = 'cocina@smartdining.com'
WHERE p.codigo_pedido = 'ORD-001'
  AND NOT EXISTS (
      SELECT 1 FROM historial_estados h
      WHERE h.id_pedido = p.id_pedido AND h.estado_nuevo = 'en_preparacion'
  );
