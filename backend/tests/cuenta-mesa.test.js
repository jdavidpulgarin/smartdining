const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenComensal, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket, CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');
const { ROL_COMENSAL } = require('../src/middleware/auth.middleware');

// Cuenta de la mesa por comensal (D-06). Dos rutas con la MISMA respuesta y
// distinto dueno: el personal pide por id de mesa y el comensal solo puede ver
// la suya, que sale de su JWT. Los montos van en pesos, como los da
// obtener_cuenta_mesa_json; la version en centavos es /cuenta/interno.

const ID_MESA = 5;

/** Cuenta tal como la devuelve la funcion de la base (pesos, no centavos). */
const CUENTA = {
  id_mesa: ID_MESA,
  numero: 5,
  estado_mesa: 'ocupada',
  ubicacion: 'Terraza',
  total_mesa: 90000,
  pagado_mesa: 30000,
  saldo_mesa: 60000,
  items_totales: 6,
  pedidos: [
    { id_pedido: 87, codigo_pedido: 'PED-261012-ABC12', estado: 'entregado', total: 90000 },
  ],
  comensales: [
    { comensal: 'Ana', items_pedidos: 2, subtotal: 30000, pagado: 0, saldo: 30000 },
    { comensal: 'Beto', items_pedidos: 2, subtotal: 30000, pagado: 0, saldo: 30000 },
    { comensal: 'Cami', items_pedidos: 2, subtotal: 30000, pagado: 30000, saldo: 0 },
  ],
};

/** @param {{existe?: boolean, cuenta?: object}} opciones */
function responderCuenta({ existe = true, cuenta = CUENTA } = {}) {
  return (sql, params) => {
    if (sql.includes('SELECT 1 FROM mesas WHERE id_mesa')) {
      return existe ? { rows: [{ '?column?': 1 }] } : { rows: [] };
    }
    if (sql.includes('obtener_cuenta_mesa_json')) {
      // La funcion recibe el id que se le pase: se devuelve con ese id dentro
      // para poder comprobar de que mesa se pidio la cuenta.
      return { rows: [{ cuenta: { ...cuenta, id_mesa: Number(params[0]) } }] };
    }
    return { rows: [] };
  };
}

const RUTA_PERSONAL = `/api/mesas/${ID_MESA}/cuenta`;
const RUTA_COMENSAL = '/api/pedidos/mesa/cuenta';

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------

test('la cuenta del personal pide token', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app).get(RUTA_PERSONAL);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['admin', 'cajero', 'mesero']) {
  test(`un ${rol} puede ver la cuenta de la mesa`, async () => {
    const db = instalarFakeDb(responderCuenta());
    try {
      const res = await request(app)
        .get(RUTA_PERSONAL)
        .set('Authorization', `Bearer ${tokenStaff(7, rol)}`);

      assert.strictEqual(res.status, 200);
    } finally {
      db.restaurar();
    }
  });
}

test('un cocina no puede ver la cuenta de la mesa', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`);

    assert.strictEqual(res.status, 403, 'a la cocina no le toca la plata');
    assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined);
  } finally {
    db.restaurar();
  }
});

test('un comensal no puede usar la ruta del personal', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenComensal(ID_MESA)}`);

    assert.strictEqual(res.status, 403, 'tiene la suya, y sin id en la URL');
  } finally {
    db.restaurar();
  }
});

test('la cuenta del comensal pide token', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app).get(RUTA_COMENSAL);
    assert.strictEqual(res.status, 401);
  } finally {
    db.restaurar();
  }
});

for (const rol of ['mesero', 'cajero', 'admin']) {
  test(`un ${rol} no puede usar la ruta del comensal`, async () => {
    const db = instalarFakeDb(responderCuenta());
    try {
      const res = await request(app)
        .get(RUTA_COMENSAL)
        .set('Authorization', `Bearer ${tokenStaff(7, rol)}`);

      assert.strictEqual(res.status, 403, 'esa ruta lee la mesa del JWT de comensal');
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// Forma de la respuesta
// ---------------------------------------------------------------------------

test('la cuenta trae el desglose por comensal con total, pagado y saldo', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_mesa, ID_MESA);
    assert.strictEqual(res.body.total_mesa, 90000);
    assert.strictEqual(res.body.pagado_mesa, 30000);
    assert.strictEqual(res.body.saldo_mesa, 60000);

    assert.deepStrictEqual(
      res.body.comensales.map((c) => [c.comensal, c.subtotal, c.pagado, c.saldo]),
      [
        ['Ana', 30000, 0, 30000],
        ['Beto', 30000, 0, 30000],
        ['Cami', 30000, 30000, 0],
      ]
    );
  } finally {
    db.restaurar();
  }
});

test('la suma de los subtotales por comensal cuadra con el total de la mesa', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    const suma = (campo) => res.body.comensales.reduce((t, c) => t + c[campo], 0);
    assert.strictEqual(suma('subtotal'), res.body.total_mesa);
    assert.strictEqual(suma('pagado'), res.body.pagado_mesa);
    assert.strictEqual(suma('saldo'), res.body.saldo_mesa);
  } finally {
    db.restaurar();
  }
});

