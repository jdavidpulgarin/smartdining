#!/usr/bin/env node
/**
 * Prueba de carga del socket-server: 20 mesas × 4 comensales × 5 cart:update.
 *
 * Mide, en milisegundos:
 *  - ack: desde que un comensal emite cart:update hasta que recibe su ack;
 *  - broadcast: desde esa emisión hasta que CADA uno de los otros 3
 *    comensales de la mesa recibe el cart:updated con ese eventId;
 * y la memoria del proceso antes y después.
 *
 * Uso:
 *   npm run carga                          # levanta un servidor en este proceso
 *   REDIS_URL=redis://localhost:6379 npm run carga   # el mismo, con Redis
 *   CARGA_URL=http://localhost:4001 npm run carga    # contra un servidor ya levantado
 *
 * Contra un servidor externo, los JWT se generan con el script del proyecto
 * (npm run token:comensal), que usa el JWT_SECRET de socket-server/.env:
 * debe ser el mismo del servidor.
 *
 * Opciones: CARGA_MESAS (20), CARGA_COMENSALES (4), CARGA_ACTUALIZACIONES (5),
 * CARGA_SALIDA=archivo.json para guardar el resultado.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { io: cliente } = require('socket.io-client');

const MESAS = Number(process.env.CARGA_MESAS) || 20;
const COMENSALES = Number(process.env.CARGA_COMENSALES) || 4;
const ACTUALIZACIONES = Number(process.env.CARGA_ACTUALIZACIONES) || 5;
const META_P95_MS = 300;
const RAIZ = path.join(__dirname, '..', '..');

const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
function percentil(valores, p) {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const i = Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1);
  return Math.round(orden[Math.max(0, i)] * 100) / 100;
}
const resumen = (v) => ({
  muestras: v.length, p50: percentil(v, 50), p95: percentil(v, 95), p99: percentil(v, 99), max: percentil(v, 100),
});

/** Servidor en este mismo proceso, con secretos aleatorios (nada del .env). */
async function servidorLocal() {
  process.env.LOG_NIVEL = process.env.LOG_NIVEL || 'warn';
  const { cargarConfig } = require('../../src/config');
  const { crearServidor } = require('../../src/servidor');
  const azar = () => crypto.randomBytes(32).toString('hex');
  const jwtSecret = azar();
  const config = cargarConfig({
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_SECRET: jwtSecret,
    QR_SECRET: azar(),
    INTERNAL_API_KEY: azar(),
    MESA_CAPACIDAD_POR_DEFECTO: String(Math.max(COMENSALES, 1)),
    ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
  });
  const s = crearServidor(config);
  if (s.redis) await s.redis.conectar();
  await new Promise((r) => s.httpServer.listen(0, r));
  const jwt = require('jsonwebtoken');
  return {
    url: `http://localhost:${s.httpServer.address().port}`,
    // Mismo payload que firma scripts/token-comensal.js (con el alias, como el backend).
    token: (idMesa, comensal) => jwt.sign({ id_mesa: idMesa, rol: 'comensal', comensal }, jwtSecret, { algorithm: 'HS256', expiresIn: '1h' }),
    almacen: s.redis ? 'redis' : 'memoria',
    cerrar: async () => { await new Promise((r) => s.io.close(r)); if (s.redis) await s.redis.cerrar(); },
  };
}

/** Servidor externo: tokens con `npm run token:comensal -- --mesa N --comensal C`. */
function servidorExterno(url) {
  const cache = new Map();
  return {
    url,
    token(idMesa, comensal) {
      const clave = `${idMesa}:${comensal}`;
      if (!cache.has(clave)) {
        const salida = execFileSync(process.execPath, ['scripts/token-comensal.js', '--mesa', String(idMesa), '--comensal', comensal, '--horas', '1'], { cwd: RAIZ, encoding: 'utf8' });
        cache.set(clave, salida.trim().split('\n').pop().trim());
      }
      return cache.get(clave);
    },
    almacen: 'externo',
    cerrar: async () => {},
  };
}

function conectar(url, token) {
  return new Promise((resolve, reject) => {
    const c = cliente(url, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 10000 });
    c.once('connect', () => resolve(c));
    c.once('connect_error', (e) => reject(new Error(`connect_error: ${e.message}`)));
  });
}
const emitirAck = (c, evento, datos) => new Promise((resolve) => c.timeout(10000).emit(evento, datos, (err, ack) => resolve(err ? { ok: false, codigo: 'TIMEOUT' } : ack)));

