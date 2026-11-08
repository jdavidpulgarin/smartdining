const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb } = require('./helpers/fake-db');
const { CLAVE_FALSA } = require('./helpers/fake-socket');
const app = require('../server');

// Canal interno servidor-a-servidor (EVENTS.md §8.2 y §8.5): lo llama el
// socket-server con x-internal-key, sin JWT. Aqui se prueban el middleware, la
// cuenta de la mesa en centavos y la bitacora de intentos fallidos.

/** Fija la clave interna durante una prueba y la restaura al salir. */
function conClaveInterna(valor) {
  const previo = process.env.INTERNAL_API_KEY;
  if (valor === undefined) delete process.env.INTERNAL_API_KEY;
  else process.env.INTERNAL_API_KEY = valor;
  return {
    restaurar() {
      if (previo === undefined) delete process.env.INTERNAL_API_KEY;
      else process.env.INTERNAL_API_KEY = previo;
    },
  };
}

const RUTA_CUENTA = '/api/mesas/5/cuenta/interno';

// Cuenta tal como la devuelve obtener_cuenta_mesa_json: pesos con decimales.
// El endpoint es el que pasa a centavos, y lo hace en SQL.
const CUENTA_JSON = {
  id_mesa: 5,
  total_mesa: '90000.00',
  pagado_mesa: '30000.00',
  saldo_mesa: '60000.00',
  comensales: [
    { comensal: 'Ana', subtotal: '30000.00', pagado: '0.00', saldo: '30000.00' },
    { comensal: 'Beto', subtotal: '30000.00', pagado: '0.00', saldo: '30000.00' },
    { comensal: 'Cami', subtotal: '30000.00', pagado: '30000.00', saldo: '0.00' },
  ],
};

/**
 * Doble de la base para la cuenta. Imita lo que hace el SQL real: convierte a
 * centavos y deja fuera a quien no debe nada, para que la prueba compruebe la
 * forma de la respuesta sin necesitar PostgreSQL.
 */
function responderCuenta(sql, params) {
  if (sql.includes('SELECT 1 FROM mesas WHERE id_mesa')) {
    return Number(params[0]) === 5 ? { rows: [{ '?column?': 1 }] } : { rows: [] };
  }
  if (sql.includes('obtener_cuenta_mesa_json')) {
    const centavos = (v) => Math.round(Number(v) * 100);
    return {
      rows: [{
        total_centavos: String(centavos(CUENTA_JSON.total_mesa)),
        saldo_centavos: String(centavos(CUENTA_JSON.saldo_mesa)),
        por_comensal: CUENTA_JSON.comensales
          .filter((c) => Number(c.saldo) > 0)
          .map((c) => ({ comensal: c.comensal, saldo_centavos: centavos(c.saldo) })),
      }],
    };
  }
  return { rows: [] };
}

// ---------------------------------------------------------------------------
// Middleware requireInternalKey
// ---------------------------------------------------------------------------

