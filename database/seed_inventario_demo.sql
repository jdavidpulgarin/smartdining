-- ==============================================================================
-- PROYECTO: SmartDining
-- ARCHIVO: seed_inventario_demo.sql
-- MÓDULO: Datos de inventario para la demo (G-07)
-- ==============================================================================
-- Insumos, stock inicial y recetas para los platos y opciones de seed.sql.
-- SOLO PARA LOCAL, STAGING Y LA DEMO. Se carga A MANO después de migrar.sh;
-- no lo corren docker-init.sh ni migrar.sh, para que nunca llegue solo a
-- producción. Ver database/README.md, sección "Datos de inventario para la demo".
--
-- Lo que deja preparado para la demo:
--   - Hamburguesa Smart Angus: solo 4 porciones de carne Angus. El 4.º pedido
--     la agota y desaparece de la carta (stock_suficiente = FALSE).
--   - Arepa de Chócolo (opción de la Arepa Rellena): 2 unidades con mínimo 4.
--     Sale en v_stock_bajo desde el inicio y se agota con 2 pedidos.
--   - Panceta Crujiente del Bowl sigue apagada a mano (disponible = FALSE en
--     seed.sql): muestra la diferencia entre "apagado por cocina" y "agotado".
--
-- Se puede correr varias veces sin duplicar nada:
--   - insumos: ON CONFLICT (nombre) DO NOTHING.
--   - stock inicial: una 'entrada' solo para el insumo que todavía no tiene
--     NINGÚN movimiento. Así una segunda corrida no suma stock y el libro
--     (SUM(movimientos.cantidad) = stock_actual) sigue cuadrando.
--   - recetas: ON CONFLICT DO NOTHING (no pisa una receta ya cambiada).
-- Las recetas se cargan DESPUÉS del stock: si fuera al revés, cada plato
-- pasaría por "sin stock" un instante y la carta mandaría avisos de más.
--
-- Platos y opciones se buscan por nombre (no por id). Requiere el script 27.
-- ==============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. INSUMOS (nombre, unidad, stock inicial, stock mínimo)
-- ------------------------------------------------------------------------------
CREATE TEMP TABLE demo_insumos (
    nombre VARCHAR(80) PRIMARY KEY,
    unidad VARCHAR(10) NOT NULL,
    stock_inicial NUMERIC(12,2) NOT NULL,
    stock_minimo NUMERIC(12,2) NOT NULL
) ON COMMIT DROP;

INSERT INTO demo_insumos (nombre, unidad, stock_inicial, stock_minimo) VALUES
    -- Platos de la carta
    ('Carne Angus 200 g',      'porcion',    4,    2),
    ('Pan brioche',            'unidad',    30,   10),
    ('Queso cheddar',          'g',       3000,  500),
    ('Tocineta',               'g',       2000,  300),
    ('Totopos',                'g',       4000,  500),
    ('Alitas de pollo',        'unidad',    80,   16),
    ('Costillar de cerdo',     'porcion',   10,    3),
    ('Papa rústica',           'g',       8000, 1000),
    ('Leche de coco',          'ml',      1500,  500),
    ('Cerveza IPA 330 ml',     'unidad',    24,    6),
    ('Volcán de chocolate',    'unidad',     8,    3),
    ('Aguacate',               'g',       3000,  500),
    ('Chicharrón',             'porcion',   10,    3),
    ('Aros de cebolla',        'porcion',   15,    5),
    ('Queso parmesano',        'g',       1000,  200),
    ('Aceite de trufa',        'ml',       250,   50),
    -- Opciones del constructor (Bowl, Wrap, Arepa)
    ('Arepa de maíz',          'unidad',    40,   10),
    ('Arepa de chócolo',       'unidad',     2,    4),
    ('Tortilla de harina',     'unidad',    30,    8),
    ('Tortilla integral',      'unidad',    20,    5),
    ('Arroz integral',         'g',       5000, 1000),
    ('Quinoa',                 'g',       3000,  500),
    ('Lechuga',                'g',       2000,  300),
    ('Pollo a la plancha',     'porcion',   20,    5),
    ('Carne desmechada',       'porcion',   15,    5),
    ('Falafel',                'porcion',   12,    4),
    ('Panceta',                'porcion',   10,    3),
    ('Maíz tierno',            'g',       2000,  300),
    ('Tomate',                 'g',       2000,  300),
    ('Queso rallado',          'g',       2000,  300),
    ('Cebolla caramelizada',   'g',       1500,  300),
    ('Salsa de ajo',           'ml',      2000,  300),
    ('Salsa picante',          'ml',      2000,  300),
    ('Mayonesa de cilantro',   'ml',      2000,  300);

-- Se crean con stock 0; el stock entra como movimiento en el paso 2.
INSERT INTO insumos (nombre, unidad, stock_minimo)
SELECT nombre, unidad, stock_minimo FROM demo_insumos ORDER BY nombre
ON CONFLICT (nombre) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. STOCK INICIAL (solo insumos sin ningún movimiento)
-- ------------------------------------------------------------------------------
SELECT count(registrar_movimiento_inventario(s.id_insumo, 'entrada', d.stock_inicial,
                                             'Carga inicial de la demo (G-07)')) AS entradas_registradas