test('se distingue al comensal que ya pago del que debe', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    const cami = res.body.comensales.find((c) => c.comensal === 'Cami');
    const ana = res.body.comensales.find((c) => c.comensal === 'Ana');

    assert.strictEqual(cami.saldo, 0, 'Cami ya pago lo suyo');
    assert.strictEqual(cami.pagado, 30000);
    assert.strictEqual(ana.saldo, 30000, 'Ana todavia debe');
    assert.strictEqual(ana.pagado, 0);
  } finally {
    db.restaurar();
  }
});

test('una mesa sin consumo devuelve la cuenta en cero', async () => {
  const vacia = {
    ...CUENTA,
    total_mesa: 0,
    pagado_mesa: 0,
    saldo_mesa: 0,
    items_totales: 0,
    pedidos: [],
    comensales: [],
  };
  const db = instalarFakeDb(responderCuenta({ cuenta: vacia }));
  try {
    const res = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.saldo_mesa, 0);
    assert.deepStrictEqual(res.body.comensales, []);
  } finally {
    db.restaurar();
  }
});

test('la cuenta del comensal tiene la misma forma que la del personal', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const delComensal = await request(app)
      .get(RUTA_COMENSAL)
      .set('Authorization', `Bearer ${tokenComensal(ID_MESA)}`);
    const delPersonal = await request(app)
      .get(RUTA_PERSONAL)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    assert.strictEqual(delComensal.status, 200);
    assert.deepStrictEqual(delComensal.body, delPersonal.body);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Aislamiento: la mesa del comensal sale del JWT
// ---------------------------------------------------------------------------

test('el comensal recibe la cuenta de SU mesa, la del token', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(RUTA_COMENSAL)
      .set('Authorization', `Bearer ${tokenComensal(9)}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_mesa, 9, 'la mesa es la del JWT');
    assert.deepStrictEqual(
      db.buscar('obtener_cuenta_mesa_json').params,
      [9],
      'se le pregunta a la base por la mesa del token, no por otra'
    );
  } finally {
    db.restaurar();
  }
});

test('un id de mesa en la URL no sirve para ver otra cuenta', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    // La ruta del comensal no acepta parametro: un id extra no existe.
    const res = await request(app)
      .get('/api/pedidos/mesa/cuenta/9')
      .set('Authorization', `Bearer ${tokenComensal(ID_MESA)}`);

    assert.notStrictEqual(res.status, 200, 'no hay forma de pedir la cuenta de otra mesa');
    assert.strictEqual(
      db.buscar('obtener_cuenta_mesa_json'),
      undefined,
      'ni se llega a consultar la base'
    );
  } finally {
    db.restaurar();
  }
});

test('un id de mesa en el query string se ignora', async () => {
  const db = instalarFakeDb(responderCuenta());
  try {
    const res = await request(app)
      .get(`${RUTA_COMENSAL}?id_mesa=9`)
      .set('Authorization', `Bearer ${tokenComensal(ID_MESA)}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id_mesa, ID_MESA, 'manda el JWT');
    assert.deepStrictEqual(db.buscar('obtener_cuenta_mesa_json').params, [ID_MESA]);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

test('una mesa inexistente responde 404 sin llamar a la funcion', async () => {
  const db = instalarFakeDb(responderCuenta({ existe: false }));
  try {
    const res = await request(app)
      .get('/api/mesas/999/cuenta')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(
      db.buscar('obtener_cuenta_mesa_json'),
      undefined,
      'la funcion SQL lanzaria un RAISE, que saldria como 409'
    );
  } finally {
    db.restaurar();
  }
});

for (const id of ['abc', '0', '-3', '2.5']) {
  test(`un id de mesa "${id}" responde 400`, async () => {
    const db = instalarFakeDb(responderCuenta());
    try {
      const res = await request(app)
        .get(`/api/mesas/${id}/cuenta`)
        .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined);
    } finally {
      db.restaurar();
    }
  });
}

// ---------------------------------------------------------------------------
// La ruta interna (PR #33) no se solapa con la nueva
// ---------------------------------------------------------------------------

test('/:id/cuenta/interno sigue respondiendo con x-internal-key', async () => {
  const previo = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = CLAVE_FALSA;
  const db = instalarFakeDb((sql, params) => {
    if (sql.includes('SELECT 1 FROM mesas WHERE id_mesa')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) {
      // Esta es la consulta de cuentaInterna, que convierte a centavos en SQL.
      return {
        rows: [{ total_centavos: '9000000', saldo_centavos: '6000000', por_comensal: [] }],
      };
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .get(`/api/mesas/${ID_MESA}/cuenta/interno`)
      .set('x-internal-key', CLAVE_FALSA);

    assert.strictEqual(res.status, 200, 'la ruta nueva /:id/cuenta no la captura');
    assert.strictEqual(res.body.total_centavos, 9000000, 'sigue dando centavos enteros');
    assert.strictEqual(res.body.moneda, 'COP');
  } finally {
    db.restaurar();
    if (previo === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = previo;
  }
});

test('la ruta interna no acepta un JWT de staff, y la del personal no acepta la clave', async () => {
  const previo = process.env.INTERNAL_API_KEY;
  process.env.INTERNAL_API_KEY = CLAVE_FALSA;
  const db = instalarFakeDb(responderCuenta());
  try {
    const interna = await request(app)
      .get(`/api/mesas/${ID_MESA}/cuenta/interno`)
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`);
    assert.strictEqual(interna.status, 401, 'el canal interno solo entiende la clave');

    const personal = await request(app).get(RUTA_PERSONAL).set('x-internal-key', CLAVE_FALSA);
    assert.strictEqual(personal.status, 401, 'la del personal solo entiende el JWT');
  } finally {
    db.restaurar();
    if (previo === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = previo;
  }
});

// ---------------------------------------------------------------------------
// POST /api/transacciones con comensal
// ---------------------------------------------------------------------------

const PEDIDO = { id_pedido: 87, id_mesa: ID_MESA, estado: 'entregado', total: '56000.00' };

function responderCobro(sql) {
  if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [{ ...PEDIDO }] };
  if (sql.includes('INSERT INTO transacciones')) {
    return { rows: [{ id_transaccion: 1, id_pedido: 87, monto: '56000.00' }] };
  }
  return { rows: [] };
}

const cobrar = (cuerpo, token) =>
  request(app)
    .post('/api/transacciones')
    .set('Authorization', `Bearer ${token || tokenStaff(4, 'cajero')}`)
    .send(cuerpo);

const PAGO = { id_pedido: 87, monto: 56000, metodo_pago: 'efectivo' };

test('un pago con comensal lo guarda en la transaccion', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const res = await cobrar({ ...PAGO, comensal: 'Ana' });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO transacciones');
    assert.ok(insert.sql.includes('comensal'), 'la columna va en el INSERT');
    assert.strictEqual(insert.params[5], 'Ana');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un pago sin comensal guarda NULL (cobro de la mesa completa)', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const res = await cobrar(PAGO);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[5], null);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('comensal null explicito tambien se acepta', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const res = await cobrar({ ...PAGO, comensal: null });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[5], null);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('un comensal vacio o demasiado largo se rechaza con 400', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    assert.strictEqual((await cobrar({ ...PAGO, comensal: '' })).status, 400);
    assert.strictEqual((await cobrar({ ...PAGO, comensal: 'x'.repeat(41) })).status, 400);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('si el JWT trae alias firmado, ese gana sobre el del body', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    // Staff con alias dentro del token: el alias firmado manda.
    const conAlias = jwt.sign(
      { id_usuario: 4, rol: 'cajero', comensal: 'Ana' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await cobrar({ ...PAGO, comensal: 'Beto' }, conAlias);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      db.buscar('INSERT INTO transacciones').params[5],
      'Ana',
      'no se puede cargar un pago a otra persona escribiendo su nombre en el body'
    );
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('sin alias en el JWT se usa el del body', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    await cobrar({ ...PAGO, comensal: 'Beto' });
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[5], 'Beto');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el alias del JWT se recorta antes de guardarse', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const conAlias = jwt.sign(
      { id_mesa: ID_MESA, rol: 'cajero', id_usuario: 4, comensal: '  Ana  ' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    await cobrar(PAGO, conAlias);
    assert.strictEqual(db.buscar('INSERT INTO transacciones').params[5], 'Ana');
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});

test('el rol comensal sigue sin poder registrar pagos', async () => {
  const socket = instalarFakeSocket();
  const db = instalarFakeDb(responderCobro);
  try {
    const comensal = jwt.sign(
      { id_mesa: ID_MESA, sid: 'x', rol: ROL_COMENSAL },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await cobrar({ ...PAGO, comensal: 'Ana' }, comensal);

    assert.ok(res.status === 401 || res.status === 403, `cobrar no es del comensal (fue ${res.status})`);
    assert.strictEqual(db.buscar('INSERT INTO transacciones'), undefined);
  } finally {
    db.restaurar();
    socket.restaurar();
  }
});
