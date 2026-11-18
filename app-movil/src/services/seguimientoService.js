/**
 * Contratos documentados para seguimiento en tiempo real y notificaciones push (R-23).
 * En Etapa 1 no abre conexión WebSocket ni registra tokens push; solo define
 * los estados y datos de demostración marcados explícitamente como ejemplo.
 */

export const ESTADOS_SEGUIMIENTO_MOVIL = [
  {
    clave: 'recibido',
    etiqueta: 'Recibido',
    descripcion: 'Tu pedido fue recibido por el restaurante.',
  },
  {
    clave: 'en_preparacion',
    etiqueta: 'En preparación',
    descripcion: 'La cocina está preparando tus platos.',
  },
  {
    clave: 'listo',
    etiqueta: 'Listo',
    descripcion: 'Tu pedido está empacado y listo.',
  },
  {
    clave: 'en_camino',
    etiqueta: 'En camino',
    descripcion: 'El domiciliario va hacia tu dirección.',
  },
  {
    clave: 'entregado',
    etiqueta: 'Entregado',
    descripcion: '¡Pedido entregado! Buen provecho.',
  },
];

export const PEDIDO_DEMO_SEGUIMIENTO = {
  esDemostracion: true,
  codigo: 'DEMO-000',
  canal: 'Domicilio (ejemplo)',
  estado: 'en_preparacion',
  items: [
    { nombre: 'Plato de demostración', cantidad: 1, precio: 25000 },
  ],
  total: 25000,
};

/**
 * Punto de integración R-23 (Socket.io):
 * Aquí se suscribirá al canal del pedido en `rt.<DOMINIO>` usando el JWT de D-19
 * para escuchar `order:status` (recibido -> en_preparacion -> listo -> en_camino -> entregado).
 */
export function suscribirSeguimientoSocket(_idPedido, _token, _onEstado) {
  // Pendiente R-23: conectar Socket.io al namespace de pedidos móviles.
  return () => {};
}

/**
 * Punto de integración R-23 (Push Notifications con expo-notifications):
 * Aquí se solicitará permiso de notificaciones y se enviará el Expo Push Token
 * al backend para recibir alertas cuando cambie el estado en segundo plano.
 */
export async function registrarTokenPushMovil(_tokenUsuario) {
  // Pendiente R-23: solicitar permiso push y registrar token en servidor.
  return { registrado: false, motivo: 'R-23 pendiente' };
}
