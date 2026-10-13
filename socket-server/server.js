const { cargarConfig } = require('./src/config');
const { crearServidor } = require('./src/servidor');
const { log } = require('./src/log');
const { crearCierreOrdenado } = require('./src/cierre');

let config;
try {
  config = cargarConfig();
} catch (err) {
  // Configuración insegura o incompleta: se explica qué falta y se sale con
  // código 1, sin traza (el mensaje nunca incluye el valor de un secreto).
  log.error('No se puede iniciar el socket-server de SmartDining', { detalle: err.message });
  process.exit(1);
}
const servidor = crearServidor(config);
const { httpServer } = servidor;

httpServer.listen(config.puerto, () => {
  log.info('socket-server escuchando', {
    puerto: config.puerto, entorno: config.entorno, origenes: config.origenes, redis: Boolean(config.redisUrl), pagos: Boolean(config.wompi),
  });
});

const cierre = crearCierreOrdenado({ httpServer, io: servidor.io, ctx: servidor.ctx });
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    // Red de seguridad: si algo se cuelga en el cierre, se sale igual.
    setTimeout(() => process.exit(1), 15 * 1000).unref();
    cierre.cerrar(senal).then(() => process.exit(0), () => process.exit(1));
  });
}
