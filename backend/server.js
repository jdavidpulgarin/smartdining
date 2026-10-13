require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./src/routes');
const { manejadorErrores } = require('./src/middleware/errores.middleware');
const { exigirEntornoValido } = require('./src/config/verificar-entorno');
const { opcionesCors } = require('./src/config/cors');

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

if (require.main === module) {
  // Va aquí y no al cargar el módulo: las pruebas importan `app` con supertest y
  // no deben depender de la configuración real ni poder matar el proceso.
  exigirEntornoValido();
  app.listen(PORT, () => console.log(`SmartDining backend corriendo en http://localhost:${PORT}`));
}

module.exports = app; // exportado para las pruebas con supertest
