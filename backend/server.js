require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./src/routes');
const { manejadorErrores } = require('./src/middleware/errores.middleware');

const app = express();

app.use(cors());
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
  app.listen(PORT, () => console.log(`SmartDining backend corriendo en http://localhost:${PORT}`));
}

module.exports = app; // exportado para las pruebas con supertest
