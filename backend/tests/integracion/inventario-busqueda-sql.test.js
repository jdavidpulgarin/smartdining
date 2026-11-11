const test = require('node:test');
const assert = require('node:assert');

/**
 * `q` como TEXTO LITERAL en las búsquedas de inventario, contra PostgreSQL real.
 *
 * Antes el texto del usuario se usaba como patrón de ILIKE: q=% traía todo,
 * q=_ casaba cualquier nombre y una barra invertida podía romper el patrón.
 * Ahora se escapan \, % y _ (patronDeBusqueda) y las consultas llevan
 * ESCAPE '\' explícito.
 *
 * Crea sus propios insumos con un prefijo aleatorio y los borra en el after
 * (con su libro de movimientos), aunque una prueba falle. La carta se prueba
 * sobre el seed, sin crear nada.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const crypto = require('node:crypto');
const { Pool } = require('pg');
const pool = require('../../src/config/db');
const inventario = require('../../src/services/inventario.service');

const PREFIJO = `QLIT${crypto.randomBytes(3).toString('hex')}`;
const BARRA = '\\';

let sonda = null;
let hayBase = false;
const creados = [];

/** Nombres con comodines LITERALES, y uno normal. */
const NOMBRES = {
  guion: `${PREFIJO} carne_angus`,
  porciento: `${PREFIJO} queso 50% graso`,
  barra: `${PREFIJO} salsa a${BARRA}b`,
  normal: `${PREFIJO} Carne molida`,
};

test.before(async () => {
  try {
    sonda = new Pool({ connectionTimeoutMillis: 2000 });
    await sonda.query('SELECT 1');
    hayBase = true;
    // Uno de ellos bajo el minimo, para la busqueda de estado=bajo.
    for (const [clave, nombre] of Object.entries(NOMBRES)) {
      const { insumo } = await inventario.crearInsumo(
        { nombre, unidad: 'g', stock_minimo: clave === 'guion' ? 100 : 0, stock_inicial: clave === 'guion' ? undefined : 10 },
        { idUsuario: null }
      );
      creados.push(insumo.id_insumo);
    }
  } catch {
    hayBase = false;
  }
});

test.after(async () => {
  try {
    if (hayBase && creados.length) {
      await sonda.query('DELETE FROM movimientos_inventario WHERE id_insumo = ANY($1::int[])', [creados]);
      await sonda.query('DELETE FROM insumos WHERE id_insumo = ANY($1::int[])', [creados]);
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Nombres que devuelve listarInsumos, solo los de esta prueba. */
async function buscar(q, extra = {}) {
  const filas = await inventario.listarInsumos({ q, limite: 500, ...extra });
  return filas.map((f) => f.nombre).filter((n) => n.startsWith(PREFIJO)).sort();
}

test('q=% ya no trae todo: solo el nombre con un % literal', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const todos = await inventario.listarInsumos({ limite: 500 });
  const conPorciento = await inventario.listarInsumos({ q: '%', limite: 500 });

  assert.ok(todos.length > 4, 'hay insumos');
  assert.ok(conPorciento.length < todos.length, 'q=% ya no es "todo"');
  assert.ok(conPorciento.every((f) => f.nombre.includes('%')), 'solo nombres con % literal');
  assert.deepStrictEqual(await buscar('%'), [NOMBRES.porciento]);
});

test('q=_ solo trae nombres con un guion bajo literal', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const filas = await inventario.listarInsumos({ q: '_', limite: 500 });
  assert.ok(filas.every((f) => f.nombre.includes('_')), 'ninguno sin _');
  assert.deepStrictEqual(await buscar('_'), [NOMBRES.guion]);
  assert.deepStrictEqual(await buscar('carne_'), [NOMBRES.guion]);
  assert.deepStrictEqual(await buscar('carne_m'), [], 'carne_m no casa "Carne molida": el _ ya no es comodin');
});

test('una barra invertida no rompe la consulta y se busca tal cual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  assert.deepStrictEqual(await buscar(BARRA), [NOMBRES.barra]);
  assert.deepStrictEqual(await buscar(`a${BARRA}b`), [NOMBRES.barra]);
  assert.deepStrictEqual(await buscar(`${BARRA}%`), [], 'barra + % literal: nadie lo tiene');
  assert.deepStrictEqual(await buscar(`a${BARRA}`), [NOMBRES.barra], 'una barra al final no deja el patron abierto');
});

test('una busqueda normal sigue igual, sin distinguir mayusculas', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  assert.deepStrictEqual(await buscar('carne'), [NOMBRES.guion, NOMBRES.normal].sort());
  assert.deepStrictEqual(await buscar('CARNE'), [NOMBRES.guion, NOMBRES.normal].sort());
  assert.deepStrictEqual(await buscar(PREFIJO), Object.values(NOMBRES).sort(), 'el prefijo los trae a todos');
});

test('estado=bajo tambien busca literal', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  assert.deepStrictEqual(await buscar('_', { estado: 'bajo' }), [NOMBRES.guion]);
  assert.deepStrictEqual(await buscar('%', { estado: 'bajo' }), [], 'el del % no esta bajo el minimo');
});

test('la carta: q=% ya no trae toda la carta; una busqueda normal si encuentra', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');
  const todo = await inventario.obtenerCarta({});
  const conPorciento = await inventario.obtenerCarta({ q: '%' });
  assert.ok(todo.platos.length > 0, 'el seed tiene platos');
  assert.ok(conPorciento.platos.every((p) => p.nombre.includes('%')));
  assert.ok(conPorciento.ingredientes.every((i) => i.nombre.includes('%')));
  assert.ok(conPorciento.platos.length < todo.platos.length, 'q=% ya no es "todo"');

  const primero = todo.platos[0].nombre;
  const palabra = primero.split(' ')[0].toUpperCase();
  const encontrados = await inventario.obtenerCarta({ q: palabra });
  assert.ok(encontrados.platos.some((p) => p.nombre === primero), `"${palabra}" encuentra "${primero}" sin distinguir mayusculas`);
});
