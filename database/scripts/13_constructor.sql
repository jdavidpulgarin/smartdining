-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 13_constructor.sql
-- MÓDULO: Constructor de platos "arma tu plato" (pasos, ingredientes y porciones)
-- ACTIVIDAD: P-02 (Plan de continuación, Sprint 1)
-- AUTOR: Jarrison Pulgarin (Base de Datos)
--
-- DESCRIPCIÓN:
--   Script ADITIVO: solo ALTER, CREATE y CREATE OR REPLACE sobre el esquema base.
--   Es idempotente: se puede correr sobre una base ya creada sin reconstruirla.
--   Va después de todos los scripts porque redefine funciones y vistas que
--   dependen de las columnas nuevas.
--
-- REGLAS DEL CONSTRUCTOR (decisiones D1 y D2 del equipo):
--   1. Un plato personalizable tiene pasos ordenados (Base, Proteína, ...),
--      cada uno con min_sel / max_sel y si es obligatorio.
--   2. Cada paso tiene sus ingredientes con precio_extra, calorías y alérgenos.
--   3. Porción 'ligera' y 'normal' no tienen recargo; 'extra' suma precio_extra.
--   4. La BASE DE DATOS fija precio_aplicado al guardar cada ingrediente y lo
--      congela (igual que precio_unitario del plato): un precio enviado por el
--      cliente nunca se usa.
--   5. subtotal del detalle = cantidad * (precio_unitario + precio_extras), donde
--      precio_extras = suma de precio_aplicado de sus ingredientes.
--   6. detalles_pedido guarda el comensal (alias) para dividir la cuenta.
-- ==============================================================================

-- ==============================================================================
-- 1. COLUMNAS NUEVAS EN TABLAS EXISTENTES
-- ==============================================================================

-- platos: marca de plato armable y calorías del plato base.
ALTER TABLE platos
    ADD COLUMN IF NOT EXISTS personalizable BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS calorias INTEGER CHECK (calorias IS NULL OR calorias >= 0);

-- detalles_pedido: quién pidió el ítem y cuánto suman sus extras por unidad.
ALTER TABLE detalles_pedido
    ADD COLUMN IF NOT EXISTS comensal VARCHAR(40)
        CHECK (comensal IS NULL OR length(btrim(comensal)) > 0),
    ADD COLUMN IF NOT EXISTS precio_extras DECIMAL(10,2) NOT NULL DEFAULT 0.00
        CHECK (precio_extras >= 0);

-- ==============================================================================
-- 2. TABLA: pasos_constructor
-- Pasos ordenados para armar un plato personalizable.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS pasos_constructor (
    id_paso SERIAL PRIMARY KEY,
    id_plato INTEGER NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    orden INTEGER NOT NULL CHECK (orden > 0),
    min_sel INTEGER NOT NULL DEFAULT 0 CHECK (min_sel >= 0),
    max_sel INTEGER NOT NULL DEFAULT 1 CHECK (max_sel >= 1),
    obligatorio BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pasos_plato
        FOREIGN KEY (id_plato)
        REFERENCES platos(id_plato)
        ON DELETE CASCADE,

    CONSTRAINT ck_pasos_rango_seleccion CHECK (min_sel <= max_sel),
    CONSTRAINT ck_pasos_obligatorio_minimo CHECK (NOT obligatorio OR min_sel >= 1),

    -- DEFERRABLE: permite reordenar pasos (intercambiar orden) en una sola
    -- transacción desde el panel de administración.
    CONSTRAINT uq_pasos_plato_orden UNIQUE (id_plato, orden) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT uq_pasos_plato_nombre UNIQUE (id_plato, nombre)
);

-- ==============================================================================
-- 3. TABLA: ingredientes
-- Opciones elegibles dentro de cada paso del constructor.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS ingredientes (
    id_ingrediente SERIAL PRIMARY KEY,
    id_paso INTEGER NOT NULL,
    nombre VARCHAR(80) NOT NULL,
    precio_extra DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (precio_extra >= 0),
    calorias INTEGER NOT NULL DEFAULT 0 CHECK (calorias >= 0),
    alergenos TEXT[] NOT NULL DEFAULT '{}',
    url_imagen VARCHAR(255),
    disponible BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ingredientes_paso
        FOREIGN KEY (id_paso)
        REFERENCES pasos_constructor(id_paso)
        ON DELETE CASCADE,

    CONSTRAINT uq_ingredientes_paso_nombre UNIQUE (id_paso, nombre)
);

