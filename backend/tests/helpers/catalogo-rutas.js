/**
 * Catálogo de las rutas de la API: la tabla de datos de la que viven las
 * pruebas de seguridad del D-11.
 *
 * Está aquí, y no dentro de una prueba, porque la usan tres archivos:
 * `matriz-roles.test.js` (quién entra en cada ruta), `sin-fuga-en-errores.test.js`
 * (que ninguna respuesta de error cuente de más) e `inyeccion-sql.test.js` (los
 * `:id` y los parámetros de consulta). Mantener tres copias de la misma lista
 * sería mantener tres listas que se desincronizan.
 *
 * `tests/helpers/rutas-registradas.js` lee las rutas REALES del router y
 * `matriz-roles.test.js` compara las dos: si alguien añade una ruta y no la
 * declara aquí, la suite falla.
 */

const { instalarFakeDb, tokenStaff, tokenComensal } = require('./fake-db');
const { instalarFakeSocket } = require('./fake-socket');
const request = require('supertest');
const app = require('../../server');

const ROLES_STAFF = ['admin', 'mesero', 'cajero', 'cocina'];
const TODOS_LOS_ROLES = [...ROLES_STAFF, 'comensal'];

/** Mesa que usan las rutas con :id, y la del JWT de comensal. */
const MESA = 5;

const PUBLICA = 'publica';
const INTERNA = 'interna';

/**
 * `patron` tiene que coincidir letra por letra con lo que devuelve
 * `rutasRegistradas()`; `url` es la que se pide de verdad.
 */
