const { createClient } = require('redis');

// Prefijo común de todas las llaves del socket-server. El backend comparte la
// misma instancia de Redis (caché del menú): con el prefijo no hay choques.
const PREFIJO = 'sd:';

/**
 * Conexión a Redis con reconexión y estado consultable para /health.
 *
 * Decisiones:
 * - disableOfflineQueue: si Redis se cae, cada comando falla AL INSTANTE en vez
 *   de quedar encolado en memoria esperando. Así un evento de socket responde
 *   ERROR_INTERNO enseguida (el cliente reintenta con su eventId) en lugar de
 *   colgar el ack, y la cola no crece sin límite durante la caída.
 * - reconnectStrategy con espera creciente y tope de 5 s: reintenta para
 *   siempre, sin martillar a un Redis que está arrancando.
 * - El error de conexión solo va al log (sin la URL, que puede llevar la
 *   contraseña): un 'error' sin escuchar tumbaría el proceso.
 */
function crearConexionRedis({ url, crearCliente = createClient, log = console } = {}) {
  if (!url) throw new Error('crearConexionRedis requiere url');

  const cliente = crearCliente({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (intentos) => Math.min(100 * 2 ** Math.min(intentos, 6), 5000),
    },
  });

  let estado = 'desconectado';
  let ultimoErrorLog = 0;
  cliente.on('ready', () => { estado = 'conectado'; log.info?.('[redis] conectado'); });
  cliente.on('end', () => { estado = 'desconectado'; });
  cliente.on('reconnecting', () => { estado = 'reconectando'; });
  cliente.on('error', (err) => {
    if (estado === 'conectado') estado = 'reconectando';
    // Durante una caída llegan errores en cada reintento: uno cada 10 s basta.
    const t = Date.now();
    if (t - ultimoErrorLog > 10000) {
      ultimoErrorLog = t;
      log.error?.(`[redis] error de conexión: ${err.code || err.name || 'desconocido'}`);
    }
  });

  return {
    cliente,
    /** 'conectado' | 'reconectando' | 'desconectado' */
    estado: () => (cliente.isReady ? 'conectado' : estado),
    disponible: () => Boolean(cliente.isReady),
    async conectar() {
      if (!cliente.isOpen) await cliente.connect();
    },
    async cerrar() {
      if (cliente.isOpen) await cliente.quit();
    },
  };
}

module.exports = { crearConexionRedis, PREFIJO };
