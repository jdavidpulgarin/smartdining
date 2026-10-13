const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { io: cliente } = require('socket.io-client');
const { cargarConfig } = require('../src/config');
const { crearServidor } = require('../src/servidor');

// Secretos aleatorios por ejecución: ninguno queda escrito en el repositorio y
// todos cumplen las reglas de arranque (32+ caracteres, distintos entre sí).
const aleatorio = () => crypto.randomBytes(32).toString('hex');
const SECRETO = aleatorio();
const CLAVE_INTERNA = aleatorio();
const SECRETO_QR = aleatorio();
const ENV_BASE = { JWT_SECRET: SECRETO, INTERNAL_API_KEY: CLAVE_INTERNA, QR_SECRET: SECRETO_QR };
const ORIGEN = 'http://localhost:5173';

const firmar = (payload, secreto = SECRETO, opts = {}) => jwt.sign(payload, secreto, { expiresIn: '1h', ...opts });
const tokenComensal = (id_mesa) => firmar({ id_mesa, rol: 'comensal' });
const tokenPantalla = (id_mesa) => firmar({ id_mesa, rol: 'pantalla' });
const tokenPersonal = (rol, id_usuario = 1) => firmar({ id_usuario, rol });

async function levantar(extraEnv = {}, deps = {}) {
  const config = cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE, ...extraEnv });
  const servidor = crearServidor(config, deps);
  await new Promise((r) => servidor.httpServer.listen(0, r));
  const url = `http://localhost:${servidor.httpServer.address().port}`;
  const clientes = [];

  // Conecta y espera al 'connect'; rechaza con el error de connect_error.
  const conectar = (token) => new Promise((resolve, reject) => {
    const c = cliente(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    clientes.push(c);
    c.on('connect', () => resolve(c));
    c.on('connect_error', (e) => reject(e));
  });

  const cerrar = async () => {
    clientes.forEach((c) => c.close());
    await servidor.io.close();
  };
  return { ...servidor, url, conectar, cerrar, config };
}

// Emite con ack como promesa.
const emitir = (socket, evento, payload) => new Promise((res) => socket.emit(evento, payload, res));

// Espera un evento con timeout, o devuelve null si no llega (para probar aislamiento).
const esperar = (socket, evento, ms = 300) => new Promise((res) => {
  const h = (d) => { clearTimeout(t); res(d); };
  const t = setTimeout(() => { socket.off(evento, h); res(null); }, ms);
  socket.once(evento, h);
});

module.exports = {
  levantar, emitir, esperar, tokenComensal, tokenPantalla, tokenPersonal, firmar, aleatorio, SECRETO, CLAVE_INTERNA, ENV_BASE, ORIGEN,
};
