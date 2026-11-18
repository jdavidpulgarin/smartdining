/**
 * Fixture único con la forma EXACTA de GET /api/menu según backend/docs/api-spec.md
 * y obtener_menu_completo() (database/scripts/13_constructor.sql):
 * - Categorías: { id_categoria, categoria, descripcion, orden, platos } (sin campo "nombre")
 * - Platos: { id_plato, nombre, descripcion, precio, url_imagen, tiempo_estimado, personalizable, calorias, pasos }
 *   (sin campo "disponible", ya que GET /api/menu filtra p.disponible = TRUE)
 * - Pasos: { id_paso, nombre, orden, min_sel, max_sel, obligatorio, ingredientes }
 * - Ingredientes: { id_ingrediente, nombre, precio_extra, calorias, alergenos, url_imagen, disponible }
 */
export const MENU_REAL_FIXTURE = {
  categorias: [
    {
      id_categoria: 1,
      categoria: 'Hamburguesas',
      descripcion: 'Hamburguesas artesanales a la parrilla',
      orden: 1,
      platos: [
        {
          id_plato: 10,
          nombre: 'Hamburguesa Smart Angus',
          descripcion: 'Carne angus jugosa',
          precio: 34000,
          url_imagen: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd',
          tiempo_estimado: 15,
          personalizable: false,
          calorias: 680,
          pasos: [],
        },
        {
          id_plato: 12,
          nombre: 'Bowl Personalizado',
          descripcion: 'Arma tu bowl a tu gusto',
          precio: 28000,
          url_imagen: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd',
          tiempo_estimado: 12,
          personalizable: true,
          calorias: 320,
          pasos: [
            {
              id_paso: 1,
              nombre: 'Elige tu Base',
              orden: 1,
              min_sel: 1,
              max_sel: 1,
              obligatorio: true,
              ingredientes: [
                {
                  id_ingrediente: 101,
                  nombre: 'Arroz Integral',
                  precio_extra: 0,
                  calorias: 130,
                  alergenos: [],
                  url_imagen: null,
                  disponible: true,
                },
                {
                  id_ingrediente: 102,
                  nombre: 'Quinua Orgánica',
                  precio_extra: 3000,
                  calorias: 120,
                  alergenos: [],
                  url_imagen: null,
                  disponible: true,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id_categoria: 2,
      categoria: 'Bebidas',
      descripcion: 'Refrescantes y naturales',
      orden: 2,
      platos: [
        {
          id_plato: 20,
          nombre: 'Limonada Natural',
          descripcion: 'Limón recién exprimido',
          precio: 9000,
          url_imagen: null,
          tiempo_estimado: 5,
          personalizable: false,
          calorias: 90,
          pasos: [],
        },
      ],
    },
  ],
}

export function clonarMenuReal() {
  return JSON.parse(JSON.stringify(MENU_REAL_FIXTURE))
}
