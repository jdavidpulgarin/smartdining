import { listarPedidosMesaSimulados } from './pedidoSimulado';
import { aplicarPagoConfirmado } from '../utils/cuenta';

export const CLAVE_CUENTA_SIMULADA = 'smartdining_cuenta_simulada';

/**
 * Obtiene o construye la cuenta simulada para la mesa actual.
 * Lee los pedidos registrados en sessionStorage (locales o recibidos por order:created).
 * Si no hay pedidos previos, crea un desglose inicial de prueba con Ana, Beto y Carla.
 *
 * @param {number|string} [idMesa=5] - ID de la mesa
 * @param {string} [miAlias='Beto'] - Alias del usuario actual
 * @returns {object} Objeto de cuenta con formato idéntico al backend
 */
export function obtenerCuentaSimulada(idMesa = 5, miAlias = 'Beto') {
  try {
    const guardada = sessionStorage.getItem(CLAVE_CUENTA_SIMULADA);
    if (guardada) {
      const parsed = JSON.parse(guardada);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // Si falla la lectura, se recalcula
  }

  const pedidos = listarPedidosMesaSimulados(idMesa);

  if (!pedidos || pedidos.length === 0) {
    // Cuenta inicial por defecto para pruebas visuales en modo simulado
    const cuentaDefault = {
      id_mesa: Number(idMesa) || 5,
      numero: Number(idMesa) || 5,
      estado_mesa: 'ocupada',
      ubicacion: 'Terraza',
      total_mesa: 63000,
      pagado_mesa: 20000,
      saldo_mesa: 43000,
      items_totales: 5,
      sesion_iniciada_en: new Date().toISOString(),
      pedidos: [],
      comensales: [
        { comensal: 'Ana', items_pedidos: 2, subtotal: 20000, pagado: 20000, saldo: 0 },
        { comensal: miAlias || 'Beto', items_pedidos: 2, subtotal: 28000, pagado: 0, saldo: 28000 },
        { comensal: 'Carla', items_pedidos: 1, subtotal: 15000, pagado: 0, saldo: 15000 },
      ],
    };
    try {
      sessionStorage.setItem(CLAVE_CUENTA_SIMULADA, JSON.stringify(cuentaDefault));
    } catch {
      // Ignorar
    }
    return cuentaDefault;
  }

  // Agrupar los pedidos existentes por comensal
  const comensalesMap = new Map();

  for (const pedido of pedidos) {
    const detalles = Array.isArray(pedido.detalles)
      ? pedido.detalles
      : (Array.isArray(pedido.items) ? pedido.items : []);

    for (const d of detalles) {
      const alias = (d.comensal || pedido.comensal || 'General').trim();
      const subtotal = Number(d.subtotal ?? ((d.precioUnitario ?? d.precio ?? 0) * (d.cantidad ?? 1)));
      const cant = Number(d.cantidad ?? 1);

      if (!comensalesMap.has(alias)) {
        comensalesMap.set(alias, {
          comensal: alias,
          items_pedidos: 0,
          subtotal: 0,
          pagado: 0,
          saldo: 0,
        });
      }

      const entry = comensalesMap.get(alias);
      entry.items_pedidos += cant;
      entry.subtotal += subtotal;
      entry.saldo += subtotal;
    }
  }

  const comensales = Array.from(comensalesMap.values());
  const total_mesa = comensales.reduce((acc, c) => acc + c.subtotal, 0);
  const items_totales = comensales.reduce((acc, c) => acc + c.items_pedidos, 0);

  const cuentaCalculada = {
    id_mesa: Number(idMesa) || 5,
    numero: Number(idMesa) || 5,
    estado_mesa: 'ocupada',
    ubicacion: 'Terraza',
    total_mesa,
    pagado_mesa: 0,
    saldo_mesa: total_mesa,
    items_totales,
    sesion_iniciada_en: new Date().toISOString(),
    pedidos,
    comensales,
  };

  try {
    sessionStorage.setItem(CLAVE_CUENTA_SIMULADA, JSON.stringify(cuentaCalculada));
  } catch {
    // Ignorar
  }

  return cuentaCalculada;
}

/**
 * Registra un pago confirmado en el almacenamiento simulado.
 *
 * @param {object} evento - Evento payment:confirmed
 * @returns {object} Cuenta simulada actualizada
 */
export function registrarPagoSimulado(evento = {}) {
  try {
    const raw = sessionStorage.getItem(CLAVE_CUENTA_SIMULADA);
    const cuenta = raw ? JSON.parse(raw) : obtenerCuentaSimulada();
    const actualizada = aplicarPagoConfirmado(cuenta, evento);
    sessionStorage.setItem(CLAVE_CUENTA_SIMULADA, JSON.stringify(actualizada));
    return actualizada;
  } catch {
    return null;
  }
}

/**
 * Añade un pedido nuevo a la cuenta simulada (ej. recibido por order:created).
 *
 * @param {object} pedido - Datos del pedido creado
 */
export function agregarPedidoACuentaSimulada(pedido = {}) {
  try {
    sessionStorage.removeItem(CLAVE_CUENTA_SIMULADA);
    return obtenerCuentaSimulada(pedido.id_mesa || 5);
  } catch {
    return null;
  }
}

export default {
  CLAVE_CUENTA_SIMULADA,
  obtenerCuentaSimulada,
  registrarPagoSimulado,
  agregarPedidoACuentaSimulada,
};
