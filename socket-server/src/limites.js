const { fallo } = require('./ack');
const { ROL_COMENSAL } = require('./auth');

// 16 KB por mensaje: un cart:update con 30 ingredientes ocupa ~2 KB. Más que
// eso solo sirve para hacer trabajar al servidor parseando basura.
const MAX_BUFFER_BYTES = 16 * 1024;
// 20 eventos por segundo por socket: una persona tocando la pantalla no llega
// ni cerca; un script que inunda el servidor, sí.
const MAX_EVENTOS_POR_SEGUNDO = 20;
const VENTANA_MS = 1000;
// Sobre la capacidad de la mesa se dejan 4 conexiones de margen (pestañas
// repetidas, reconexiones que se cruzan, un acompañante que llegó tarde).
const MARGEN_CONEXIONES = 4;
const CAPACIDAD_CACHE_MS = 5 * 60 * 1000;

/**
 * Middleware por socket: máximo MAX_EVENTOS_POR_SEGUNDO eventos en cualquier
 * ventana de 1 s (deslizante, no por segundo de reloj: no se puede "gastar"
 * el cupo al final de un segundo y otra vez al inicio del siguiente).
 * Un evento rechazado no se procesa; si trae ack, recibe RATE_LIMIT.
 */
function limitarEventos(socket, { max = MAX_EVENTOS_POR_SEGUNDO, ventanaMs = VENTANA_MS, ahora = Date.now } = {}) {
  const marcas = []; // instantes de los eventos aceptados dentro de la ventana
  socket.use((paquete, next) => {
    const t = ahora();
    while (marcas.length && marcas[0] <= t - ventanaMs) marcas.shift();
    if (marcas.length >= max) {
      const ack = paquete[paquete.length - 1];
      if (typeof ack === 'function') ack(fallo('RATE_LIMIT', 'Demasiados eventos; espera un momento'));
      return undefined; // no se llama a next: el evento se descarta
    }
    marcas.push(t);
    return next();
  });
}

/**
 * Conexiones de comensal por mesa, como máximo capacidad + MARGEN_CONEXIONES.
 * La capacidad sale del backend (GET /api/mesas/:id, ruta pública) con caché
 * de 5 min; si no se puede consultar, se usa `capacidadPorDefecto`.
 * Se cuenta en el handshake, así una mesa llena rechaza la conexión antes de
 * que el socket exista (connect_error MESA_LLENA).
 */
function crearLimiteMesas({ backend, capacidadPorDefecto = 6, ahora = Date.now, log = console } = {}) {
  const conexiones = new Map(); // idMesa -> sockets de comensal conectados
  const capacidades = new Map(); // idMesa -> { capacidad, vence }

  async function capacidadDe(idMesa) {
    const c = capacidades.get(idMesa);
    if (c && c.vence > ahora()) return c.capacidad;
    let capacidad = capacidadPorDefecto;
    if (backend) {
      try {
        const r = await backend.get(`/api/mesas/${idMesa}`);
        if (r.ok && r.cuerpo && Number.isInteger(r.cuerpo.capacidad) && r.cuerpo.capacidad > 0 && r.cuerpo.capacidad <= 50) {
          capacidad = r.cuerpo.capacidad;
        }
      } catch (err) {
        log.warn?.(`[limites] capacidad de la mesa ${idMesa} no disponible (${err.codigo || err.message}); se usa ${capacidadPorDefecto}`);
      }
    }
    capacidades.set(idMesa, { capacidad, vence: ahora() + CAPACIDAD_CACHE_MS });
    return capacidad;
  }

  /** Middleware de io.use (va después de autenticarSocket). */
  function middleware() {
    return (socket, next) => {
      const identidad = socket.data.identidad;
      if (!identidad || identidad.rol !== ROL_COMENSAL) return next();
      const idMesa = identidad.id_mesa;
      capacidadDe(idMesa).then((capacidad) => {
        const actuales = conexiones.get(idMesa) || 0;
        if (actuales >= capacidad + MARGEN_CONEXIONES) return next(new Error('MESA_LLENA'));
        conexiones.set(idMesa, actuales + 1);
        socket.once('disconnect', () => {
          const n = (conexiones.get(idMesa) || 1) - 1;
          if (n <= 0) conexiones.delete(idMesa); else conexiones.set(idMesa, n);
        });
        return next();
      }, () => next(new Error('ERROR_INTERNO')));
    };
  }

  return { middleware, capacidadDe, conectados: (idMesa) => conexiones.get(idMesa) || 0 };
}

module.exports = {
  limitarEventos, crearLimiteMesas, MAX_BUFFER_BYTES, MAX_EVENTOS_POR_SEGUNDO, MARGEN_CONEXIONES,
};
