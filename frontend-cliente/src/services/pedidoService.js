import { pedirJson } from './api';
import { obtenerSesion } from '../utils/sesion';

export const NOTAS_MAX_SERVIDOR = 200;
export const NOTAS_GENERALES_MAX_SERVIDOR = 500;
export const MAX_INGREDIENTES_POR_ITEM = 20;

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
  if (!lineas || lineas.length === 0) {
    throw new Error('No hay ítems para crear el pedido');
  }

  if (lineas.length > 50) {
    throw new Error('Un pedido no puede contener más de 50 ítems');
  }

  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const { crearPedidoSimulado } = await import('./pedidoSimulado');
    return crearPedidoSimulado({ lineas, notasGenerales });
  }

  const sesion = obtenerSesion();
  const token = sesion?.token;

  // Mapear líneas omitiendo 'comensal', 'apodo', 'precio' y ajustando topes
  const items = lineas.map((linea) => {
    const item = {
      id_plato: Number(linea.id_plato || linea.idPlato),
      cantidad: Math.min(20, Math.max(1, Math.floor(Number(linea.cantidad) || 1))),
    };

    const nota = linea.notas || linea.notasCocina || linea.notasCliente;
    if (typeof nota === 'string' && nota.trim()) {
      item.notas = nota.trim().slice(0, NOTAS_MAX_SERVIDOR);
    }

    let ingredientesRaw = null;
    if (Array.isArray(linea.ingredientes) && linea.ingredientes.length > 0) {
      ingredientesRaw = linea.ingredientes;
    } else if (Array.isArray(linea.selecciones) && linea.selecciones.length > 0) {
      ingredientesRaw = linea.selecciones;
    }

    if (ingredientesRaw && ingredientesRaw.length > 0) {
      if (ingredientesRaw.length > MAX_INGREDIENTES_POR_ITEM) {
        throw new Error(`Un plato no puede superar ${MAX_INGREDIENTES_POR_ITEM} ingredientes`);
      }

      const idsVistos = new Set();
      const ingredientes = ingredientesRaw.map((ing) => {
        const id_ingrediente = Number(ing.id_ingrediente ?? ing.idIngrediente);
        if (idsVistos.has(id_ingrediente)) {
          throw new Error('No se pueden repetir ingredientes en el mismo ítem');
        }
        idsVistos.add(id_ingrediente);

        return {
          id_ingrediente,
          porcion: ing.porcion || 'normal',
        };
      });

      item.ingredientes = ingredientes;
    }

    return item;
  });

  const body = { items };
  if (typeof notasGenerales === 'string' && notasGenerales.trim()) {
    body.notas_generales = notasGenerales.trim().slice(0, NOTAS_GENERALES_MAX_SERVIDOR);
  }

  return pedirJson('/pedidos', {
    method: 'POST',
    body,
    token,
  });
}

/**
 * Lista los pedidos de la mesa actual para el comensal.
 * El backend extrae el id_mesa directamente del JWT del comensal.
 *
 * @param {number|string|null} [idMesa] - Opcional, usado en modo simulado para filtrar
 * @returns {Promise<Array<object>>} Lista de pedidos de la mesa
 */
export async function listarPedidosMesa(idMesa = null) {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const { listarPedidosMesaSimulados } = await import('./pedidoSimulado');
    return listarPedidosMesaSimulados(idMesa);
  }

  const sesion = obtenerSesion();
  const token = sesion?.token;

  const data = await pedirJson('/pedidos/mesa', {
    method: 'GET',
    token,
  });

  return Array.isArray(data?.pedidos) ? data.pedidos : [];
}

export default {
  NOTAS_MAX_SERVIDOR,
  NOTAS_GENERALES_MAX_SERVIDOR,
  MAX_INGREDIENTES_POR_ITEM,
  crearPedido,
  listarPedidosMesa,
};