-- ==============================================================================
-- 4. TABLA: detalles_ingredientes
-- Ingredientes y porción elegidos para cada ítem armado de un pedido.
-- La PK compuesta impide repetir un ingrediente en el mismo ítem.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS detalles_ingredientes (
    id_detalle INTEGER NOT NULL,
    id_ingrediente INTEGER NOT NULL,
    porcion VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (porcion IN ('ligera', 'normal', 'extra')),
    precio_aplicado DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (precio_aplicado >= 0),

    CONSTRAINT pk_detalles_ingredientes PRIMARY KEY (id_detalle, id_ingrediente),

    CONSTRAINT fk_det_ingr_detalle
        FOREIGN KEY (id_detalle)
        REFERENCES detalles_pedido(id_detalle)
        ON DELETE CASCADE,

    -- RESTRICT: un ingrediente ya vendido no se borra (se marca no disponible),
    -- así los pedidos históricos conservan su composición.
    CONSTRAINT fk_det_ingr_ingrediente
        FOREIGN KEY (id_ingrediente)
        REFERENCES ingredientes(id_ingrediente)
        ON DELETE RESTRICT
);

-- ==============================================================================
-- 5. ÍNDICES
-- (id_plato, orden), (id_paso, nombre) y la PK de detalles_ingredientes ya
-- cubren las búsquedas por plato, por paso y por detalle.
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_det_ingr_ingrediente ON detalles_ingredientes(id_ingrediente);
CREATE INDEX IF NOT EXISTS idx_detalles_pedido_comensal ON detalles_pedido(id_pedido, comensal);
CREATE INDEX IF NOT EXISTS idx_ingredientes_disponible ON ingredientes(id_paso) WHERE disponible = TRUE;

-- ==============================================================================
-- 6. FUNCIÓN: calcular_extras_detalle
-- Suma por unidad de los recargos de un ítem armado.
-- ==============================================================================
CREATE OR REPLACE FUNCTION calcular_extras_detalle(id_detalle_param INTEGER)
RETURNS DECIMAL(10,2) AS $$
    SELECT COALESCE(SUM(precio_aplicado), 0.00)::DECIMAL(10,2)
    FROM detalles_ingredientes
    WHERE id_detalle = id_detalle_param;
$$ LANGUAGE sql STABLE;

-- ==============================================================================
-- 7. TRIGGER (redefinido): tr_validar_detalle_pedido
-- Reemplaza la versión de 08_triggers.sql para que el subtotal incluya los
-- extras. precio_extras nunca se toma de lo que envíe la aplicación:
--   - INSERT: el ítem aún no tiene ingredientes, así que vale 0.
--   - UPDATE: se recalcula desde detalles_ingredientes.
-- El total del pedido lo sigue recalculando tr_actualizar_total_pedido, que ya
-- suma los subtotales, así que no necesita cambios.
-- ==============================================================================
CREATE OR REPLACE FUNCTION fn_tr_validar_detalle_pedido()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad del ítem debe ser mayor a cero (recibido: %)', NEW.cantidad;
    END IF;

    IF NEW.precio_unitario < 0 THEN
        RAISE EXCEPTION 'El precio unitario no puede ser negativo';
    END IF;

    IF NEW.estado_item NOT IN ('pendiente', 'cocinando', 'listo', 'servido', 'cancelado') THEN
        RAISE EXCEPTION 'Estado de preparación "%" no válido', NEW.estado_item;
    END IF;

    -- Extras autoritativos desde la base de datos
    IF TG_OP = 'INSERT' THEN
        NEW.precio_extras := 0.00;
    ELSE
        NEW.precio_extras := calcular_extras_detalle(NEW.id_detalle);
    END IF;

    -- Cálculo estricto del subtotal (plato + extras por unidad)
    NEW.subtotal := NEW.cantidad * (NEW.precio_unitario + NEW.precio_extras);

    -- Preservación del precio histórico ante ediciones
    IF TG_OP = 'UPDATE' AND OLD.precio_unitario != NEW.precio_unitario THEN
        RAISE EXCEPTION 'No se permite modificar el precio histórico original de un detalle de pedido ya emitido';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 8. TRIGGER: tr_validar_detalle_ingrediente
