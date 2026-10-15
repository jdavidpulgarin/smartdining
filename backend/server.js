require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const { manejadorErrores } = require('./src/middleware/errores.middleware');
const { exigirEntornoValido } = require('./src/config/verificar-entorno');
const { opcionesCors } = require('./src/config/cors');
const pool = require('./src/config/db');
const { redisClient } = require('./src/config/redis');

const app = express();

// H-10: cabeceras de seguridad. helmet pone nosniff, X-Frame-Options,
// Referrer-Policy y compañía; todas son de una línea y no estorban a una API
// JSON. La CSP por defecto de helmet también se aplica: aquí no se sirve HTML,
// así que no rompe nada.
app.use(helmet());

// Deja de anunciar "Express" en cada respuesta. No es una vulnerabilidad por
// sí misma, pero le dice a quien sondea exactamente qué exploits probar.
app.disable('x-powered-by');

// H-10: CORS con lista blanca en vez de '*' (ver src/config/cors.js).
app.use(cors(opcionesCors()));

/**
 * Detrás de nginx o de Docker, req.ip es la IP del proxy y no la del cliente:
 * sin esto, los límites de intentos contarían a todo el mundo como un solo
 * visitante. Se activa con TRUST_PROXY y está apagado por defecto, porque
 * confiar en X-Forwarded-For sin un proxy delante permite falsificar la IP.
 *
 * Valores: 'true' / '1' (confiar en el primer salto), un número de saltos, o
 * una lista de IPs o rangos que Express acepta tal cual.
 */
if (process.env.TRUST_PROXY) {
  const valor = process.env.TRUST_PROXY;
  const numero = Number(valor);
  app.set('trust proxy', Number.isInteger(numero) ? numero : valor === 'true' ? 1 : valor);
}

app.use(express.json());

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Manejador de errores centralizado: traduce los RAISE EXCEPTION de los
// triggers a 409 y cualquier otro error a 500 genérico.
app.use(manejadorErrores);

const PORT = process.env.PORT || 4000;

/**
 * H-25: apagado ordenado.
 *
 * Sin esto, un `docker stop` (SIGTERM) o un Ctrl+C mataban el proceso en seco:
 * peticiones en vuelo cortadas a media respuesta, transacciones abiertas
 * esperando a que PostgreSQL las deshaga por timeout, y la conexión de Redis
 * colgada hasta que el servidor la expire.
 *
 * El orden no es decorativo:
 *   1. `servidor.close()` deja de aceptar conexiones nuevas y espera a que
 *      terminen las en vuelo. Va PRIMERO para no cerrarle la base a una
 *      petición que todavía la está usando.
 *   2. Redis, que es caché: perderlo no corrompe nada. Solo si está abierto,
 *      porque se conecta de forma perezosa (ver services/cache.js) y puede no
 *      haberse usado nunca en toda la vida del proceso.
 *   3. El pool de PostgreSQL de ÚLTIMO: es el que puede tener transacciones a
 *      medias, y cerrarlo antes de que las peticiones terminen las abortaría.
 *
 * @param {import('http').Server} servidor
 */
function apagadoOrdenado(servidor, { log = console.log, salir = process.exit } = {}) {
  const TIMEOUT_MS = pool.enteroPositivo('APAGADO_TIMEOUT_MS', 10000);
  let apagando = false;

  return async function alRecibirSenal(senal) {
    // Un Ctrl+C impaciente manda la señal dos veces. Sin esta guarda, el
    // segundo pasaría a cerrar un pool que ya se está cerrando.
    if (apagando) return;
    apagando = true;

    log(`\nRecibida ${senal}: cerrando ordenadamente…`);

    // Red de seguridad: si algo no cierra (un socket que no suelta, Redis sin
    // responder), un apagado colgado es peor que uno brusco. `.unref()` para
    // que este temporizador no sea, él mismo, lo que mantenga vivo el proceso.
    const rendirse = setTimeout(() => {
      log(`El cierre no terminó en ${TIMEOUT_MS} ms: se fuerza la salida.`);
      salir(1);
    }, TIMEOUT_MS);
    rendirse.unref();

    try {
      await new Promise((resolve, reject) => {
        servidor.close((err) => (err ? reject(err) : resolve()));
      });

      if (redisClient.isOpen) await redisClient.quit();

      await pool.end();

      clearTimeout(rendirse);
      log('Cerrado: servidor HTTP, Redis y pool de PostgreSQL.');
      salir(0);
    } catch (err) {
      clearTimeout(rendirse);
      console.error('Fallo al cerrar ordenadamente:', err && err.message);
      salir(1);
    }
  };
}

if (require.main === module) {
  // Va aquí y no al cargar el módulo: las pruebas importan `app` con supertest y
  // no deben depender de la configuración real ni poder matar el proceso.
  exigirEntornoValido();
  const servidor = app.listen(PORT, () => console.log(`SmartDining backend corriendo en http://localhost:${PORT}`));

  // Solo bajo require.main, por lo mismo: una prueba que importa `app` no debe
  // quedar con manejadores de señal puestos ni poder cerrarle el pool al runner.
  //
  // SIGUSR2 queda fuera a propósito: es la señal con la que nodemon reinicia, y
  // quien debe atenderla es nodemon. Si la interceptáramos aquí para apagar
  // ordenadamente, el reinicio en desarrollo se convertiría en una salida.
  const alApagar = apagadoOrdenado(servidor);
  process.on('SIGTERM', () => alApagar('SIGTERM'));
  process.on('SIGINT', () => alApagar('SIGINT'));
}

module.exports = app; // exportado para las pruebas con supertest
module.exports.apagadoOrdenado = apagadoOrdenado; // para probarlo con dobles
