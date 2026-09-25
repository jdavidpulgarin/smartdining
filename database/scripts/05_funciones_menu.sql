-- ==============================================================================
-- PROYECTO: SmartDining
-- SCRIPT: 05_funciones_menu.sql
-- MÓDULO: Paquete 4 - Gestión de Menú, Carta Digital y Catálogo Gastronómico
-- ==============================================================================

-- 1. OBTENER CATEGORÍAS ACTIVAS DE LA CARTA
CREATE OR REPLACE FUNCTION obtener_categorias_activas()
RETURNS TABLE (
    id_categoria INTEGER,
    nombre VARCHAR,
    descripcion TEXT,
    orden_visualizacion INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id_categoria,
        c.nombre,
        c.descripcion,
        c.orden_visualizacion
    FROM categorias c
    WHERE c.activo = TRUE
    ORDER BY c.orden_visualizacion ASC, c.nombre ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. OBTENER PLATOS ACTIVOS POR CATEGORÍA
CREATE OR REPLACE FUNCTION obtener_platos_por_categoria(id_categoria_param INTEGER)
RETURNS TABLE (
    id_plato INTEGER,
    nombre VARCHAR,
    descripcion TEXT,
    precio DECIMAL(10,2),
    url_imagen VARCHAR,
    tiempo_preparacion_estimado INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id_plato,
        p.nombre,
        p.descripcion,
        p.precio,
        p.url_imagen,
        p.tiempo_preparacion_estimado
    FROM platos p
    WHERE p.id_categoria = id_categoria_param
      AND p.disponible = TRUE
    ORDER BY p.nombre ASC;
END;
$$ LANGUAGE plpgsql STABLE;

-- 3. OBTENER PLATOS MÁS PEDIDOS (TOP DESTACADOS)
CREATE OR REPLACE FUNCTION obtener_platos_destacados(limite_param INTEGER DEFAULT 10)
RETURNS TABLE (
    id_plato INTEGER,
    nombre VARCHAR,
    categoria VARCHAR,
    precio DECIMAL(10,2),
    total_veces_pedido BIGINT,
    unidades_vendidas NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id_plato,
        p.nombre,
        c.nombre AS categoria,
        p.precio,
        COUNT(dp.id_detalle) AS total_veces_pedido,
        COALESCE(SUM(dp.cantidad), 0) AS unidades_vendidas
    FROM platos p
    JOIN categorias c ON p.id_categoria = c.id_categoria
    LEFT JOIN detalles_pedido dp ON p.id_plato = dp.id_plato
    WHERE p.disponible = TRUE
    GROUP BY p.id_plato, p.nombre, c.nombre, p.precio
    ORDER BY unidades_vendidas DESC, total_veces_pedido DESC
    LIMIT limite_param;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. ACTUALIZAR DISPONIBILIDAD DE PLATO CON AUDITORÍA
CREATE OR REPLACE FUNCTION actualizar_disponibilidad_plato(
    id_plato_param INTEGER,
    disponible_param BOOLEAN,
    razon_param VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_anterior BOOLEAN;
BEGIN
    SELECT disponible INTO v_anterior 
    FROM platos 
    WHERE id_plato = id_plato_param 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Plato con ID % no encontrado', id_plato_param;
    END IF;

    IF v_anterior = disponible_param THEN
        RETURN TRUE; -- Sin cambio
    END IF;

    UPDATE platos
    SET disponible = disponible_param
    WHERE id_plato = id_plato_param;

    -- Registrar evento en auditoría
    INSERT INTO auditoria_cambios (
        tabla_afectada,
        operacion,
        registro_id,
        datos_anteriores,
        datos_nuevos,
        hash_verificacion
    ) VALUES (
        'platos',
        'UPDATE',
        id_plato_param,
        jsonb_build_object('disponible', v_anterior),
        jsonb_build_object('disponible', disponible_param, 'razon', razon_param),
        md5(format('platos_disponibilidad_%s_%s', id_plato_param, clock_timestamp()))
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- 5. OBTENER DETALLE COMPLETO DE UN PLATO
CREATE OR REPLACE FUNCTION obtener_detalles_plato(id_plato_param INTEGER)
RETURNS JSON AS $$
DECLARE
    v_resultado JSON;
BEGIN
    SELECT json_build_object(
        'id_plato', p.id_plato,
        'nombre', p.nombre,
        'descripcion', p.descripcion,
        'precio', p.precio,
        'url_imagen', p.url_imagen,
        'disponible', p.disponible,
        'tiempo_preparacion_estimado', p.tiempo_preparacion_estimado,
        'categoria', json_build_object(
            'id_categoria', c.id_categoria,
            'nombre', c.nombre
        ),
        'creado_en', p.creado_en
    ) INTO v_resultado
    FROM platos p
    JOIN categorias c ON p.id_categoria = c.id_categoria
    WHERE p.id_plato = id_plato_param;

    IF v_resultado IS NULL THEN
        RAISE EXCEPTION 'Plato % no existe', id_plato_param;
    END IF;

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. OBTENER MENÚ DIGITAL COMPLETO ESTRUCTURADO
CREATE OR REPLACE FUNCTION obtener_menu_completo()
RETURNS JSON AS $$
BEGIN
    RETURN (
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
                            'tiempo_estimado', p.tiempo_preparacion_estimado
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
    );
END;
$$ LANGUAGE plpgsql STABLE;
