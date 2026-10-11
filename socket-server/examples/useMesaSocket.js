/**
 * Hook de React de referencia para la mesa del comensal.
 *
 *   const { estado, carrito, enviar, on } = useMesaSocket({ url, token, alias: 'Ana' });
 *
 *   enviar('cart:update', { accion: 'set', id_linea, comensal: 'Ana', id_plato: 3, cantidad: 1 })
 *     .then((ack) => ...)                 // el carrito ya se actualizó solo
 *     .catch((e) => mostrar(e.codigo));   // PAYLOAD_INVALIDO, RATE_LIMIT, SIN_RESPUESTA...
 *
 *   useEffect(() => on('order:status', (ev) => ...), [on]);   // se re-suscribe solo
 *
 * Toda la lógica (join en cada reconexión, cola con reintentos por eventId,
 * versiones, fin de sesión) está en clienteMesa.js, probada contra el
 * servidor real (tests/cliente-referencia.test.js). Este archivo solo la
 * conecta con el estado de React.
 *
 * Dependencias: react y socket.io-client (vía clienteMesa.js).
 */
import { useCallback, useEffect, useState } from 'react';
import { crearClienteMesa } from './clienteMesa.js';

const VACIO = { version: 0, items: [] };

export function useMesaSocket({ url, token, alias }) {
  const [cliente, setCliente] = useState(null);
  const [estado, setEstado] = useState(token ? 'conectando' : 'sesion_cerrada');
  const [carrito, setCarrito] = useState(VACIO);

  useEffect(() => {
    if (!url || !token) return undefined;
    // Token, url o alias nuevos = sesión nueva: se crea otro cliente (el
    // alias viaja en cada join:table).
    const nuevo = crearClienteMesa({ url, token, alias });
    const bajas = [nuevo.on('estado', setEstado), nuevo.on('carrito', setCarrito)];
    setCliente(nuevo);
    return () => {
      bajas.forEach((baja) => baja());
      nuevo.cerrar();
      setCliente(null);
      setCarrito(VACIO);
    };
  }, [url, token, alias]);

  const enviar = useCallback((evento, payload) => {
    if (!cliente) {
      return Promise.reject(Object.assign(new Error('Sin conexión a la mesa'), { codigo: 'SIN_CONEXION' }));
    }
    return cliente.enviar(evento, payload);
  }, [cliente]);

  // Cambia de identidad cuando cambia el cliente: los useEffect que dependen
  // de `on` se vuelven a suscribir al socket nuevo.
  const on = useCallback((evento, fn) => (cliente ? cliente.on(evento, fn) : () => {}), [cliente]);

  return {
    estado, carrito, enviar, on,
  };
}
