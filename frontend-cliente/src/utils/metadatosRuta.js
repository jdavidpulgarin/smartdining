const METADATOS_POR_RUTA = [
  { prefijo: '/menu', titulo: 'Menú · SmartDining', indexable: false },
  { prefijo: '/armar', titulo: 'Arma tu plato · SmartDining', indexable: false },
  { prefijo: '/carrito', titulo: 'Carrito de la mesa · SmartDining', indexable: false },
  { prefijo: '/seguimiento', titulo: 'Seguimiento del pedido · SmartDining', indexable: false },
  { prefijo: '/pago', titulo: 'La cuenta · SmartDining', indexable: false },
  { prefijo: '/despedida', titulo: '¡Gracias por venir! · SmartDining', indexable: false },
  { prefijo: '/dev/ui', titulo: 'UI Showcase · SmartDining', indexable: false },
];

const METADATOS_INICIO = {
  titulo: 'SmartDining - Cliente',
  indexable: true,
};

/**
 * Devuelve título de documento y política robots según la ruta actual.
 * Las pantallas internas de mesa no deben indexarse en buscadores.
 *
 * @param {string} pathname
 * @returns {{ titulo: string, robots: string }}
 */
export function obtenerMetadatosRuta(pathname = '/') {
  const ruta = typeof pathname === 'string' ? pathname : '/';
  const coincidencia = METADATOS_POR_RUTA.find(
    (item) => ruta === item.prefijo || ruta.startsWith(`${item.prefijo}/`)
  );
  const { titulo, indexable } = coincidencia || METADATOS_INICIO;

  return {
    titulo,
    robots: indexable ? 'index, follow' : 'noindex, nofollow',
  };
}
