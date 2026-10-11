const { cargarConfig } = require('./src/config');
const { crearServidor } = require('./src/servidor');
const { log } = require('./src/log');

let config;
try {
  config = cargarConfig();
} catch (err) {
  // Configuración insegura o incompleta: se explica qué falta y se sale con
  // código 1, sin traza (el mensaje nunca incluye el valor de un secreto).
  log.error('No se puede iniciar el socket-server de SmartDining', { detalle: err.message });
  process.exit(1);
}
const { httpServer } = crearServidor(config);

httpServer.listen(config.puerto, () => {
  log.info('socket-server escuchando', {
    puerto: config.puerto, entorno: config.entorno, origenes: config.origenes, redis: Boolean(config.redisUrl), pagos: Boolean(config.wompi),
  });
});
