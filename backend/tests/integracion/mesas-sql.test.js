const test = require('node:test');
const assert = require('node:assert');

/**
 * Crear una mesa contra PostgreSQL de verdad.
 *
 * Existe por un fallo concreto, del mismo tipo que reportes-sql.test.js: el
 * INSERT de mesasService.crear usaba $4 a la vez como valor de la columna
 * estado (varchar) y en `CASE WHEN $4 = $6` (text). PostgreSQL no acepta dos
 * tipos para un mismo parámetro ("inconsistent types deduced for parameter
 * $4"), así que POST /api/mesas daba 500 siempre, con las pruebas de fake-db en
 * verde. Se vio en la prueba manual de P-21 (pestaña Mesas de Configuración).
 *
 * Crea mesas con números altos y las borra al final. Se SALTA sola si no hay
 * base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { Pool } = require('pg');
const pool = require('../../src/config/db');
const mesasService = require('../../src/services/mesas.service');

let sonda = null;
let hayBase = false;
const creadas = [];
// Rango de números de mesa propio de esta suite (#165).
const conNumeroDeMesa = require('../helpers/mesa-prueba').numerosDeMesa('mesas-sql');

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    hayBase = true;
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  if (hayBase && creadas.length) {
    await sonda.query('DELETE FROM mesas WHERE id_mesa = ANY($1::int[])', [creadas]);
  }
  if (sonda) await sonda.end();
  await pool.end();
});

test('crear una mesa libre: PostgreSQL acepta el INSERT y no abre visita', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const mesa = await conNumeroDeMesa((numero) =>
    mesasService.crear({ numero, capacidad: 4, ubicacion: 'Prueba integración' }));
  creadas.push(mesa.id_mesa);

  assert.strictEqual(mesa.estado, 'disponible');
  assert.strictEqual(mesa.capacidad, 4);
  assert.strictEqual(mesa.sesion_iniciada_en, null);
});

test('crear una mesa ya ocupada: arranca con su sesion_iniciada_en', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const mesa = await conNumeroDeMesa((numero) => mesasService.crear({ numero, estado: 'ocupada' }));
  creadas.push(mesa.id_mesa);

  assert.strictEqual(mesa.estado, 'ocupada');
  assert.ok(mesa.sesion_iniciada_en instanceof Date);
  // Sin capacidad ni ubicación, quedan los valores por defecto.
  assert.strictEqual(mesa.capacidad, 4);
  assert.strictEqual(mesa.ubicacion, 'Principal');
});
