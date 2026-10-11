/**
 * Cliente de mesa de referencia para SmartDining (sin React).
 *
 * Implementa lo que pide docs/cliente.md:
 *  - join:table al conectar y en cada reconexión, REEMPLAZANDO el carrito;
 *  - descarte de snapshots con version menor a la local;
 *  - cola de pendientes con reintento por eventId (1 s, 2 s, 4 s, 4 s; 5 intentos);
 *  - fin de sesión ante TOKEN_INVALIDO o mesa:liberada.
 *
 * Única dependencia: socket.io-client. Cópialo tal cual al frontend; el hook
 * useMesaSocket.js lo envuelve para React.
 */
import { io as ioPorDefecto } from 'socket.io-client';

const ESPERA_ACK_MS = 5000;
const MAX_INTENTOS = 5;
const ESPERAS_MS = [1000, 2000, 4000, 4000]; // entre intentos
// Errores que no se arreglan reintentando: se avisa al usuario.
const ERRORES_DEFINITIVOS = ['PAYLOAD_INVALIDO', 'NO_AUTORIZADO', 'RATE_LIMIT', 'SIN_SALA'];
const ERRORES_DE_SESION = ['TOKEN_INVALIDO', 'AUTH_REQUERIDA'];

/** UUID v4 también fuera de contextos seguros (http en la red local). */
export function uuidV4() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * @param {object} opciones
 * @param {string} opciones.url      URL del socket-server (VITE_SOCKET_URL)
 * @param {string} opciones.token    JWT del comensal
 * @param {string} [opciones.alias]  Nombre visible del comensal ("Ana")
 * @param {Function} [opciones.io]   Para pruebas; por defecto el de socket.io-client
 * @param {object} [opciones.esperas] Para pruebas: { ackMs, reintentosMs: [] }
 */
