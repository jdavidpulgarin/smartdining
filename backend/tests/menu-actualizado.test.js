const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const { instalarFakeSocket, socketCaido, ES_UUID, CLAVE_FALSA } = require('./helpers/fake-socket');
const { CLAVE_CACHE } = require('../src/services/menu.service');
const { esperarAvisos, ACCIONES_MENU, notificarMenuActualizado } = require('../src/services/socket.notifier');
const app = require('../server');

// Regresión: editar un plato (nombre, precio, descripción, imagen) o una opción
// del constructor no le llegaba al comensal hasta recargar. Toda escritura de la
// carta avisa POST /internal/menu-actualizado (EVENTS.md §5.8):
//   - DESPUÉS del COMMIT y DESPUÉS de invalidar la caché del menú: al revés, la
//     PWA reaccionaría pidiendo GET /menu y recibiría la copia vieja;
//   - con el cuerpo EXACTO del contrato (eventId UUID, id_plato, accion): el
//     socket-server es estricto y un campo de más sería un 400;
//   - sin cambiar la respuesta si el socket-server está caído;
//   - solo si la escritura salió bien (ni un 404 ni un 400 avisan).

const RUTA = '/internal/menu-actualizado';
const ID_PLATO = 1003;
const ID_PASO = 301;
const ID_ING = 30;
const PLATO = {
  id_plato: ID_PLATO, id_categoria: 100, nombre: 'Arepa Rellena', descripcion: 'La de siempre',
  precio: '15000.00', url_imagen: null, disponible: true, personalizable: true, tiempo_preparacion_estimado: 12,
};
const PASO = { id_paso: ID_PASO, id_plato: ID_PLATO, nombre: 'Tipo de Arepa', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true };
const ING = {
  id_ingrediente: ID_ING, id_paso: ID_PASO, nombre: 'Arepa de Chócolo', precio_extra: '1500.00',
  calorias: 220, alergenos: [], url_imagen: null, disponible: true,
};
const CATEGORIA = { id_categoria: 100, nombre: 'Arma tu plato', orden_visualizacion: 1, activo: true };

/** Una base que responde a todas las escrituras de la carta. `existe: false` → 404 en todas. */
function dbCarta({ existe = true } = {}) {
  const fila = (f) => ({ rows: existe ? [{ ...f }] : [] });
  return (sql) => {
    if (sql.includes('INSERT INTO platos')) return { rows: [{ ...PLATO }] };
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) return fila(PLATO);
    if (sql.includes('UPDATE platos SET')) return fila(PLATO);
    if (sql.includes('DELETE FROM platos')) return fila({ id_plato: ID_PLATO });
    if (sql.includes('INSERT INTO categorias')) return { rows: [{ ...CATEGORIA }] };
    if (sql.includes('SELECT * FROM categorias WHERE id_categoria')) return fila(CATEGORIA);
    if (sql.includes('UPDATE categorias')) return fila(CATEGORIA);
    if (sql.includes('DELETE FROM categorias')) return fila({ id_categoria: 100 });
    if (sql.includes('INSERT INTO pasos_constructor')) return { rows: [{ ...PASO }] };
    if (sql.includes('FROM pasos_constructor pc WHERE pc.id_paso')) return fila(PASO);
    if (sql.includes('UPDATE pasos_constructor')) return fila(PASO);
    if (sql.includes('DELETE FROM pasos_constructor')) return fila({ id_paso: ID_PASO });
    if (sql.includes('FROM pasos_constructor pc')) return { rows: [] };
    if (sql.includes('INSERT INTO ingredientes')) return { rows: [{ ...ING }] };
    if (sql.includes('FROM ingredientes i WHERE i.id_ingrediente')) return fila(ING);
    if (sql.includes('UPDATE ingredientes')) return fila(ING);
    if (sql.includes('DELETE FROM ingredientes')) return fila({ id_ingrediente: ID_ING });
    return { rows: [] };
  };
}

const admin = () => `Bearer ${tokenStaff(1, 'admin')}`;
const pedir = (metodo, ruta, cuerpo) => {
  const p = request(app)[metodo](ruta).set('Authorization', admin());
  return cuerpo === undefined ? p : p.send(cuerpo);
};

// [método, ruta, cuerpo, status esperado, accion, id_plato]
const ESCRITURAS = [
  ['post', '/api/platos', { nombre: 'Arepa Rellena', precio: 15000, id_categoria: 100 }, 201, 'plato-creado', ID_PLATO],
  ['put', `/api/platos/${ID_PLATO}`, { nombre: 'Arepa Rellena Especial', precio: 16500, descripcion: 'Nueva', url_imagen: 'https://images.unsplash.com/photo-1?w=600' }, 200, 'plato-editado', ID_PLATO],
  ['delete', `/api/platos/${ID_PLATO}`, undefined, 204, 'plato-eliminado', ID_PLATO],
  ['post', '/api/categorias', { nombre: 'Arma tu plato' }, 201, 'categoria-creada', null],
  ['put', '/api/categorias/100', { nombre: 'Arma tu plato ya' }, 200, 'categoria-editada', null],
  ['delete', '/api/categorias/100', undefined, 204, 'categoria-eliminada', null],
  ['post', `/api/platos/${ID_PLATO}/pasos`, { nombre: 'Elige tu Salsa', orden: 5, min_sel: 0, max_sel: 1, obligatorio: false }, 201, 'paso-creado', ID_PLATO],
  ['put', `/api/pasos/${ID_PASO}`, { nombre: 'Tipo de Arepa (elige una)' }, 200, 'paso-editado', ID_PLATO],
  ['delete', `/api/pasos/${ID_PASO}`, undefined, 204, 'paso-eliminado', null],
  ['post', `/api/pasos/${ID_PASO}/ingredientes`, { nombre: 'Arepa de Yuca', precio_extra: 1000 }, 201, 'opcion-creada', ID_PLATO],
  ['put', `/api/ingredientes/${ID_ING}`, { nombre: 'Arepa de Chócolo Dulce', precio_extra: 2000 }, 200, 'opcion-editada', null],
  ['delete', `/api/ingredientes/${ID_ING}`, undefined, 204, 'opcion-eliminada', null],
];