async function main() {
  const objetivo = process.env.CARGA_URL ? servidorExterno(process.env.CARGA_URL) : await servidorLocal();
  const memoriaInicial = process.memoryUsage();
  const latAck = [];
  const latBroadcast = [];
  const errores = [];
  const emitidos = new Map(); // eventId -> instante de emisión
  const sockets = [];

  // 1) Conexión y join:table de todos (80 sockets).
  const inicioConexion = performance.now();
  for (let m = 1; m <= MESAS; m += 1) {
    for (let k = 0; k < COMENSALES; k += 1) {
      const idMesa = 1000 + m; // mesas altas: no chocan con datos de desarrollo
      const c = await conectar(objetivo.url, objetivo.token(idMesa, `C${k + 1}`));
      const join = await emitirAck(c, 'join:table', {});
      if (!join || !join.ok) errores.push({ fase: 'join', codigo: join && join.codigo });
      c.on('cart:updated', (ev) => {
        const t0 = emitidos.get(ev.eventId);
        if (t0 !== undefined) latBroadcast.push(performance.now() - t0);
      });
      sockets.push({ c, idMesa, alias: `C${k + 1}` });
    }
  }
  const msConexion = Math.round(performance.now() - inicioConexion);

  // 2) Todos los comensales a la vez, cada uno con sus 5 actualizaciones en serie.
  const inicioCarga = performance.now();
  await Promise.all(sockets.map(async ({ c, alias }) => {
    for (let i = 0; i < ACTUALIZACIONES; i += 1) {
      const eventId = crypto.randomUUID();
      const t0 = performance.now();
      emitidos.set(eventId, t0);
      const ack = await emitirAck(c, 'cart:update', {
        eventId, accion: 'set', id_linea: crypto.randomUUID(), comensal: alias, id_plato: 1 + (i % 5), cantidad: 1 + i,
      });
      latAck.push(performance.now() - t0);
      if (!ack || !ack.ok) errores.push({ fase: 'cart:update', codigo: ack && ack.codigo });
    }
  }));
  const msCarga = Math.round(performance.now() - inicioCarga);
  await new Promise((r) => setTimeout(r, 500)); // últimos broadcasts en vuelo

  const memoriaFinal = process.memoryUsage();
  const esperadosBroadcast = MESAS * COMENSALES * ACTUALIZACIONES * (COMENSALES - 1);
  const ack = resumen(latAck);
  const resultado = {
    fecha: new Date().toISOString(),
    node: process.version,
    plataforma: `${process.platform} ${process.arch}`,
    almacen: objetivo.almacen,
    escenario: {
      mesas: MESAS, comensales_por_mesa: COMENSALES, actualizaciones_por_comensal: ACTUALIZACIONES, sockets: sockets.length,
    },
    tiempos_ms: { conexion_y_join: msConexion, carga: msCarga },
    eventos: {
      cart_update: latAck.length,
      cart_updated_esperados: esperadosBroadcast,
      cart_updated_recibidos: latBroadcast.length,
      por_segundo: Math.round((latAck.length / msCarga) * 1000),
    },
    latencia_ack_ms: ack,
    latencia_broadcast_ms: resumen(latBroadcast),
    memoria_mb: {
      rss_antes: mb(memoriaInicial.rss), rss_despues: mb(memoriaFinal.rss), heap_antes: mb(memoriaInicial.heapUsed), heap_despues: mb(memoriaFinal.heapUsed),
    },
    errores: errores.length,
    detalle_errores: errores.slice(0, 10),
    meta: {
      p95_ack_ms: META_P95_MS,
      cumple: errores.length === 0 && ack.p95 !== null && ack.p95 < META_P95_MS && latBroadcast.length === esperadosBroadcast,
    },
  };

  sockets.forEach(({ c }) => c.close());
  await objetivo.cerrar();
  const texto = JSON.stringify(resultado, null, 2);
  process.stdout.write(`${texto}\n`);
  if (process.env.CARGA_SALIDA) fs.writeFileSync(process.env.CARGA_SALIDA, `${texto}\n`);
  process.exitCode = resultado.meta.cumple ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`La prueba de carga falló: ${err.message}\n`);
  process.exitCode = 1;
});