test('sin cabecera x-internal-key responde 401', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined, 'no toca la base');
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('con una clave interna equivocada responde 401', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', 'otra-clave-cualquiera');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('una clave del largo correcto pero distinta tambien es 401', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const mismoLargo = 'X'.repeat(CLAVE_FALSA.length);
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', mismoLargo);
    assert.strictEqual(res.status, 401);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('sin INTERNAL_API_KEY configurada el canal interno responde 503 (falla cerrada)', async () => {
  const clave = conClaveInterna(undefined);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', CLAVE_FALSA);
    assert.strictEqual(res.status, 503, 'sin clave no se deja pasar, se cierra');
    assert.strictEqual(db.buscar('obtener_cuenta_mesa_json'), undefined);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('con el valor de ejemplo del .env.example tambien responde 503', async () => {
  const clave = conClaveInterna('cambia-esto-por-una-clave-interna-larga');
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app)
      .get(RUTA_CUENTA)
      .set('x-internal-key', 'cambia-esto-por-una-clave-interna-larga');
    assert.strictEqual(res.status, 503, 'el placeholder no vale como clave');
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('con la clave correcta la peticion pasa', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', CLAVE_FALSA);
    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('el canal interno no acepta un JWT en vez de la clave', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const { tokenStaff } = require('./helpers/fake-db');
    const res = await request(app)
      .get(RUTA_CUENTA)
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);
    assert.strictEqual(res.status, 401, 'ni siquiera un admin entra sin la clave');
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

// ---------------------------------------------------------------------------
// GET /api/mesas/:id/cuenta/interno
// ---------------------------------------------------------------------------

test('la cuenta llega en centavos enteros con la forma del contrato', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', CLAVE_FALSA);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      id_mesa: 5,
      moneda: 'COP',
      total_centavos: 9000000,
      saldo_centavos: 6000000,
      por_comensal: [
        { comensal: 'Ana', saldo_centavos: 3000000 },
        { comensal: 'Beto', saldo_centavos: 3000000 },
      ],
    });
    for (const c of res.body.por_comensal) {
      assert.ok(Number.isInteger(c.saldo_centavos), 'los centavos son enteros');
    }
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('por_comensal deja fuera a quien ya no debe nada', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get(RUTA_CUENTA).set('x-internal-key', CLAVE_FALSA);
    assert.ok(
      !res.body.por_comensal.some((c) => c.comensal === 'Cami'),
      'Cami ya pago: no se le vuelve a cobrar'
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('los centavos se calculan en SQL, no en JavaScript', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    await request(app).get(RUTA_CUENTA).set('x-internal-key', CLAVE_FALSA);

    const consulta = db.buscar('obtener_cuenta_mesa_json');
    assert.ok(consulta, 'la cuenta sale de la funcion de la base');
    assert.ok(consulta.sql.includes("ROUND(COALESCE((j->>'total_mesa')::numeric, 0) * 100)::bigint"));
    assert.ok(consulta.sql.includes('::bigint AS saldo_centavos'));
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('una mesa inexistente responde 404 y no llama a la funcion de la cuenta', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get('/api/mesas/999/cuenta/interno').set('x-internal-key', CLAVE_FALSA);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(
      db.buscar('obtener_cuenta_mesa_json'),
      undefined,
      'la funcion SQL lanzaria un RAISE, que saldria como 409: se comprueba antes'
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('un id de mesa no numerico responde 400', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderCuenta);
  try {
    const res = await request(app).get('/api/mesas/abc/cuenta/interno').set('x-internal-key', CLAVE_FALSA);
    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

// ---------------------------------------------------------------------------
// POST /api/pagos/intentos-fallidos/interno
// ---------------------------------------------------------------------------

const RUTA_INTENTOS = '/api/pagos/intentos-fallidos/interno';

const INTENTO = {
  referencia_externa: 'SD-5-1760212345678-abc',
  id_transaccion_pasarela: '1132-903100443-27458',
  pasarela: 'wompi',
  id_mesa: 5,
  motivo: 'monto_distinto',
  monto_centavos: 100,
  monto_esperado_centavos: 3333300,
  moneda: 'COP',
  metodo_pago: 'online',
};

/** @param {{mesaExiste?: boolean, yaRegistrado?: boolean}} opciones */
function responderIntentos({ mesaExiste = true, yaRegistrado = false } = {}) {
  return (sql) => {
    if (sql.includes('SELECT id_mesa FROM mesas WHERE id_mesa')) {
      return mesaExiste ? { rows: [{ id_mesa: 5 }] } : { rows: [] };
    }
    if (sql.includes('SELECT id_intento FROM intentos_pago_fallidos')) {
      return yaRegistrado ? { rows: [{ id_intento: 41 }] } : { rows: [] };
    }
    if (sql.includes('INSERT INTO intentos_pago_fallidos')) {
      return { rows: [{ id_intento: 42 }] };
    }
    return { rows: [] };
  };
}

test('un intento fallido se guarda con id_pedido NULL', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(INTENTO);

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, { ok: true });

    const insert = db.buscar('INSERT INTO intentos_pago_fallidos');
    assert.ok(insert);
    assert.ok(insert.sql.includes('VALUES (NULL, NULL,'), 'id_pedido e id_usuario van NULL');
    assert.strictEqual(insert.params[0], 5, 'id_mesa');
    assert.strictEqual(insert.params[1], INTENTO.referencia_externa);
    assert.strictEqual(insert.params[2], INTENTO.id_transaccion_pasarela);
    assert.strictEqual(insert.params[6], 100, 'el monto viaja en centavos');
    assert.strictEqual(insert.params[7], 'monto_distinto', 'razon_rechazo es el motivo tal cual');
    assert.ok(
      insert.sql.includes('($7::bigint)::numeric / 100'),
      'los centavos se dividen en SQL, no en JavaScript'
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('monto_esperado_centavos se valida pero no se guarda', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(INTENTO);

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO intentos_pago_fallidos');
    assert.ok(
      !insert.params.includes(INTENTO.monto_esperado_centavos),
      'no hay columna para el monto esperado'
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('si la mesa no existe el intento se guarda con id_mesa NULL', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos({ mesaExiste: false }));
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({ ...INTENTO, id_mesa: 777, motivo: 'referencia_desconocida' });

    assert.strictEqual(res.status, 201, 'una alerta no se pierde porque la mesa no exista');
    assert.strictEqual(db.buscar('INSERT INTO intentos_pago_fallidos').params[0], null);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('el mismo intento repetido no inserta otra fila', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos({ yaRegistrado: true }));
  try {
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(INTENTO);

    assert.strictEqual(res.status, 201, 'para el socket-server ya quedo registrado');
    assert.deepStrictEqual(res.body, { ok: true });
    assert.strictEqual(db.buscar('INSERT INTO intentos_pago_fallidos'), undefined);
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('la busqueda del duplicado bloquea la fila para dos reintentos a la vez', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(INTENTO);

    const consulta = db.buscar('SELECT id_intento FROM intentos_pago_fallidos');
    assert.ok(consulta.sql.includes('FOR UPDATE'));
    const orden = db.ejecutadas.map((q) => q.sql);
    assert.ok(orden.findIndex((s) => s.includes('BEGIN')) < orden.findIndex((s) => s.includes('SELECT id_intento')));
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('una moneda distinta de COP se registra, no se rechaza', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({ ...INTENTO, moneda: 'USD', motivo: 'moneda_distinta' });

    assert.strictEqual(res.status, 201, 'una moneda rara ES la alerta: hay que guardarla');
    const insert = db.buscar('INSERT INTO intentos_pago_fallidos');
    assert.strictEqual(insert.params[4], 'USD', 'la moneda se guarda tal como llego');
    assert.strictEqual(insert.params[7], 'moneda_distinta', 'razon_rechazo');
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('la moneda se normaliza a mayusculas', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({ ...INTENTO, moneda: 'usd' });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      db.buscar('INSERT INTO intentos_pago_fallidos').params[4],
      'USD',
      "'usd' y 'USD' no pueden quedar como dos monedas distintas en la bitacora"
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('una moneda de mas de 3 caracteres si se rechaza (la columna es VARCHAR(3))', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({ ...INTENTO, moneda: 'PESOS' });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('id_mesa null y monto_esperado_centavos null se aceptan y guardan la mesa en NULL', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({
        ...INTENTO,
        id_mesa: null,
        monto_esperado_centavos: null,
        motivo: 'referencia_desconocida',
      });

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO intentos_pago_fallidos');
    assert.strictEqual(insert.params[0], null, 'id_mesa NULL en la fila');
    assert.strictEqual(
      db.buscar('SELECT id_mesa FROM mesas WHERE id_mesa'),
      undefined,
      'con id_mesa null no hace falta preguntarle nada a la tabla mesas'
    );
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('sin id_mesa (ausente) tambien se guarda, con la mesa en NULL', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const { id_mesa, ...sinMesa } = INTENTO;
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(sinMesa);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(db.buscar('INSERT INTO intentos_pago_fallidos').params[0], null);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

for (const [caso, valor] of [
  ['ausente', undefined],
  ['en cero', 0],
  ['negativo', -500],
  ['null', null],
]) {
  test(`monto_centavos ${caso}: 201 y monto NULL (la CHECK exige monto > 0)`, async () => {
    const clave = conClaveInterna(CLAVE_FALSA);
    const db = instalarFakeDb(responderIntentos());
    try {
      const cuerpo = { ...INTENTO };
      if (valor === undefined) delete cuerpo.monto_centavos;
      else cuerpo.monto_centavos = valor;

      const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(cuerpo);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(
        db.buscar('INSERT INTO intentos_pago_fallidos').params[6],
        null,
        'un 0 reventaria la CHECK y se perderia la alerta'
      );
    } finally {
      db.restaurar();
      clave.restaurar();
    }
  });
}

test('sin pasarela y sin moneda tambien se guarda', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const { pasarela, moneda, ...minimo } = INTENTO;
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send(minimo);

    assert.strictEqual(res.status, 201);
    const insert = db.buscar('INSERT INTO intentos_pago_fallidos');
    assert.strictEqual(insert.params[3], null, 'pasarela');
    assert.strictEqual(insert.params[4], null, 'moneda');
    assert.strictEqual(insert.params[5], 'online', 'metodo_pago mantiene su valor por omision');
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

test('lo minimo imprescindible es referencia, transaccion y motivo', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app).post(RUTA_INTENTOS).set('x-internal-key', CLAVE_FALSA).send({
      referencia_externa: 'SD-9-solo-lo-minimo',
      id_transaccion_pasarela: '1132-000-minimo',
      motivo: 'estado_no_aprobado',
    });

    assert.strictEqual(res.status, 201);
    assert.ok(db.buscar('INSERT INTO intentos_pago_fallidos'));
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

for (const [caso, parche] of [
  ['sin referencia_externa', { referencia_externa: undefined }],
  ['sin id_transaccion_pasarela', { id_transaccion_pasarela: undefined }],
  ['sin motivo', { motivo: undefined }],
]) {
  test(`${caso}: 400, porque es lo que identifica la alerta`, async () => {
    const clave = conClaveInterna(CLAVE_FALSA);
    const db = instalarFakeDb(responderIntentos());
    try {
      const res = await request(app)
        .post(RUTA_INTENTOS)
        .set('x-internal-key', CLAVE_FALSA)
        .send({ ...INTENTO, ...parche });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(db.buscar('INSERT INTO intentos_pago_fallidos'), undefined);
    } finally {
      db.restaurar();
      clave.restaurar();
    }
  });
}

test('un monto_centavos no entero se rechaza con 400', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  const db = instalarFakeDb(responderIntentos());
  try {
    const res = await request(app)
      .post(RUTA_INTENTOS)
      .set('x-internal-key', CLAVE_FALSA)
      .send({ ...INTENTO, monto_centavos: 100.5 });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
    clave.restaurar();
  }
});

// ---------------------------------------------------------------------------
// D-11: el middleware, en las TRES rutas internas
//
// Arriba se prueba a fondo contra GET /mesas/:id/cuenta/interno. Pero el canal
// interno tiene tres puertas, y las otras dos son las que mueven dinero:
// POST /transacciones/internal registra un pago y POST
// /pagos/intentos-fallidos/interno escribe la bitacora. Una de las tres mal
// montada es una de las tres abierta, asi que se recorren las tres con los
// mismos casos.
// ---------------------------------------------------------------------------

const { VALORES_DE_EJEMPLO } = require('../src/middleware/interno.middleware');

/** Las tres rutas internas, con un cuerpo cualquiera donde hace falta. */
const RUTAS_INTERNAS = [
  { nombre: 'GET /api/mesas/:id/cuenta/interno', metodo: 'get', url: RUTA_CUENTA },
  { nombre: 'POST /api/transacciones/internal', metodo: 'post', url: '/api/transacciones/internal', cuerpo: {} },
  { nombre: 'POST /api/pagos/intentos-fallidos/interno', metodo: 'post', url: RUTA_INTENTOS, cuerpo: {} },
];

/** Lanza la peticion a una ruta interna con las cabeceras dadas. */
async function pedirInterna(ruta, cabeceras = {}) {
  const db = instalarFakeDb(responderCuenta);
  try {
    let peticion = request(app)[ruta.metodo](ruta.url);
    for (const [nombre, valor] of Object.entries(cabeceras)) peticion = peticion.set(nombre, valor);
    if (ruta.cuerpo) peticion = peticion.send(ruta.cuerpo);
    return await peticion;
  } finally {
    db.restaurar();
  }
}

for (const ruta of RUTAS_INTERNAS) {
  test(`d-11: ${ruta.nombre} sin la clave responde 401`, async () => {
    const clave = conClaveInterna(CLAVE_FALSA);
    try {
      const res = await pedirInterna(ruta);

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Clave interna inválida');
    } finally {
      clave.restaurar();
    }
  });

  test(`d-11: ${ruta.nombre} con una clave equivocada responde 401`, async () => {
    const clave = conClaveInterna(CLAVE_FALSA);
    try {
      // Nada de claves con espacios alrededor: HTTP los recorta al transmitir
      // la cabecera, así que llegarían como la clave buena y el caso no existe.
      const intentos = [
        'otra-clave',
        CLAVE_FALSA.toUpperCase(),
        CLAVE_FALSA.slice(0, -1),
        `${CLAVE_FALSA}x`,
        CLAVE_FALSA.split('').reverse().join(''),
        // Mismo largo, distinto contenido: lo que la comparación en tiempo
        // constante tiene que rechazar sin delatar cuántos bytes acertó.
        'x'.repeat(CLAVE_FALSA.length),
      ];
      for (const intento of intentos) {
        const res = await pedirInterna(ruta, { 'x-internal-key': intento });

        assert.strictEqual(res.status, 401, `"${intento}" entró en ${ruta.nombre}`);
        assert.strictEqual(res.body.error, 'Clave interna inválida');
      }
    } finally {
      clave.restaurar();
    }
  });

  test(`d-11: ${ruta.nombre} falla cerrada sin INTERNAL_API_KEY`, async () => {
    // 503 y no 401: el problema es del servidor, no de quien llama. Y desde
    // luego no un 200, que es lo que pasaría si se dejara abierta.
    const clave = conClaveInterna(undefined);
    try {
      const res = await pedirInterna(ruta, { 'x-internal-key': CLAVE_FALSA });

      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.error, 'El canal interno no está configurado en este servidor');
    } finally {
      clave.restaurar();
    }
  });

  test(`d-11: ${ruta.nombre} falla cerrada con el valor de ejemplo`, async () => {
    // Arrancar con el placeholder del .env.example es arrancar sin clave, y
    // estas rutas mueven dinero.
    for (const ejemplo of VALORES_DE_EJEMPLO) {
      const clave = conClaveInterna(ejemplo);
      try {
        const res = await pedirInterna(ruta, { 'x-internal-key': ejemplo });

        assert.strictEqual(res.status, 503, `con "${ejemplo}" respondió ${res.status}`);
      } finally {
        clave.restaurar();
      }
    }
  });

  test(`d-11: ${ruta.nombre} no se abre con un JWT, por bueno que sea`, async () => {
    const { tokenStaff } = require('./helpers/fake-db');
    const clave = conClaveInterna(CLAVE_FALSA);
    try {
      for (const rol of ['admin', 'cajero', 'mesero', 'cocina']) {
        const res = await pedirInterna(ruta, { Authorization: `Bearer ${tokenStaff(1, rol)}` });

        assert.strictEqual(res.status, 401, `el JWT de ${rol} entró en ${ruta.nombre}`);
        assert.strictEqual(res.body.error, 'Clave interna inválida');
      }
    } finally {
      clave.restaurar();
    }
  });

  test(`d-11: ${ruta.nombre} acepta la clave correcta`, async () => {
    // Control: sin esto, un middleware que respondiera 401 siempre pasaría
    // todas las pruebas de arriba.
    const clave = conClaveInterna(CLAVE_FALSA);
    try {
      const res = await pedirInterna(ruta, { 'x-internal-key': CLAVE_FALSA });

      assert.notStrictEqual(res.status, 401, `${ruta.nombre} rechazó la clave buena`);
      assert.notStrictEqual(res.status, 503);
    } finally {
      clave.restaurar();
    }
  });
}

test('d-11: la clave interna no se filtra en ninguna respuesta', async () => {
  const clave = conClaveInterna(CLAVE_FALSA);
  try {
    for (const ruta of RUTAS_INTERNAS) {
      for (const cabeceras of [{}, { 'x-internal-key': 'equivocada' }, { 'x-internal-key': CLAVE_FALSA }]) {
        const res = await pedirInterna(ruta, cabeceras);
        const cuerpo = JSON.stringify(res.body || {});

        assert.ok(!cuerpo.includes(CLAVE_FALSA), `${ruta.nombre} devolvió la clave interna`);
        assert.ok(!String(res.text || '').includes(CLAVE_FALSA), `${ruta.nombre} devolvió la clave interna`);
      }
    }
  } finally {
    clave.restaurar();
  }
});