-- Antes de guardar un ingrediente elegido:
--   - el pedido debe seguir en 'recibido' (después ya está en cocina),
--   - el plato del ítem debe ser personalizable,
--   - el ingrediente debe pertenecer a un paso de ESE plato,
--   - el ingrediente debe estar disponible,
--   - precio_aplicado lo fija la base: 'extra' = precio_extra, otro = 0.
-- Los mensajes llegan al comensal: el backend traduce P0001 a 409.
-- ==============================================================================
CREATE OR REPLACE FUNCTION fn_tr_validar_detalle_ingrediente()
RETURNS TRIGGER AS $$
DECLARE
    v_id_plato_detalle INTEGER;
    v_estado_pedido VARCHAR(20);
    v_personalizable BOOLEAN;
    v_nombre_plato VARCHAR(120);
    v_id_plato_ingrediente INTEGER;
    v_nombre_ingrediente VARCHAR(80);
    v_precio_extra DECIMAL(10,2);
    v_disponible BOOLEAN;
BEGIN
    SELECT dp.id_plato, p.estado, pl.personalizable, pl.nombre
      INTO v_id_plato_detalle, v_estado_pedido, v_personalizable, v_nombre_plato
    FROM detalles_pedido dp
    JOIN pedidos p ON p.id_pedido = dp.id_pedido
    JOIN platos pl ON pl.id_plato = dp.id_plato
    WHERE dp.id_detalle = NEW.id_detalle;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El detalle de pedido % no existe', NEW.id_detalle;
    END IF;

    IF v_estado_pedido <> 'recibido' THEN
        RAISE EXCEPTION 'No se pueden cambiar los ingredientes: el pedido ya está en estado "%"', v_estado_pedido;
    END IF;

    IF NOT v_personalizable THEN
        RAISE EXCEPTION 'El plato "%" no es personalizable', v_nombre_plato;
    END IF;

    SELECT pc.id_plato, i.nombre, i.precio_extra, i.disponible
      INTO v_id_plato_ingrediente, v_nombre_ingrediente, v_precio_extra, v_disponible
    FROM ingredientes i
    JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
    WHERE i.id_ingrediente = NEW.id_ingrediente;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El ingrediente % no existe', NEW.id_ingrediente;
    END IF;

    IF v_id_plato_ingrediente <> v_id_plato_detalle THEN
        RAISE EXCEPTION 'El ingrediente "%" no pertenece al plato "%"', v_nombre_ingrediente, v_nombre_plato;
    END IF;

    IF NOT v_disponible AND (TG_OP = 'INSERT' OR NEW.id_ingrediente <> OLD.id_ingrediente) THEN
        RAISE EXCEPTION 'El ingrediente "%" está agotado', v_nombre_ingrediente;
    END IF;

    -- Precio congelado: si no cambia ni el ingrediente ni la porción, se conserva
    IF TG_OP = 'UPDATE'
       AND NEW.id_ingrediente = OLD.id_ingrediente
       AND NEW.porcion = OLD.porcion THEN
        NEW.precio_aplicado := OLD.precio_aplicado;
    ELSE
        NEW.precio_aplicado := CASE WHEN NEW.porcion = 'extra' THEN v_precio_extra ELSE 0.00 END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_detalle_ingrediente ON detalles_ingredientes;
CREATE TRIGGER tr_validar_detalle_ingrediente
    BEFORE INSERT OR UPDATE ON detalles_ingredientes
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_validar_detalle_ingrediente();

