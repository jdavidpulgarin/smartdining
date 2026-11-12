// Lo compartido por order-created.test.js y order-created-fallas.test.js
// (se dividió para que cada archivo quede lejos del límite de 10 s).
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

const CLAVE = CLAVE_INTERNA;
const pedido = (id_pedido = 87, id_mesa = 5) => ({
  id_pedido, codigo_pedido: `PED-${id_pedido}`, id_mesa, estado: 'recibido', total: 56000, items: [{ id_plato: 3, cantidad: 2 }],
});
const post = (s, ruta, cuerpo, clave = CLAVE) => fetch(`${s.url}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

async function escenario() {
  const s = await levantar({});
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', {});
  await emitir(mesa6, 'join:table', {});
  return { s, cocina, admin, mesero, mesa5, mesa6 };
}

// Cada prueba del carrito corre con el almacén en memoria y con el doble de Redis.
const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({}),
  redis: () => ({
    redis: crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso }),
  }),
};
// Como lo manda el backend: cada ítem con el alias (del JWT) de quien lo pidió.
const pedidoDe = (...alias) => ({ ...pedido(), items: alias.map((comensal) => ({ id_plato: 3, cantidad: 1, comensal })) });
const comensalesDe = (carrito) => carrito.items.map((i) => i.comensal);

/** Mesa 5 con Ana (2 líneas) y Beto (1 línea) en el carrito. */
async function mesaConAnaYBeto(t, deps) {
  const s = await levantar({}, deps);
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5, 'Ana'));
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(ana, 'join:table', {});
  await emitir(beto, 'join:table', {});
  const agregar = async (c) => (await emitir(c, 'cart:update', {
    eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), id_plato: 3, cantidad: 1,
  })).carrito;
  await agregar(ana);
  await agregar(ana);
  const antes = await agregar(beto);
  return { s, ana, beto, antes, agregar };
}

module.exports = {
  CLAVE, pedido, post, escenario, silencioso, ALMACENES, pedidoDe, comensalesDe, mesaConAnaYBeto,
};
