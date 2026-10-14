import { pedirJson } from './api';
import { obtenerSesion } from '../utils/sesion';

/**
 * Servicio de creación y gestión de pedidos para el comensal.
 *
 * H-05: El alias del comensal sale exclusivamente del JWT firmado al unirse a la mesa.
 * El cliente no necesita ni debe mandar 'comensal' o 'apodo' en el cuerpo del pedido;
 * el backend lo infiere directamente del token.
 *
 * H-06: Límites de pedidos: máximo 50 ítems en total y entre 1 y 20 por ítem.
 */
export async function crearPedido({ lineas = [], notasGenerales = '' } = {}) {
  const sesion = obtenerSesion();
  const token = sesion?.token;

  if (!lineas || lineas.length === 0) {
    throw new Error('No hay ítems para crear el pedido');
  }

  if (lineas.length > 50) {
    throw new Error('Un pedido no puede contener más de 50 ítems');
  }

  // Mapear líneas omitiendo 'comensal' / 'apodo' (H-05) y ajustando topes (H-06)
  const items = lineas.map((linea) => {
    const item = {
      id_plato: Number(linea.id_plato || linea.idPlato),
      cantidad: Math.min(20, Math.max(1, Math.floor(Number(linea.cantidad) || 1))),
    };

    const nota = linea.notas || linea.notasCocina || linea.notasCliente;
    if (typeof nota === 'string' && nota.trim()) {
      item.notas = nota.trim();
    }

    if (Array.isArray(linea.selecciones) && linea.selecciones.length > 0) {
      item.ingredientes = linea.selecciones.map((sel) => ({
        id_ingrediente: Number(sel.id_ingrediente || sel.idIngrediente),
        porcion: sel.porcion || 'normal',
      }));
    }

    return item;
  });

  return pedirJson('/pedidos', {
    method: 'POST',
    body: {
      items,
      ...(notasGenerales?.trim() ? { notas_generales: notasGenerales.trim() } : {}),
    },
    token,
  });
}

export default {
  crearPedido,
};
