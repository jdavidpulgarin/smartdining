import { ErrorApi } from './api';

export async function crearPedidoSimulado({ lineas = [], notasGenerales = '' } = {}) {
  await new Promise((resolve) => setTimeout(resolve, 400));

  const hayAgotado =
    /agotado/i.test(notasGenerales || '') ||
    lineas.some((l) =>
      /agotado/i.test(l.notas || l.notasCliente || l.notasCocina || '')
    );

  if (hayAgotado) {
    throw new ErrorApi({
      status: 409,
      motivo: 'agotado',
      mensaje: 'El plato o ingrediente seleccionado se agotó. Revisa tu pedido.',
    });
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomSuffix = '';
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const id_pedido = Math.floor(1000 + Math.random() * 9000);
  const codigo_pedido = `PED-${randomSuffix}`;

  const total = lineas.reduce((acc, linea) => {
    const precio = Number(linea.precioUnitario ?? linea.precio ?? 0);
    const cantidad = Number(linea.cantidad ?? 1);
    return acc + precio * cantidad;
  }, 0);

  return {
    id_pedido,
    codigo_pedido,
    id_mesa: 5,
    estado: 'recibido',
    total,
  };
}

export default {
  crearPedidoSimulado,
};