export function crearClienteMesa({
  url, token, alias, io = ioPorDefecto, esperas = {}, opcionesSocket = {},
}) {
  const ackMs = esperas.ackMs ?? ESPERA_ACK_MS;
  const reintentosMs = esperas.reintentosMs ?? ESPERAS_MS;

  let estado = 'conectando'; // conectando | conectado | reconectando | sesion_cerrada
  let carrito = { version: 0, items: [] };
  let enSala = false;
  const cola = []; // { evento, payload, intentos, resolver, rechazar, temporizador }
  const oyentes = new Map(); // nombre -> Set<fn>

  const avisar = (nombre, dato) => {
    for (const fn of oyentes.get(nombre) || []) fn(dato);
  };
  const cambiarEstado = (nuevo) => {
    if (estado === nuevo) return;
    estado = nuevo;
    avisar('estado', estado);
  };
  const reemplazarCarrito = (nuevo) => {
    carrito = nuevo;
    avisar('carrito', carrito);
  };
  /** Snapshot de un ack o de cart:updated: se descarta si es más viejo que el local. */
  const aplicarSnapshot = (nuevo) => {
    if (!nuevo || typeof nuevo.version !== 'number') return;
    if (nuevo.version < carrito.version) return;
    reemplazarCarrito(nuevo);
  };

  const socket = io(url, {
    auth: { token },
    transports: ['websocket', 'polling'],
    ...opcionesSocket,
  });

  function cerrarSesion(motivo) {
    cambiarEstado('sesion_cerrada');
    enSala = false;
    for (const p of cola.splice(0)) {
      clearTimeout(p.temporizador);
      p.rechazar(Object.assign(new Error('La sesión de la mesa terminó'), { codigo: motivo }));
    }
    reemplazarCarrito({ version: 0, items: [] });
    socket.disconnect();
    avisar('sesion_cerrada', motivo);
  }

  function intentar(p) {
    if (!enSala || estado === 'sesion_cerrada') return; // se reenvía tras el join:table
    p.intentos += 1;
    socket.timeout(ackMs).emit(p.evento, p.payload, (errTimeout, ack) => {
      if (!cola.includes(p)) return; // ya resuelto (p. ej. sesión cerrada)
      if (!errTimeout && ack && ack.ok) {
        cola.splice(cola.indexOf(p), 1);
        if (ack.carrito) aplicarSnapshot(ack.carrito);
        p.resolver(ack);
        return;
      }
      if (!errTimeout && ack && ERRORES_DEFINITIVOS.includes(ack.codigo)) {
        cola.splice(cola.indexOf(p), 1);
        p.rechazar(Object.assign(new Error(ack.mensaje || ack.codigo), { codigo: ack.codigo, ack }));
        return;
      }
      // ERROR_INTERNO o sin ack: reintento con espera creciente.
      if (p.intentos >= MAX_INTENTOS) {
        cola.splice(cola.indexOf(p), 1);
        p.rechazar(Object.assign(new Error('No se pudo enviar después de varios intentos'), { codigo: 'SIN_RESPUESTA' }));
        return;
      }
      const espera = reintentosMs[Math.min(p.intentos - 1, reintentosMs.length - 1)];
      p.temporizador = setTimeout(() => intentar(p), espera);
    });
  }

  function unirse() {
    enSala = false;
    const datos = alias ? { comensal: alias } : {};
    socket.timeout(ackMs).emit('join:table', datos, (errTimeout, ack) => {
      if (errTimeout) return; // se reintenta en la siguiente reconexión
      if (!ack || !ack.ok) {
        if (ack && ack.codigo === 'NO_AUTORIZADO') cerrarSesion('NO_AUTORIZADO');
        return;
      }
      // REEMPLAZAR siempre con el snapshot del join, aunque su version sea
      // menor (el servidor pudo reiniciarse sin Redis).
      reemplazarCarrito(ack.carrito || { version: 0, items: [] });
      enSala = true;
      cambiarEstado('conectado');
      // Ahora sí, reenviar lo pendiente con sus mismos eventId.
      for (const p of cola) {
        clearTimeout(p.temporizador);
        intentar(p);
      }
    });
  }

  socket.on('connect', unirse);
  socket.on('disconnect', () => {
    enSala = false;
    if (estado !== 'sesion_cerrada') cambiarEstado('reconectando');
  });
  socket.on('connect_error', (err) => {
    if (ERRORES_DE_SESION.includes(err.message)) cerrarSesion(err.message);
    else if (estado !== 'sesion_cerrada') cambiarEstado('reconectando');
  });
  socket.on('cart:updated', (ev) => aplicarSnapshot(ev && ev.carrito));
  socket.on('mesa:liberada', (ev) => {
    avisar('mesa:liberada', ev);
    cerrarSesion('MESA_LIBERADA');
  });

  return {
    get estado() { return estado; },
    get carrito() { return carrito; },
    get pendientes() { return cola.length; },
    /**
     * Encola un evento que cambia estado. Le pone eventId si no lo trae (una
     * sola vez: los reintentos reutilizan el mismo). Resuelve con el ack o
     * rechaza con un Error que lleva .codigo.
     */
    enviar(evento, payload = {}) {
      if (estado === 'sesion_cerrada') {
        return Promise.reject(Object.assign(new Error('La sesión de la mesa terminó'), { codigo: 'SESION_CERRADA' }));
      }
      return new Promise((resolver, rechazar) => {
        const p = {
          evento, payload: { ...payload, eventId: payload.eventId || uuidV4() }, intentos: 0, resolver, rechazar,
        };
        cola.push(p);
        intentar(p);
      });
    },
    /** Escucha eventos del servidor o del cliente ('estado', 'carrito', 'sesion_cerrada'). Devuelve la baja. */
    on(nombre, fn) {
      if (!oyentes.has(nombre)) {
        oyentes.set(nombre, new Set());
        if (!['estado', 'carrito', 'sesion_cerrada', 'mesa:liberada'].includes(nombre)) {
          socket.on(nombre, (dato) => avisar(nombre, dato));
        }
      }
      oyentes.get(nombre).add(fn);
      return () => oyentes.get(nombre).delete(fn);
    },
    cerrar() {
      for (const p of cola.splice(0)) clearTimeout(p.temporizador);
      socket.disconnect();
    },
    socket,
  };
}
