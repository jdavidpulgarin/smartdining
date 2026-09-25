const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { autenticarSocket } = require('./auth');
const { registrarSalas } = require('./salas');

/**
 * Construye el servidor HTTP + Socket.io sin ponerlo a escuchar, para que
 * las pruebas puedan levantarlo en un puerto efímero.
 */
function crearServidor(config) {
  // Se usa la misma lista blanca para HTTP (health, webhooks) y para el
  // handshake de Socket.io, así no hay dos políticas que se desincronicen.
  const corsHttp = cors({ origin: config.origenes, credentials: true });

  const httpServer = http.createServer((req, res) => {
    corsHttp(req, res, () => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ estado: 'ok' }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ruta no encontrada' }));
    });
  });

  const io = new Server(httpServer, {
    cors: { origin: config.origenes, methods: ['GET', 'POST'], credentials: true },
    // Al reconectar tras un corte corto, Socket.io recupera la sesión y los
    // eventos perdidos; ayuda a no perder cart:update. La idempotencia real
    // (id de evento + ack) se implementa en las actividades 4-6.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  // Sin JWT válido no se entra: todo socket que llega a 'connection' ya tiene
  // una identidad verificada en socket.data.identidad.
  io.use(autenticarSocket(config.jwtSecret));

  io.on('connection', (socket) => {
    console.log(`[socket] conectado ${socket.id} (${socket.data.identidad.rol})`);
    registrarSalas(socket);
    socket.on('disconnect', (motivo) => console.log(`[socket] ${socket.id} desconectado: ${motivo}`));
  });

  return { httpServer, io };
}

module.exports = { crearServidor };
