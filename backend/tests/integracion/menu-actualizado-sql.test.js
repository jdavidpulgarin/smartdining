const test = require('node:test');
const assert = require('node:assert');

/**
 * menu-actualizado contra PostgreSQL real (EVENTS.md §5.8).
 *
 * Regresión: editar un plato o una opción del constructor no le llegaba al
 * comensal hasta recargar. Ahora cada escritura de la carta avisa al
 * socket-server, y la PWA, al recibirlo, vuelve a pedir GET /api/menu. Lo que
 * solo se ve con la base de verdad: que en el INSTANTE del aviso el COMMIT ya
 * está hecho y GET /api/menu (obtener_menu_completo) ya devuelve lo nuevo. Si
 * el aviso saliera antes, la PWA recargaría el menú viejo y se quedaría con él.
 *
 * El socket-server es el doble (tests/helpers/fake-socket.js): cuando le llega
 * el aviso, consulta el menú real por HTTP. Catálogo propio
 * (tests/helpers/plato-prueba.js) que se borra al final. Se SALTA sola si no hay
 * base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

// Sin Redis: la caché se salta y GET /menu lee siempre de la base.
process.env.REDIS_URL = '';

const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');
const { esperarAvisos } = require('../../src/services/socket.notifier');
const { tokenStaff } = require('../helpers/fake-db');
const { instalarFakeSocket } = require('../helpers/fake-socket');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');

const RUTA = '/internal/menu-actualizado';
let sonda = null;
let admin = null;
let catalogo = null;

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const u = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  admin = u.rows[0] ? `Bearer ${tokenStaff(u.rows[0].id_usuario, 'admin')}` : null;
  catalogo = await crearCatalogoPrueba(sonda, 'menu-actualizado', { receta: true, conConstructor: true });
});

test.after(async () => {
  try {
    if (catalogo) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** El plato y la opción tal como los ve el comensal en GET /api/menu. */
async function enElMenu(idPlato, idIngrediente) {
  const res = await request(app).get('/api/menu');
  assert.strictEqual(res.status, 200);
  for (const c of res.body.categorias) {
    for (const p of c.platos || []) {
      if (p.id_plato !== idPlato) continue;
      const opciones = (p.pasos || []).flatMap((paso) => paso.ingredientes || []);
      return { plato: p, opcion: opciones.find((i) => i.id_ingrediente === idIngrediente) || null };
    }
  }
  return { plato: null, opcion: null };
}

/**
 * Un doble del socket-server que, al recibir el aviso, mira el menú real. La
 * consulta va por supertest (http), no por fetch, así que no pasa por el doble.
 */
function socketQueMiraElMenu(idPlato, idIngrediente) {
  const visto = [];
  const socket = instalarFakeSocket(async (ruta, cuerpo) => {
    if (ruta === RUTA) visto.push({ cuerpo, ...(await enElMenu(idPlato, idIngrediente)) });
    return { ok: true, duplicado: false };
  });
  return { socket, visto };
}

test('editar el plato: al llegar el aviso, GET /api/menu ya trae nombre, precio, descripción e imagen nuevos', async (t) => {
  if (!sonda || !admin) return t.skip('sin base');
  const idPlato = catalogo.constructor.id_plato;
  const { socket, visto } = socketQueMiraElMenu(idPlato, null);
  try {
    const nuevo = {
      nombre: `${catalogo.marca} editado`,
      precio: 16500,
      descripcion: 'Receta nueva con queso costeño',
      url_imagen: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=600',
    };
    const res = await request(app).put(`/api/platos/${idPlato}`).set('Authorization', admin).send(nuevo);
    await esperarAvisos();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(visto.length, 1, 'un aviso');
    assert.deepStrictEqual(visto[0].cuerpo.accion, 'plato-editado');
    assert.strictEqual(visto[0].cuerpo.id_plato, idPlato);
    const { plato } = visto[0];
    assert.ok(plato, 'el plato sigue en el menú');
    assert.deepStrictEqual(
      [plato.nombre, Number(plato.precio), plato.descripcion, plato.url_imagen],
      [nuevo.nombre, nuevo.precio, nuevo.descripcion, nuevo.url_imagen],
      'en el instante del aviso el menú ya es el nuevo'
    );
  } finally {
    socket.restaurar();
  }
});

test('editar una opción del constructor: al llegar el aviso, el menú ya trae su nombre y precio nuevos', async (t) => {
  if (!sonda || !admin) return t.skip('sin base');
  const idPlato = catalogo.constructor.id_plato;
  const idIng = catalogo.constructor.ingredientes[0].id_ingrediente;
  const { socket, visto } = socketQueMiraElMenu(idPlato, idIng);
  try {
    const res = await request(app).put(`/api/ingredientes/${idIng}`).set('Authorization', admin)
      .send({ nombre: `${catalogo.marca} opción`, precio_extra: 2500 });
    await esperarAvisos();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(visto.length, 1);
    assert.strictEqual(visto[0].cuerpo.accion, 'opcion-editada');
    assert.ok(visto[0].opcion, 'la opción está en el menú');
    assert.deepStrictEqual([visto[0].opcion.nombre, Number(visto[0].opcion.precio_extra)], [`${catalogo.marca} opción`, 2500]);
  } finally {
    socket.restaurar();
  }
});

test('un PUT que falla en la base (categoría que no existe) no avisa', async (t) => {
  if (!sonda || !admin) return t.skip('sin base');
  const { socket, visto } = socketQueMiraElMenu(catalogo.plato.id_plato, null);
  try {
    const res = await request(app).put(`/api/platos/${catalogo.plato.id_plato}`).set('Authorization', admin)
      .send({ id_categoria: 2147483000 });
    await esperarAvisos();
    assert.ok(res.status >= 400, `debe fallar: ${res.status}`);
    assert.deepStrictEqual(visto, []);
  } finally {
    socket.restaurar();
  }
});
