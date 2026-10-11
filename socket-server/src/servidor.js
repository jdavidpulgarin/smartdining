const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { autenticarSocket } = require('./auth');
const { registrarSalas, salaMesa, SALA_ADMIN } = require('./salas');
const { ROL_COMENSAL } = require('./auth');
const { crearRegistroIdempotencia } = require('./idempotencia');
const { crearAlmacenCarritos, registrarCarrito } = require('./carrito');
const { registrarPedidos, rutasPedidos } = require('./pedidos');
const { crearServicioQr, derivarSecretoQr, rutasQr } = require('./qr');
const { crearServicioPush, rutasPush } = require('./push');
const {
  crearAlmacenSuscripciones, registrarSuscripcionesSocket, rutasSuscripciones, MAX_SUSCRIPCIONES_POR_MESA,
} = require('./suscripciones');
const { rutasPagos } = require('./pagos');
const { crearRouter, enviarJson } = require('./http');
const { crearConexionRedis } = require('./almacen/redis');
const { crearAlmacenCarritosRedis } = require('./almacen/carritos-redis');
const { crearRegistroIdempotenciaRedis } = require('./almacen/idempotencia-redis');
const { crearRevocacionesRedis } = require('./almacen/revocaciones-redis');
const { crearAlmacenSuscripcionesRedis } = require('./almacen/suscripciones-redis');
const { crearEstadoMesasRedis } = require('./almacen/mesas-redis');
const { registrarSala, crearEstadoMesasMemoria, crearPresencia } = require('./sala');

const rutasBase = {
  /**
   * Estado para Docker, Nginx y el despliegue. Con Redis configurado pero sin
   * conexión responde 503 "degradado": el proceso vive, pero no puede atender
   * eventos que cambian estado (responden ERROR_INTERNO) y no debe recibir
   * tráfico nuevo. Sin REDIS_URL (solo desarrollo) informa "memoria".
   */
  'GET /health': async (req, res, ctx) => {
    if (!ctx.redis) return enviarJson(res, 200, { estado: 'ok', redis: 'memoria' });
    const redis = ctx.redis.estado();
    if (!ctx.redis.disponible()) return enviarJson(res, 503, { estado: 'degradado', redis });
    return enviarJson(res, 200, { estado: 'ok', redis });
  },
};

/**
 * Construye el servidor HTTP + Socket.io sin ponerlo a escuchar, para que
 * las pruebas puedan levantarlo en un puerto efímero.
 */
