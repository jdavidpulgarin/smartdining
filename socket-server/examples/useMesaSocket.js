/**
 * Hook de React de referencia para la mesa del comensal.
 *
 *   const { estado, carrito, comensal, enviar, on } = useMesaSocket({ url, token });
 *
 *   // `comensal` ("Ana") viene FIRMADO en el JWT de la sesión: no se manda
 *   // en los eventos. Si se manda uno distinto, el servidor responde NO_AUTORIZADO.
 *   enviar('cart:update', { accion: 'set', id_linea, id_plato: 3, cantidad: 1 })
 *     .then((ack) => ...)                 // el carrito ya se actualizó solo
 *     .catch((e) => mostrar(e.codigo));   // PAYLOAD_INVALIDO, NO_AUTORIZADO, RATE_LIMIT, SIN_RESPUESTA...
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
import { crearClienteMesa, aliasDelToken } from './clienteMesa.js';

const VACIO = { version: 0, items: [] };

export function useMesaSocket({ url, token }) {
  const [cliente, setCliente] = useState(null);
  const [estado, setEstado] = useState(token ? 'conectando' : 'sesion_cerrada');
  const [carrito, setCarrito] = useState(VACIO);

  useEffect(() => {
    if (!url || !token) return undefined;
    // Token o url nuevos = sesión nueva: se crea otro cliente.
    const nuevo = crearClienteMesa({ url, token });
    const bajas = [nuevo.on('estado', setEstado), nuevo.on('carrito', setCarrito)];
    setCliente(nuevo);
    return () => {
      bajas.forEach((baja) => baja());
      nuevo.cerrar();
      setCliente(null);
      setCarrito(VACIO);
    };
  }, [url, token]);

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
    estado, carrito, comensal: aliasDelToken(token), enviar, on,
  };
}