const TABLA = [
  // --- Públicas: no llevan Authorization ------------------------------------
  { metodo: 'GET', patron: '/api/health', url: '/api/health', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/categorias', url: '/api/categorias', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/categorias/:id', url: '/api/categorias/2', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/platos', url: '/api/platos', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/platos/:id', url: '/api/platos/7', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/menu', url: '/api/menu', acceso: PUBLICA },
  { metodo: 'GET', patron: '/api/mesas/:id', url: `/api/mesas/${MESA}`, acceso: PUBLICA },
  {
    metodo: 'POST',
    patron: '/api/auth/login',
    url: '/api/auth/login',
    acceso: PUBLICA,
    cuerpo: { email: 'nadie@mail.com', password: 'secreta123' },
  },
  {
    metodo: 'POST',
    patron: '/api/mesas/qr/:token/sesion',
    url: '/api/mesas/qr/token-cualquiera/sesion',
    acceso: PUBLICA,
    cuerpo: {},
  },

  // --- Internas: x-internal-key, sin JWT ------------------------------------
  {
    metodo: 'GET',
    patron: '/api/mesas/:id/cuenta/interno',
    url: `/api/mesas/${MESA}/cuenta/interno`,
    acceso: INTERNA,
  },
  {
    metodo: 'POST',
    patron: '/api/transacciones/internal',
    url: '/api/transacciones/internal',
    acceso: INTERNA,
    cuerpo: {},
  },
  {
    metodo: 'POST',
    patron: '/api/pagos/intentos-fallidos/interno',
    url: '/api/pagos/intentos-fallidos/interno',
    acceso: INTERNA,
    cuerpo: {},
  },

  // --- Autenticación --------------------------------------------------------
  {
    metodo: 'POST',
    patron: '/api/auth/register',
    url: '/api/auth/register',
    roles: ['admin'],
    cuerpo: { nombre: 'Ana Ríos', email: 'ana@mail.com', password: 'secreta123', rol: 'mesero' },
  },

  // --- Catálogo: categorías (escribir es solo de admin) ---------------------
  {
    metodo: 'POST',
    patron: '/api/categorias',
    url: '/api/categorias',
    roles: ['admin'],
    cuerpo: { nombre: 'Postres' },
  },
  {
    metodo: 'PUT',
    patron: '/api/categorias/:id',
    url: '/api/categorias/2',
    roles: ['admin'],
    cuerpo: { nombre: 'Postres' },
  },
  { metodo: 'DELETE', patron: '/api/categorias/:id', url: '/api/categorias/2', roles: ['admin'] },

  // --- Catálogo: platos -----------------------------------------------------
  {
    metodo: 'POST',
    patron: '/api/platos',
    url: '/api/platos',
    roles: ['admin'],
    cuerpo: { nombre: 'Arepa', precio: 12000, id_categoria: 1 },
  },
  {
    metodo: 'PUT',
    patron: '/api/platos/:id',
    url: '/api/platos/7',
    roles: ['admin'],
    cuerpo: { nombre: 'Arepa', precio: 12000, id_categoria: 1 },
  },
  { metodo: 'DELETE', patron: '/api/platos/:id', url: '/api/platos/7', roles: ['admin'] },

  // --- Constructor (D-04): leer es del personal de sala, escribir de admin --
  {
    metodo: 'GET',
    patron: '/api/platos/:id/pasos',
    url: '/api/platos/7/pasos',
    roles: ['admin', 'cajero', 'mesero'],
  },
  {
    metodo: 'POST',
    patron: '/api/platos/:id/pasos',
    url: '/api/platos/7/pasos',
    roles: ['admin'],
    cuerpo: { nombre: 'Punto de la carne', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true },
  },
  {
    metodo: 'PUT',
    patron: '/api/pasos/:id',
    url: '/api/pasos/3',
    roles: ['admin'],
    cuerpo: { nombre: 'Punto de la carne', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true },
  },
  { metodo: 'DELETE', patron: '/api/pasos/:id', url: '/api/pasos/3', roles: ['admin'] },
  {
    metodo: 'POST',
    patron: '/api/pasos/:id/ingredientes',
    url: '/api/pasos/3/ingredientes',
    roles: ['admin'],
    cuerpo: { nombre: 'Panceta', precio_extra: 3000, disponible: true },
  },
  {
    metodo: 'PUT',
    patron: '/api/ingredientes/:id',
    url: '/api/ingredientes/11',
    roles: ['admin'],
    cuerpo: { nombre: 'Panceta', precio_extra: 3000, disponible: true },
  },
  { metodo: 'DELETE', patron: '/api/ingredientes/:id', url: '/api/ingredientes/11', roles: ['admin'] },
  {
    // D-05: la única escritura del constructor que no es solo de admin, porque
    // la usa el panel de agotados del KDS (D-10).
    metodo: 'PATCH',
    patron: '/api/ingredientes/:id/disponible',
    url: '/api/ingredientes/11/disponible',
    roles: ['admin', 'cocina'],
    cuerpo: { disponible: false },
  },

  // --- Mesas ----------------------------------------------------------------
  { metodo: 'GET', patron: '/api/mesas', url: '/api/mesas', roles: ['admin', 'cajero', 'mesero'] },
  {
    metodo: 'POST',
    patron: '/api/mesas',
    url: '/api/mesas',
    roles: ['admin'],
    cuerpo: { numero: 9, capacidad: 4 },
  },
  { metodo: 'DELETE', patron: '/api/mesas/:id', url: `/api/mesas/${MESA}`, roles: ['admin'] },
  {
    metodo: 'PATCH',
    patron: '/api/mesas/:id/estado',
    url: `/api/mesas/${MESA}/estado`,
    roles: ['admin', 'cajero', 'mesero'],
    cuerpo: { estado: 'disponible' },
  },
  { metodo: 'POST', patron: '/api/mesas/:id/abrir', url: `/api/mesas/${MESA}/abrir`, roles: ['mesero', 'admin'] },
  { metodo: 'POST', patron: '/api/mesas/:id/liberar', url: `/api/mesas/${MESA}/liberar`, roles: ['mesero', 'admin'] },
  { metodo: 'POST', patron: '/api/mesas/:id/rotar-qr', url: `/api/mesas/${MESA}/rotar-qr`, roles: ['mesero', 'admin'] },
  {
    metodo: 'GET',
    patron: '/api/mesas/:id/cuenta',
    url: `/api/mesas/${MESA}/cuenta`,
    roles: ['admin', 'cajero', 'mesero'],
  },

  // --- Pedidos --------------------------------------------------------------
  {
    metodo: 'POST',
    patron: '/api/pedidos',
    url: '/api/pedidos',
    roles: ['comensal', 'mesero', 'admin'],
    cuerpo: { id_mesa: MESA, items: [] },
  },
  { metodo: 'GET', patron: '/api/pedidos/activos', url: '/api/pedidos/activos', roles: ['admin', 'cajero', 'mesero'] },
  { metodo: 'GET', patron: '/api/pedidos/mesa', url: '/api/pedidos/mesa', roles: ['comensal'] },
  { metodo: 'GET', patron: '/api/pedidos/mesa/cuenta', url: '/api/pedidos/mesa/cuenta', roles: ['comensal'] },
  {
    // S-26: a `cocina` se le cerró esta ruta (veía totales, alias y cuenta de
    // cualquier mesa). El comensal entra, y lo que ve lo acotan las guardas del
    // controller, no este middleware.
    metodo: 'GET',
    patron: '/api/pedidos/:id',
    url: '/api/pedidos/87',
    roles: ['admin', 'cajero', 'mesero', 'comensal'],
  },
  {
    metodo: 'PATCH',
    patron: '/api/pedidos/:id/estado',
    url: '/api/pedidos/87/estado',
    roles: ['admin', 'cajero', 'mesero'],
    cuerpo: { estado: 'listo' },
  },
  {
    metodo: 'POST',
    patron: '/api/pedidos/:id/cancelar',
    url: '/api/pedidos/87/cancelar',
    roles: ['admin', 'cajero', 'mesero'],
    cuerpo: {},
  },

  // --- KDS ------------------------------------------------------------------
  { metodo: 'GET', patron: '/api/kds/comandas', url: '/api/kds/comandas', roles: ['cocina', 'admin'] },
  {
    metodo: 'PATCH',
    patron: '/api/kds/comandas/:id/estado',
    url: '/api/kds/comandas/87/estado',
    roles: ['cocina', 'admin'],
    cuerpo: { estado: 'listo' },
  },

  // --- Dinero ---------------------------------------------------------------
  {
    metodo: 'POST',
    patron: '/api/transacciones',
    url: '/api/transacciones',
    roles: ['admin', 'cajero'],
    cuerpo: { id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' },
  },
  {
    metodo: 'GET',
    patron: '/api/transacciones/pedido/:id_pedido',
    url: '/api/transacciones/pedido/87',
    roles: ['admin', 'cajero'],
  },

  // --- Reportes (D-07): cifras de negocio, solo admin -----------------------
  { metodo: 'GET', patron: '/api/reportes', url: '/api/reportes?rango=hoy', roles: ['admin'] },
];

/** Clave con la que se compara contra `rutasRegistradas()`. */
const claveDe = (fila) => `${fila.metodo} ${fila.patron}`;

/** JWT del rol pedido. El comensal necesita además su sesión de mesa viva. */
const tokenDe = (rol) => (rol === 'comensal' ? tokenComensal(MESA) : tokenStaff(1, rol));

/**
 * Lanza la petición con los dobles puestos.
 *
 * El doble de base responde sin filas a todo: así ningún controller llega a
 * decidir un 403 propio (el de `GET /pedidos/:id` para un comensal de otra
 * mesa, por ejemplo) y el único 403 posible es el de `requireRole`, que es el
 * que se está probando. El doble del socket está para que ninguna prueba salga
 * a la red si un controller llegara a avisar.
 *
 * Con `responder` se cambia lo que contesta el doble de base (las pruebas de
 * fuga lo usan para hacer estallar la consulta), con `url` se pide otra
 * dirección que la de la fila (los `:id` envenenados de la inyección) y con
 * `cuerpo` se manda otro cuerpo.
 */
async function pedir(fila, { token, responder, url, cuerpo, cabeceras } = {}) {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = instalarFakeDb(responder || (() => ({ rows: [] })));
  try {
    let peticion = request(app)[fila.metodo.toLowerCase()](url || fila.url);
    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    for (const [nombre, valor] of Object.entries(cabeceras || {})) {
      peticion = peticion.set(nombre, valor);
    }
    const aEnviar = cuerpo !== undefined ? cuerpo : fila.cuerpo;
    if (aEnviar) peticion = peticion.send(aEnviar);
    return await peticion;
  } finally {
    db.restaurar();
    socket.restaurar();
  }
}

module.exports = {
  TABLA,
  claveDe,
  tokenDe,
  pedir,
  ROLES_STAFF,
  TODOS_LOS_ROLES,
  MESA,
  PUBLICA,
  INTERNA,
  protegidas: TABLA.filter((f) => f.roles),
  publicas: TABLA.filter((f) => f.acceso === PUBLICA),
  internas: TABLA.filter((f) => f.acceso === INTERNA),
};
