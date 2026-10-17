const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const { rutasRegistradas } = require('./helpers/rutas-registradas');
const app = require('../server');

// D-11: matriz ruta x rol, para TODAS las rutas que registra src/routes.
//
// Antes se probaba el control de roles ruta por ruta, donde a alguien se le
// ocurría. El resultado era que el catálogo entero (categorias, platos),
// mesas (POST/DELETE/PATCH) y transacciones no tenían ninguna prueba de 401 ni
// de 403, y que `comensal` —el único rol que se consigue sin credenciales, solo
// escaneando un QR— faltaba en 22 de las 35 rutas protegidas.
//
// La tabla de abajo es la fuente única. Cada fila declara quién puede entrar;
// de ahí salen las tres comprobaciones de cada ruta protegida:
//   1. sin token            -> 401
//   2. cada rol NO permitido -> 403
//   3. cada rol permitido    -> ni 401 ni 403
//
// Para (3) la afirmación es deliberadamente "no rebotó en la guarda" y no un
// código concreto: el doble de base responde sin filas, así que el controller
// contesta 400 o 404 según el caso. Lo que se prueba aquí es el middleware, no
// el controller; cada controller ya tiene su propio archivo.
//
// Y para que la tabla no envejezca, `rutasRegistradas()` lee la pila real de
// Express y una prueba compara las dos listas: una ruta nueva que no se declare
// aquí rompe la suite, que es exactamente lo que se quiere de una guarda nueva.

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
 */
async function pedir(fila, { token } = {}) {
  const socket = instalarFakeSocket(() => ({ ok: true }));
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    let peticion = request(app)[fila.metodo.toLowerCase()](fila.url);
    if (token) peticion = peticion.set('Authorization', `Bearer ${token}`);
    if (fila.cuerpo) peticion = peticion.send(fila.cuerpo);
    return await peticion;
  } finally {
    db.restaurar();
    socket.restaurar();
  }
}

const protegidas = TABLA.filter((f) => f.roles);
const publicas = TABLA.filter((f) => f.acceso === PUBLICA);
const internas = TABLA.filter((f) => f.acceso === INTERNA);

// ---------------------------------------------------------------------------
// 1. Censo: la tabla y el router tienen que decir lo mismo
// ---------------------------------------------------------------------------

test('d-11: toda ruta registrada en src/routes está declarada en la tabla', () => {
  const enLaTabla = new Set(TABLA.map(claveDe));
  const sinDeclarar = rutasRegistradas().filter((r) => !enLaTabla.has(r));

  assert.deepStrictEqual(
    sinDeclarar,
    [],
    'Hay rutas registradas que la matriz no cubre. Declara cada una en TABLA '
      + 'con los roles que puede entrar; si es pública o interna, dilo con '
      + '`acceso`. Una ruta nueva sin guarda es justo lo que esta prueba busca.'
  );
});

test('d-11: la tabla no declara rutas que ya no existen', () => {
  const registradas = new Set(rutasRegistradas());
  const sobrantes = TABLA.map(claveDe).filter((r) => !registradas.has(r));

  assert.deepStrictEqual(sobrantes, [], 'La tabla declara rutas que el router ya no monta.');
});

test('d-11: la tabla no tiene filas repetidas', () => {
  const claves = TABLA.map(claveDe);
  assert.strictEqual(new Set(claves).size, claves.length);
});

test('d-11: cada fila declara o roles o tipo de acceso, nunca las dos cosas', () => {
  for (const fila of TABLA) {
    const tieneRoles = Array.isArray(fila.roles);
    const tieneAcceso = typeof fila.acceso === 'string';
    assert.ok(
      tieneRoles !== tieneAcceso,
      `${claveDe(fila)}: declara roles y acceso a la vez, o ninguno de los dos`
    );
    if (tieneRoles) {
      for (const rol of fila.roles) {
        assert.ok(TODOS_LOS_ROLES.includes(rol), `${claveDe(fila)}: rol desconocido ${rol}`);
      }
    }
  }
});

test('d-11: el censo cubre las tres familias y ninguna queda vacía', () => {
  assert.strictEqual(TABLA.length, rutasRegistradas().length);
  assert.ok(protegidas.length > 0);
  assert.ok(publicas.length > 0);
  assert.ok(internas.length > 0);
});

