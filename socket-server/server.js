const { cargarConfig } = require('./src/config');
const { crearServidor } = require('./src/servidor');

let config;
try {
  config = cargarConfig();
} catch (err) {
  // Configuración insegura o incompleta: se explica qué falta y se sale con
  // código 1, sin traza (el mensaje nunca incluye el valor de un secreto).
  console.error(`\nNo se puede iniciar el socket-server de SmartDining.\n${err.message}\n`);
  process.exit(1);
}
const { httpServer } = crearServidor(config);

httpServer.listen(config.puerto, () => {
  console.log(`SmartDining socket-server en http://localhost:${config.puerto}`);
  console.log(`Orígenes permitidos: ${config.origenes.join(', ')}`);
});