function crearServidor(config, deps = {}) {
  // Se usa la misma lista blanca para HTTP (health, webhooks) y para el
  // handshake de Socket.io, así no hay dos políticas que se desincronicen.
  const corsHttp = cors({ origin: config.origenes, credentials: true });

  // El contexto se completa más abajo, cuando existe `io`; el router solo lo
  // lee cuando llega una petición, o sea, ya completo.
  const ctx = { config };
  const router = crearRouter({ ...rutasBase, ...rutasPedidos, ...rutasQr, ...rutasPush, ...rutasSuscripciones, ...rutasPagos }, ctx);

  const httpServer = http.createServer((req, res) => {
    corsHttp(req, res, () => router(req, res));
  });

  const io = new Server(httpServer, {
    cors: { origin: config.origenes, methods: ['GET', 'POST'], credentials: true },
    // Al reconectar tras un corte corto, Socket.io recupera la sesión y los
    // eventos perdidos. No basta por sí solo: la garantía de no duplicar la
    // da la idempotencia por eventId (idempotencia.js), que cubre también los
    // cortes largos y los reenvíos manuales del cliente.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  // Redis solo si hay REDIS_URL (en producción es obligatorio, ver config.js).
  // No se espera la conexión para escuchar: mientras no esté lista, /health
  // responde "degradado" y los eventos que tocan estado, ERROR_INTERNO.
  const redis = deps.redis || (config.redisUrl ? crearConexionRedis({ url: config.redisUrl }) : null);
  if (redis) {
    redis.conectar().catch((err) => console.error(`[redis] no se pudo conectar: ${err.code || err.name}`));
  }

  // Estado compartido por todos los sockets de esta instancia.
  // Con Redis todo el estado sobrevive a un reinicio y se comparte entre
  // instancias (carritos atómicos, idempotencia con SET NX, revocaciones de
  // QR y suscripciones); sin REDIS_URL, fuera de producción, vive en memoria.
  const cliente = redis ? redis.cliente : null;
  // Registro de pagos con TTL de 7 días: los proveedores de pago reintentan
  // durante días, mucho más que los 10 min de los eventos de socket.
  const TTL_PAGOS_MS = 7 * 24 * 60 * 60 * 1000;
  const registro = cliente ? crearRegistroIdempotenciaRedis({ cliente }) : crearRegistroIdempotencia();
  Object.assign(ctx, {
    io,
    redis,
    registro,
    carritos: cliente ? crearAlmacenCarritosRedis({ cliente }) : crearAlmacenCarritos({ registro }),
    registroPagos: cliente
      ? crearRegistroIdempotenciaRedis({ cliente, ttlMs: TTL_PAGOS_MS })
      : crearRegistroIdempotencia({ ttlMs: TTL_PAGOS_MS }),
    estadoMesas: cliente ? crearEstadoMesasRedis({ cliente }) : crearEstadoMesasMemoria(),
    presencia: crearPresencia({ io, ...(deps.presencia || {}) }),
    // `deps.push` permite a las pruebas inyectar un servicio push falso.
    push: deps.push || crearServicioPush(config),
    suscripciones: cliente
      ? crearAlmacenSuscripcionesRedis({ cliente, maxPorMesa: MAX_SUSCRIPCIONES_POR_MESA })
      : crearAlmacenSuscripciones(),
    qr: crearServicioQr({
      secreto: derivarSecretoQr(config),
      ttlMinutosPorDefecto: config.qrTtlMinutos,
      ...(cliente ? { revocaciones: crearRevocacionesRedis({ cliente }) } : {}),
    }),
  });

  // Mesas ya liberadas que aún no tienen sesión nueva. Hace idempotente a
  // liberarMesa: el backend puede reintentar el aviso sin que se repita el
  // evento ni se revoquen los QR de una sesión que acaba de empezar.
  const mesasLiberadas = new Set();
  // Una mesa vuelve a tener sesión cuando el personal le genera un QR nuevo.
  ctx.reabrirMesa = (idMesa) => mesasLiberadas.delete(idMesa);

  // Cuando el backend libera la mesa (al pagar o a mano) termina la sesión de
  // mesa: se invalidan sus QR, se avisa en vivo y se borra el estado de esa
  // sesión, para que el siguiente grupo empiece limpio y no reciba avisos del
  // anterior.
  ctx.liberarMesa = async (idMesa, motivo = 'liberada') => {
    if (mesasLiberadas.has(idMesa)) return { duplicado: true };
    mesasLiberadas.add(idMesa);
    await ctx.qr.revocarMesa(idMesa);
    // ANTES de vaciar el carrito: quien lo reciba todavía puede mostrar qué
    // quedó sin pedir. Al panel le sirve para pintar la mesa libre al instante.
    io.to(salaMesa(idMesa)).to(SALA_ADMIN).emit('mesa:liberada', {
      id_mesa: idMesa,
      motivo,
      emitidoEn: new Date().toISOString(),
    });
    await ctx.suscripciones.limpiarMesa(idMesa);
    await ctx.estadoMesas.limpiarMesa(idMesa);
    await ctx.carritos.vaciar(idMesa);
    // Solo se echa a los comensales: la pantalla de la mesa sigue conectada
    // para mostrar el QR del siguiente grupo, y el personal sigue vigilando.
    const enSala = await io.in(salaMesa(idMesa)).fetchSockets();
    for (const s of enSala) {
      if (s.data.identidad && s.data.identidad.rol === ROL_COMENSAL) s.disconnect(true);
    }
    return { duplicado: false };
  };

  // Sesión de comensal vigente = su JWT es posterior a la última liberación de
  // su mesa. El personal y la pantalla no dependen de la sesión de mesa.
  const sesionVigente = async (identidad) => identidad.rol !== ROL_COMENSAL
    || !(await ctx.qr.revocadaDespuesDe(identidad.id_mesa, identidad.iat));

  // Sin JWT válido no se entra: todo socket que llega a 'connection' ya tiene
  // una identidad verificada en socket.data.identidad.
  io.use(autenticarSocket(config.jwtSecret, { sesionVigente }));

  io.on('connection', (socket) => {
    console.log(`[socket] conectado ${socket.id} (${socket.data.identidad.rol})`);
    registrarSalas(socket, {
      obtenerSnapshot: ctx.carritos.snapshot, sesionVigente, alCambiarSala: ctx.presencia.programar,
    });
    registrarCarrito(socket, ctx);
    registrarPedidos(socket, ctx);
    registrarSuscripcionesSocket(socket, ctx);
    registrarSala(socket, ctx);
    socket.on('disconnect', (motivo) => console.log(`[socket] ${socket.id} desconectado: ${motivo}`));
  });

  return { httpServer, io, ...ctx };
}

module.exports = { crearServidor };