-- ==============================================================================
-- 9. TRIGGER: tr_actualizar_extras_detalle
-- Tras cambiar los ingredientes de un ítem, recalcula su precio_extras. Ese
-- UPDATE dispara tr_validar_detalle_pedido (subtotal) y luego
-- tr_actualizar_total_pedido (total del pedido).
-- ==============================================================================
CREATE OR REPLACE FUNCTION fn_tr_actualizar_extras_detalle()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP <> 'DELETE' THEN
        UPDATE detalles_pedido
        SET precio_extras = calcular_extras_detalle(NEW.id_detalle)
        WHERE id_detalle = NEW.id_detalle;
    END IF;

    IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.id_detalle <> NEW.id_detalle) THEN
        -- Si el detalle se está borrando en cascada, el UPDATE no afecta filas.
        UPDATE detalles_pedido
        SET precio_extras = calcular_extras_detalle(OLD.id_detalle)
        WHERE id_detalle = OLD.id_detalle;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_actualizar_extras_detalle ON detalles_ingredientes;
CREATE TRIGGER tr_actualizar_extras_detalle
    AFTER INSERT OR UPDATE OR DELETE ON detalles_ingredientes
    FOR EACH ROW
    EXECUTE FUNCTION fn_tr_actualizar_extras_detalle();

-- ==============================================================================
-- 10. FUNCIÓN: validar_selecciones_detalle
-- Verifica min_sel / max_sel de cada paso para un ítem ya armado. No puede ser
-- un trigger por fila porque las reglas se cumplen al terminar de insertar
-- TODOS los ingredientes del ítem. El backend (D-03) la llama dentro de la
-- misma transacción, después de insertar las selecciones:
--     SELECT validar_selecciones_detalle($1);
-- ==============================================================================
CREATE OR REPLACE FUNCTION validar_selecciones_detalle(id_detalle_param INTEGER)
RETURNS VOID AS $$
DECLARE
    v_id_plato INTEGER;
    v_personalizable BOOLEAN;
    r RECORD;
BEGIN
    SELECT dp.id_plato, pl.personalizable
      INTO v_id_plato, v_personalizable
    FROM detalles_pedido dp
    JOIN platos pl ON pl.id_plato = dp.id_plato
    WHERE dp.id_detalle = id_detalle_param;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El detalle de pedido % no existe', id_detalle_param;
    END IF;

    IF NOT v_personalizable THEN
        RETURN; -- Platos simples: no hay pasos que validar
    END IF;

    FOR r IN
        SELECT pc.nombre, pc.min_sel, pc.max_sel, COUNT(di.id_ingrediente) AS elegidos
        FROM pasos_constructor pc
        LEFT JOIN ingredientes i ON i.id_paso = pc.id_paso
        LEFT JOIN detalles_ingredientes di
               ON di.id_ingrediente = i.id_ingrediente
              AND di.id_detalle = id_detalle_param
        WHERE pc.id_plato = v_id_plato
        GROUP BY pc.id_paso, pc.nombre, pc.min_sel, pc.max_sel, pc.orden
        ORDER BY pc.orden
    LOOP
        IF r.elegidos < r.min_sel THEN
            RAISE EXCEPTION 'En "%" debes elegir al menos % opción(es) (elegiste %)', r.nombre, r.min_sel, r.elegidos;
        END IF;
        IF r.elegidos > r.max_sel THEN
            RAISE EXCEPTION 'En "%" puedes elegir máximo % opción(es) (elegiste %)', r.nombre, r.max_sel, r.elegidos;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- ==============================================================================