for (const [metodo, ruta, cuerpo, status, accion, idPlato] of ESCRITURAS) {
  test(`${metodo.toUpperCase()} ${ruta}: avisa menu-actualizado (${accion}) después del COMMIT y de invalidar la caché`, async () => {
    const redis = instalarFakeRedis({ inicial: { [CLAVE_CACHE]: [{ categoria: 'vieja' }] } });
    const db = instalarFakeDb(dbCarta());
    // En el instante del aviso, la caché ya no puede estar.
    let cacheAlAvisar = null;
    const socket = instalarFakeSocket((r) => { if (r === RUTA) cacheAlAvisar = redis.tiene(CLAVE_CACHE); return { ok: true }; });
    try {
      const res = await pedir(metodo, ruta, cuerpo);
      await esperarAvisos();
      assert.strictEqual(res.status, status, JSON.stringify(res.body));
      const avisos = socket.todos(RUTA);
      assert.strictEqual(avisos.length, 1, 'un aviso por escritura');
      const [aviso] = avisos;
      assert.deepStrictEqual(Object.keys(aviso.cuerpo).sort(), ['accion', 'eventId', 'id_plato'], 'solo los campos del contrato');
      assert.match(aviso.cuerpo.eventId, ES_UUID);
      assert.deepStrictEqual([aviso.cuerpo.accion, aviso.cuerpo.id_plato], [accion, idPlato]);
      assert.strictEqual(aviso.cabeceras['x-internal-key'], CLAVE_FALSA);
      assert.strictEqual(cacheAlAvisar, false, 'la caché se invalida ANTES del aviso');
    } finally {
      socket.restaurar(); db.restaurar(); redis.restaurar();
    }
  });
}

test('lo que no existe (404) o no valida (400) no avisa', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb(dbCarta({ existe: false }));
  const socket = instalarFakeSocket();
  try {
    for (const [metodo, ruta, cuerpo] of ESCRITURAS.filter(([m]) => m !== 'post')) {
      const res = await pedir(metodo, ruta, cuerpo);
      assert.strictEqual(res.status, 404, `${metodo} ${ruta}`);
    }
    assert.strictEqual((await pedir('put', `/api/platos/${ID_PLATO}`, { precio: -5 })).status, 400);
    assert.strictEqual((await pedir('post', '/api/categorias', {})).status, 400);
    await esperarAvisos();
    assert.deepStrictEqual(socket.todos(RUTA), []);
  } finally {
    socket.restaurar(); db.restaurar(); redis.restaurar();
  }
});

test('con el socket-server caído la edición responde igual (el aviso es un extra)', async () => {
  const redis = instalarFakeRedis();
  const db = instalarFakeDb(dbCarta());
  const socket = socketCaido();
  try {
    const res = await pedir('put', `/api/platos/${ID_PLATO}`, { precio: 16500 });
    await esperarAvisos();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_plato, ID_PLATO);
    assert.strictEqual(socket.todos(RUTA).length, 1, 'se intentó una vez (un caído no se reintenta)');
  } finally {
    socket.restaurar(); db.restaurar(); redis.restaurar();
  }
});

test('ante 503 ERROR_INTERNO reintenta con el MISMO eventId; ante un 400, no', async () => {
  let respuestas = [{ __status: 503, ok: false, codigo: 'ERROR_INTERNO' }, { ok: true }];
  let socket = instalarFakeSocket(() => respuestas.shift());
  try {
    await notificarMenuActualizado('plato-editado', ID_PLATO);
    const intentos = socket.todos(RUTA);
    assert.strictEqual(intentos.length, 2);
    assert.strictEqual(intentos[0].cuerpo.eventId, intentos[1].cuerpo.eventId);
  } finally {
    socket.restaurar();
  }
  respuestas = [{ __status: 400, ok: false, codigo: 'PAYLOAD_INVALIDO' }, { ok: true }];
  socket = instalarFakeSocket(() => respuestas.shift());
  try {
    await notificarMenuActualizado('plato-editado', ID_PLATO);
    assert.strictEqual(socket.todos(RUTA).length, 1);
  } finally {
    socket.restaurar();
  }
});

test('id_plato: el de la URL llega como número; lo que no es un id válido va null', async () => {
  const socket = instalarFakeSocket();
  try {
    await notificarMenuActualizado('plato-eliminado', '1003');
    await notificarMenuActualizado('opcion-editada', undefined);
    await notificarMenuActualizado('opcion-editada', 'abc');
    await notificarMenuActualizado('categoria-editada', null);
    assert.deepStrictEqual(socket.todos(RUTA).map((a) => a.cuerpo.id_plato), [1003, null, null, null]);
  } finally {
    socket.restaurar();
  }
});

test('las acciones del backend son las del contrato del socket-server', () => {
  const { ACCIONES } = require('../../socket-server/src/menu-actualizado');
  assert.deepStrictEqual([...ACCIONES_MENU].sort(), [...ACCIONES].sort());
});
