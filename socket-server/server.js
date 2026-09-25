const { cargarConfig } = require('./src/config');
const { crearServidor } = require('./src/servidor');

const config = cargarConfig();
const { httpServer } = crearServidor(config);

httpServer.listen(config.puerto, () => {
  console.log(`SmartDining socket-server en http://localhost:${config.puerto}`);
  console.log(`Orígenes permitidos: ${config.origenes.join(', ')}`);
});