-- 11. FUNCIÓN (redefinida): obtener_menu_completo
-- Reemplaza la versión de 05_funciones_menu.sql. Conserva todas las claves
-- anteriores y agrega personalizable, calorias y pasos -> ingredientes.
-- Los ingredientes agotados SÍ se devuelven (disponible = false) para que el
-- cliente los muestre deshabilitados en el constructor.
-- ==============================================================================
CREATE OR REPLACE FUNCTION obtener_menu_completo()
RETURNS JSON AS $$
BEGIN
    RETURN COALESCE((
        SELECT json_agg(
            json_build_object(
                'id_categoria', c.id_categoria,
                'categoria', c.nombre,
                'descripcion', c.descripcion,
                'orden', c.orden_visualizacion,
                'platos', COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'id_plato', p.id_plato,
                            'nombre', p.nombre,
                            'descripcion', p.descripcion,
                            'precio', p.precio,
                            'url_imagen', p.url_imagen,
                            'tiempo_estimado', p.tiempo_preparacion_estimado,
                            'personalizable', p.personalizable,
                            'calorias', p.calorias,
                            'pasos', CASE WHEN p.personalizable THEN COALESCE((
                                SELECT json_agg(
                                    json_build_object(
                                        'id_paso', pc.id_paso,
                                        'nombre', pc.nombre,
                                        'orden', pc.orden,
                                        'min_sel', pc.min_sel,
                                        'max_sel', pc.max_sel,
                                        'obligatorio', pc.obligatorio,
                                        'ingredientes', COALESCE((
                                            SELECT json_agg(
                                                json_build_object(
                                                    'id_ingrediente', i.id_ingrediente,
                                                    'nombre', i.nombre,
                                                    'precio_extra', i.precio_extra,
                                                    'calorias', i.calorias,
                                                    'alergenos', i.alergenos,
                                                    'url_imagen', i.url_imagen,
                                                    'disponible', i.disponible
                                                ) ORDER BY i.id_ingrediente ASC
                                            )
                                            FROM ingredientes i
                                            WHERE i.id_paso = pc.id_paso
                                        ), '[]'::json)
                                    ) ORDER BY pc.orden ASC
                                )
                                FROM pasos_constructor pc
                                WHERE pc.id_plato = p.id_plato
                            ), '[]'::json) ELSE '[]'::json END
                        ) ORDER BY p.nombre ASC
                    )
                    FROM platos p
                    WHERE p.id_categoria = c.id_categoria
                      AND p.disponible = TRUE
                ), '[]'::json)
            ) ORDER BY c.orden_visualizacion ASC
        )
        FROM categorias c
        WHERE c.activo = TRUE
    ), '[]'::json);
END;
$$ LANGUAGE plpgsql STABLE;

-- ==============================================================================
-- 12. VISTA (redefinida): v_detalles_completos
-- La versión de 10_vistas.sql calculaba el subtotal sin extras. Se conservan
-- las columnas en el mismo orden y se agregan las nuevas al final.
-- ==============================================================================
CREATE OR REPLACE VIEW v_detalles_completos AS
SELECT
    dp.id_detalle,
    dp.id_pedido,
    pl.id_plato,
    pl.nombre AS plato_nombre,
    cat.nombre AS categoria_nombre,
    dp.cantidad,
    dp.precio_unitario,
    (dp.cantidad * (dp.precio_unitario + dp.precio_extras)) AS subtotal,
    dp.estado_item,
    dp.notas_especiales,
    pl.tiempo_preparacion_estimado,
    pl.disponible,
    dp.creado_en,
    dp.comensal,
    dp.precio_extras,
    pl.personalizable
FROM detalles_pedido dp
JOIN platos pl ON dp.id_plato = pl.id_plato
JOIN categorias cat ON pl.id_categoria = cat.id_categoria;

-- ==============================================================================
-- 13. DOCUMENTACIÓN EN EL CATÁLOGO
-- ==============================================================================
COMMENT ON TABLE pasos_constructor IS
'Pasos ordenados para armar un plato personalizable (Base, Proteína, Acompañantes, Salsas).';
COMMENT ON TABLE ingredientes IS
'Opciones elegibles de cada paso del constructor con recargo, calorías, alérgenos y disponibilidad.';
COMMENT ON TABLE detalles_ingredientes IS
'Ingredientes y porción (ligera, normal, extra) elegidos para cada ítem armado de un pedido; precio_aplicado queda congelado.';
COMMENT ON COLUMN platos.personalizable IS
'TRUE si el plato se arma paso a paso en el constructor.';
COMMENT ON COLUMN detalles_pedido.comensal IS
'Alias del comensal que pidió el ítem; permite dividir la cuenta por persona.';
COMMENT ON COLUMN detalles_pedido.precio_extras IS
'Suma por unidad de los recargos de ingredientes en porción extra. La calcula la base de datos.';
COMMENT ON FUNCTION validar_selecciones_detalle(INTEGER) IS
'Valida min_sel/max_sel de cada paso para un ítem armado. Llamar tras insertar sus ingredientes, en la misma transacción.';
COMMENT ON FUNCTION obtener_menu_completo() IS
'Retorna el menú digital completo en JSON: categorías activas, platos disponibles y, para los personalizables, pasos e ingredientes.
  SELECT obtener_menu_completo();';