// ---------------------------------------------------------------------------
// 2. Rutas protegidas: sin token, rol prohibido, rol permitido
// ---------------------------------------------------------------------------

for (const fila of protegidas) {
  const prohibidos = TODOS_LOS_ROLES.filter((r) => !fila.roles.includes(r));

  test(`d-11: ${claveDe(fila)} sin token responde 401`, async () => {
    const res = await pedir(fila);

    assert.strictEqual(res.status, 401, `respondió ${res.status}`);
    assert.strictEqual(res.body.error, 'Token no proporcionado');
  });

  test(`d-11: ${claveDe(fila)} solo para ${fila.roles.join(', ')}`, async () => {
    for (const rol of prohibidos) {
      const res = await pedir(fila, { token: tokenDe(rol) });
      assert.strictEqual(
        res.status,
        403,
        `${rol} recibió ${res.status} en ${claveDe(fila)} y debería ser 403`
      );
      assert.strictEqual(res.body.error, 'No tienes permisos para esta acción');
    }

    for (const rol of fila.roles) {
      const res = await pedir(fila, { token: tokenDe(rol) });
      assert.ok(
        res.status !== 401 && res.status !== 403,
        `${rol} debería pasar la guarda de ${claveDe(fila)} y recibió ${res.status}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Rutas públicas: no exigen Authorization
// ---------------------------------------------------------------------------

for (const fila of publicas) {
  test(`d-11: ${claveDe(fila)} no exige Authorization`, async () => {
    const res = await pedir(fila);

    // A propósito NO se afirma un código concreto: una ruta pública puede
    // responder 401 por su propio motivo (un token de QR que no vale, unas
    // credenciales que no son) y eso es correcto. Lo que no puede es rebotar
    // en `requireAuth`, y eso se reconoce por el mensaje.
    assert.notStrictEqual(res.body.error, 'Token no proporcionado');
    assert.notStrictEqual(res.body.error, 'Token inválido o expirado');
    assert.notStrictEqual(res.status, 403, `${claveDe(fila)} es pública y respondió 403`);
  });
}

// ---------------------------------------------------------------------------
// 4. Rutas internas: la clave compartida, no el JWT
// ---------------------------------------------------------------------------

for (const fila of internas) {
  test(`d-11: ${claveDe(fila)} exige x-internal-key`, async () => {
    const res = await pedir(fila);

    assert.strictEqual(res.status, 401, `respondió ${res.status}`);
    assert.strictEqual(res.body.error, 'Clave interna inválida');
  });

  test(`d-11: ${claveDe(fila)} no se abre con un JWT de admin`, async () => {
    // El canal interno es servicio-a-servicio: un JWT, por bueno que sea, no
    // es la credencial de estas rutas.
    const res = await pedir(fila, { token: tokenStaff(1, 'admin') });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Clave interna inválida');
  });
}

// ---------------------------------------------------------------------------
// 5. El comensal, mirado aparte
// ---------------------------------------------------------------------------

test('d-11: el comensal no entra en ninguna ruta del catálogo ni de mesas', async () => {
  // Es el único rol que se consigue sin credenciales: basta escanear el QR de
  // la mesa. Por eso se mira en bloque, además de en la matriz.
  const suyas = ['/api/pedidos', '/api/pedidos/mesa', '/api/pedidos/mesa/cuenta', '/api/pedidos/:id'];
  const ajenas = protegidas.filter((f) => !suyas.includes(f.patron));

  assert.ok(ajenas.length >= 25, `solo se revisaron ${ajenas.length} rutas`);

  for (const fila of ajenas) {
    const res = await pedir(fila, { token: tokenComensal(MESA) });
    assert.strictEqual(res.status, 403, `el comensal recibió ${res.status} en ${claveDe(fila)}`);
  }
});

test('d-11: ningún rol del personal entra por las rutas del comensal', async () => {
  const delComensal = protegidas.filter((f) => f.roles.length === 1 && f.roles[0] === 'comensal');

  assert.ok(delComensal.length > 0);

  for (const fila of delComensal) {
    for (const rol of ROLES_STAFF) {
      const res = await pedir(fila, { token: tokenStaff(1, rol) });
      assert.strictEqual(res.status, 403, `${rol} recibió ${res.status} en ${claveDe(fila)}`);
    }
  }
});
