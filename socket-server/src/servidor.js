const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { autenticarSocket } = require('./auth');
const { registrarSalas } = require('./salas');
const { crearRegistroIdempotencia } = require('./idempotencia');
const { crearAlmacenCarritos, registrarCarrito } = require('./carrito');
const { registrarPedidos, rutasPedidos } = require('./pedidos');
const { crearServicioQr, derivarSecretoQr, rutasQr } = require('./qr');
const { crearServicioPush, rutasPush } = require('./push');
const { crearRouter, enviarJson } = require('./http');

const rutasBase = {
  'GET /health': async (req, res) => enviarJson(res, 200, { estado: 'ok' }),
};

/**
 * Construye el servidor HTTP + Socket.io sin ponerlo a escuchar, para que
 * las pruebas puedan levantarlo en un puerto efímero.
 */
function crearServidor(config) {
  // Se usa la misma lista blanca para HTTP (health, webhooks) y para el
  // handshake de Socket.io, así no hay dos políticas que se desincronicen.
  const corsHttp = cors({ origin: config.origenes, credentials: true });

  // El contexto se completa más abajo, cuando existe `io`; el router solo lo
  // lee cuando llega una petición, o sea, ya completo.
  const ctx = { config };
  const router = crearRouter({ ...rutasBase, ...rutasPedidos, ...rutasQr, ...rutasPush }, ctx);

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

  // Estado compartido por todos los sockets de esta instancia.
  Object.assign(ctx, {
    io,
    registro: crearRegistroIdempotencia(),
    carritos: crearAlmacenCarritos(),
    push: crearServicioPush(config),
    qr: crearServicioQr({ secreto: derivarSecretoQr(config), ttlMinutosPorDefecto: config.qrTtlMinutos }),
  });

  // Sin JWT válido no se entra: todo socket que llega a 'connection' ya tiene
  // una identidad verificada en socket.data.identidad.
  io.use(autenticarSocket(config.jwtSecret));

  io.on('connection', (socket) => {
    console.log(`[socket] conectado ${socket.id} (${socket.data.identidad.rol})`);
    registrarSalas(socket, { obtenerSnapshot: ctx.carritos.snapshot });
    registrarCarrito(socket, ctx);
    registrarPedidos(socket, ctx);
    socket.on('disconnect', (motivo) => console.log(`[socket] ${socket.id} desconectado: ${motivo}`));
  });

  return { httpServer, io, ...ctx };
}

module.exports = { crearServidor };
