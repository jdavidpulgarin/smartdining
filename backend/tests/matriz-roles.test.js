const test = require('node:test');
const assert = require('node:assert');
const { tokenStaff, tokenComensal } = require('./helpers/fake-db');
const { rutasRegistradas } = require('./helpers/rutas-registradas');
const {
  TABLA,
  claveDe,
  tokenDe,
  pedir,
  ROLES_STAFF,
  TODOS_LOS_ROLES,
  MESA,
  protegidas,
  publicas,
  internas,
} = require('./helpers/catalogo-rutas');

// D-11: matriz ruta x rol, para TODAS las rutas que registra src/routes.
//
// Antes se probaba el control de roles ruta por ruta, donde a alguien se le
// ocurría. El resultado era que el catálogo entero (categorias, platos),
// mesas (POST/DELETE/PATCH) y transacciones no tenían ninguna prueba de 401 ni
// de 403, y que `comensal` —el único rol que se consigue sin credenciales, solo
// escaneando un QR— faltaba en 22 de las 35 rutas protegidas.
//
// La tabla es la fuente única y vive en tests/helpers/catalogo-rutas.js, porque
// también la usan las pruebas de fuga en errores y de inyección. Cada fila
// declara quién puede entrar; de ahí salen las tres comprobaciones de cada
// ruta protegida:
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
