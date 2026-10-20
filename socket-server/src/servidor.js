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
const { log } = require('./log');
const { crearOrigenCors } = require('./origenes');
const { crearIpCliente } = require('./ip-cliente');
const { crearConexionRedis } = require('./almacen/redis');
const { crearClienteBackend } = require('./backend');
const { crearRotadorQr } = require('./rotacion');
const { limitarEventos, crearLimiteMesas, MAX_BUFFER_BYTES } = require('./limites');
const { crearPasarelaWompi } = require('./pasarelas/wompi');
const { verificarImplementacion } = require('./pasarelas/PasarelaPago');
const {
  crearAlmacenPagosMemoria, crearAlmacenPagosRedis, crearLimitesMemoria, crearLimitesRedis,
} = require('./almacen/pagos');
const { crearAlmacenCarritosRedis } = require('./almacen/carritos-redis');
const { crearRegistroIdempotenciaRedis } = require('./almacen/idempotencia-redis');
const { crearRevocacionesRedis } = require('./almacen/revocaciones-redis');
const { crearAlmacenSuscripcionesRedis } = require('./almacen/suscripciones-redis');
const { crearEstadoMesasRedis } = require('./almacen/mesas-redis');
const { crearDuenosMemoria, crearDuenosRedis } = require('./almacen/duenos');
const {
  registrarSala, crearEstadoMesasMemoria, crearPresencia, rutasSala,
} = require('./sala');

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
  // Se usa la misma política para HTTP (health, webhooks) y para el
  // handshake de Socket.io, así no hay dos que se desincronicen. Es la lista
  // blanca CORS_ORIGINS, más las IP privadas de la Wi-Fi en modo red local
  // (solo con NODE_ENV=development, ver origenes.js).
  const origenCors = crearOrigenCors(config);
  const corsHttp = cors({ origin: origenCors, credentials: true });

  // El contexto se completa más abajo, cuando existe `io`; el router solo lo
  // lee cuando llega una petición, o sea, ya completo.
  const ctx = { config, ipCliente: crearIpCliente(config.proxiesConfiables) };
  const router = crearRouter({ ...rutasBase, ...rutasPedidos, ...rutasQr, ...rutasPush, ...rutasSuscripciones, ...rutasPagos, ...rutasSala }, ctx);

  const httpServer = http.createServer((req, res) => {
    corsHttp(req, res, () => router(req, res));
  });

  const io = new Server(httpServer, {
    cors: { origin: origenCors, methods: ['GET', 'POST'], credentials: true },
    // Al reconectar tras un corte corto, Socket.io recupera la sesión y los
    // eventos perdidos. No basta por sí solo: la garantía de no duplicar la
    // da la idempotencia por eventId (idempotencia.js), que cubre también los
    // cortes largos y los reenvíos manuales del cliente.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
    // Un mensaje más grande que esto se rechaza y se cierra esa conexión.
    maxHttpBufferSize: MAX_BUFFER_BYTES,
  });

  // Redis solo si hay REDIS_URL (en producción es obligatorio, ver config.js).
  // No se espera la conexión para escuchar: mientras no esté lista, /health
  // responde "degradado" y los eventos que tocan estado, ERROR_INTERNO.
  const redis = deps.redis || (config.redisUrl ? crearConexionRedis({ url: config.redisUrl }) : null);
  if (redis) {
    redis.conectar().catch((err) => log.error('redis: no se pudo conectar', { codigo: err.code || err.name }));
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
    duenosPedidos: cliente ? crearDuenosRedis({ cliente }) : crearDuenosMemoria(),
    // Pagos: pasarela (null = pagos apagados), intenciones y límites.
    pasarela: deps.pasarela || (config.wompi ? verificarImplementacion(crearPasarelaWompi(config.wompi)) : null),
    almacenPagos: cliente ? crearAlmacenPagosRedis({ cliente }) : crearAlmacenPagosMemoria(),
    limites: cliente ? crearLimitesRedis({ cliente }) : crearLimitesMemoria(),
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

  // Cliente hacia el backend (servidor a servidor, con x-internal-key).
  ctx.backend = deps.backend || (config.backendUrl
    ? crearClienteBackend({ url: config.backendUrl, claveInterna: config.internalApiKey })
    : null);
  ctx.rotador = crearRotadorQr({
    io, qr: ctx.qr, presencia: ctx.presencia, backend: ctx.backend, intervaloMs: config.rotacionQrMs, ...(deps.rotacion || {}),
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
    ctx.rotador.cerrar(idMesa);
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
  // Durante el cierre ordenado no se aceptan sockets nuevos.
  io.use((socket, next) => (ctx.cerrando ? next(new Error('SERVIDOR_CERRANDO')) : next()));
  io.use(autenticarSocket(config.jwtSecret, { sesionVigente }));
  // Después de autenticar (necesita la mesa del JWT): tope de comensales por mesa.
  ctx.limiteMesas = crearLimiteMesas({
    backend: ctx.backend, capacidadPorDefecto: config.capacidadMesaPorDefecto, ...(deps.limiteMesas || {}),
  });
  io.use(ctx.limiteMesas.middleware());

  io.on('connection', (socket) => {
    // Primero el límite de frecuencia: aplica a todos los eventos que siguen.
    limitarEventos(socket, deps.limiteEventos || {});
    const { rol, id_mesa: idMesaSocket } = socket.data.identidad;
    log.info('socket conectado', {
      socket: socket.id, rol, id_mesa: idMesaSocket, ip: ctx.ipCliente(socket.request),
    });
    registrarSalas(socket, {
      obtenerSnapshot: ctx.carritos.snapshot,
      sesionVigente,
      alCambiarSala: ctx.presencia.programar,
      // Con el primer comensal en la sala, el QR de la mesa deja de rotar.
      alEntrarComensal: ctx.rotador.fijar,
    });
    registrarCarrito(socket, ctx);
    registrarPedidos(socket, ctx);
    registrarSuscripcionesSocket(socket, ctx);
    registrarSala(socket, ctx);
    socket.on('disconnect', (motivo) => log.info('socket desconectado', { socket: socket.id, motivo }));
  });

  // ctx es el contexto real (el que leen el router y los middlewares): el
  // cierre ordenado necesita marcarlo, no una copia.
  return { httpServer, io, ctx, ...ctx };
}

module.exports = { crearServidor };