FROM demo_insumos d
JOIN insumos s ON s.nombre = d.nombre
WHERE NOT EXISTS (SELECT 1 FROM movimientos_inventario m WHERE m.id_insumo = s.id_insumo);

-- ------------------------------------------------------------------------------
-- 3. RECETAS DE PLATOS (por unidad de plato)
-- ------------------------------------------------------------------------------
INSERT INTO recetas_plato (id_plato, id_insumo, cantidad)
SELECT p.id_plato, s.id_insumo, r.cantidad
FROM (VALUES
    ('Hamburguesa Smart Angus',   'Carne Angus 200 g',     1),
    ('Hamburguesa Smart Angus',   'Pan brioche',           1),
    ('Hamburguesa Smart Angus',   'Queso cheddar',        40),
    ('Hamburguesa Smart Angus',   'Tocineta',             30),
    ('Nachos Supremos',           'Totopos',             150),
    ('Nachos Supremos',           'Queso cheddar',        60),
    ('Alitas BBQ x8',             'Alitas de pollo',       8),
    ('Costillas BBQ St. Louis',   'Costillar de cerdo',    1),
    ('Costillas BBQ St. Louis',   'Papa rústica',        200),
    ('Limonada de Coco',          'Leche de coco',       250),
    ('Cerveza Artesanal IPA',     'Cerveza IPA 330 ml',    1),
    ('Volcán de Chocolate',       'Volcán de chocolate',   1),
    ('Aguacate Extra',            'Aguacate',             80),
    ('Chicharrón Crocante Extra', 'Chicharrón',            1),
    ('Arepa Adicional',           'Arepa de maíz',         1),
    ('Aros de Cebolla',           'Aros de cebolla',       1),
    ('Tocineta Crocante',         'Tocineta',             40),
    ('Queso Cheddar Extra',       'Queso cheddar',        40),
    ('Queso Parmesano Reggiano',  'Queso parmesano',      30),
    ('Aceite de Trufa Blanca',    'Aceite de trufa',      10)
) AS r (plato, insumo, cantidad)
JOIN platos p ON p.nombre = r.plato
JOIN insumos s ON s.nombre = r.insumo
ORDER BY p.id_plato, s.id_insumo
ON CONFLICT (id_plato, id_insumo) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 4. RECETAS DE OPCIONES DEL CONSTRUCTOR (por porción normal)
-- ------------------------------------------------------------------------------
-- La misma opción aparece en varios pasos (p. ej. Pollo en Bowl, Wrap y Arepa):
-- todas usan el mismo insumo, así que si se acaba, se apaga en los tres.
INSERT INTO recetas_ingrediente (id_ingrediente, id_insumo, cantidad)
SELECT i.id_ingrediente, s.id_insumo, r.cantidad
FROM (VALUES
    ('Arroz Integral',       'Arroz integral',       150),
    ('Quinoa',               'Quinoa',               120),
    ('Lechuga Fresca',       'Lechuga',              100),
    ('Tortilla de Harina',   'Tortilla de harina',     1),
    ('Tortilla Integral',    'Tortilla integral',      1),
    ('Arepa de Maíz',        'Arepa de maíz',          1),
    ('Arepa de Chócolo',     'Arepa de chócolo',       1),
    ('Pollo a la Plancha',   'Pollo a la plancha',     1),
    ('Carne Desmechada',     'Carne desmechada',       1),
    ('Falafel (Vegano)',     'Falafel',                1),
    ('Panceta Crujiente',    'Panceta',                1),
    ('Maíz Tierno',          'Maíz tierno',           60),
    ('Tomate Picado',        'Tomate',                60),
    ('Aguacate',             'Aguacate',              60),
    ('Queso Rallado',        'Queso rallado',         40),
    ('Cebolla Caramelizada', 'Cebolla caramelizada',  50),
    ('Salsa de Ajo',         'Salsa de ajo',          30),
    ('Salsa Picante',        'Salsa picante',         30),
    ('Mayonesa de Cilantro', 'Mayonesa de cilantro',  30),
    ('Guacamole',            'Aguacate',              50)
) AS r (opcion, insumo, cantidad)
JOIN ingredientes i ON i.nombre = r.opcion
JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
JOIN platos p ON p.id_plato = pc.id_plato
             AND p.nombre IN ('Bowl Personalizado', 'Wrap Personalizado', 'Arepa Rellena')
JOIN insumos s ON s.nombre = r.insumo
ORDER BY i.id_ingrediente, s.id_insumo
ON CONFLICT (id_ingrediente, id_insumo) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. RESUMEN
-- ------------------------------------------------------------------------------
SELECT (SELECT count(*) FROM insumos)             AS insumos,
       (SELECT count(*) FROM recetas_plato)       AS recetas_plato,
       (SELECT count(*) FROM recetas_ingrediente) AS recetas_ingrediente,
       (SELECT count(*) FROM v_stock_bajo)        AS en_stock_bajo;

COMMIT;
