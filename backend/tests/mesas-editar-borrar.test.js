const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeRedis } = require('./helpers/fake-redis');
const mesasService = require('../src/services/mesas.service');
const usuarioActivo = require('../src/services/usuario-activo');

// D-16 parte A: editar y borrar una mesa.
//
// Lo que se vigila aqui:
//   - una mesa OCUPADA no se renumera (el numero es lo que lleva el QR impreso
//     y lo que grita el mesero) ni se borra;
//   - una mesa con pedidos no se borra: el ON DELETE RESTRICT de
//     fk_pedidos_mesa lo impedia igual, pero con un 409 generico que no decia
//     ni por que ni que hacer;
//   - el estado NO se toca por aqui: tiene su propia ruta y sus propios roles.

const MESA = 5;
const tokenAdmin = () => tokenStaff(1, 'admin');

/** Fila de mesas como la devuelve la base. */
function filaMesa(extra = {}) {
  return {
    id_mesa: MESA,
    numero: 5,
    capacidad: 4,
    ubicacion: 'Principal',
    estado: 'disponible',
    token_qr: null,
    sesion_iniciada_en: null,
    version_control: 1,
    actualizado_en: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/**
 * @param {{mesa?: object|null, pedidos?: number, errorUpdate?: object}} opciones
 */
function fakeMesas({ mesa = filaMesa(), pedidos = 0, errorUpdate = null } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas m WHERE m.id_mesa') && sql.includes('FOR UPDATE')) {
      return { rows: mesa ? [mesa] : [] };
    }
    if (sql.includes('count(*)::int AS pedidos')) {
      return { rows: [{ pedidos }] };
    }
    if (sql.includes('UPDATE mesas')) {
      if (errorUpdate) throw errorUpdate;
      return {
        rows: [
          filaMesa({
            ...mesa,
            numero: params[1] ?? mesa.numero,
            capacidad: params[2] ?? mesa.capacidad,
            ubicacion: params[3] ?? mesa.ubicacion,
          }),
        ],
      };
    }
    if (sql.includes('DELETE FROM mesas')) {
      return { rows: [{ id_mesa: MESA }] };
    }
    return undefined;
  });
}

/** El error que lanza PostgreSQL cuando choca el UNIQUE de mesas.numero. */
function errorNumeroDuplicado() {
  const err = new Error('duplicate key value violates unique constraint "mesas_numero_key"');
  err.code = '23505';
  err.constraint = 'mesas_numero_key';
  return err;
}

// ---------------------------------------------------------------------------
// PATCH /api/mesas/:id — validacion
// ---------------------------------------------------------------------------

test('d-16: un cuerpo vacio es 400', async () => {
  const db = fakeMesas();
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({});

    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /al menos un campo/i);
  } finally {
    db.restaurar();
  }
});

test('d-16: el estado NO se cambia por aqui (strict)', async () => {
  const db = fakeMesas();
  try {
    // Mover el estado es la operacion del salon y tiene su propia ruta, con
    // permisos distintos (mesero y cajero tambien). Colarlo aqui seria dejar a
    // admin cambiar el estado por una puerta que no se reviso para eso.
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ capacidad: 6, estado: 'ocupada' });

    assert.strictEqual(res.status, 400);
    assert.ok(!db.buscar('UPDATE mesas'), 'no se escribio nada');
  } finally {
    db.restaurar();
  }
});

test('d-16: el token_qr tampoco se escribe por aqui', async () => {
  const db = fakeMesas();
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ token_qr: 'token-falsificado' });

    assert.strictEqual(res.status, 400, 'el token es una credencial, no un dato editable');
  } finally {
    db.restaurar();
  }
});

test('d-16: numero y capacidad tienen que ser enteros positivos', async () => {
  const db = fakeMesas();
  try {
    for (const cuerpo of [{ numero: 0 }, { numero: -2 }, { capacidad: 0 }, { numero: 1.5 }]) {
      const res = await request(app)
        .patch(`/api/mesas/${MESA}`)
        .set('Authorization', `Bearer ${tokenAdmin()}`)
        .send(cuerpo);
      assert.strictEqual(res.status, 400, JSON.stringify(cuerpo));
    }
  } finally {
    db.restaurar();
  }
});

test('d-16: una ubicacion vacia es 400', async () => {
  const db = fakeMesas();
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ ubicacion: '' });

    assert.strictEqual(res.status, 400);
  } finally {
    db.restaurar();
  }
});

test('d-16: editar una mesa que no existe es 404', async () => {
  const db = fakeMesas({ mesa: null });
  try {
    const res = await request(app)
      .patch('/api/mesas/999')
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ capacidad: 6 });

    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /no encontrada/i);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/mesas/:id — camino feliz
// ---------------------------------------------------------------------------

test('d-16: cambia capacidad y ubicacion', async () => {
  const db = fakeMesas();
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ capacidad: 8, ubicacion: 'Terraza' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.capacidad, 8);
    assert.strictEqual(res.body.ubicacion, 'Terraza');
  } finally {
    db.restaurar();
  }
});

test('d-16: la respuesta NUNCA trae el token_qr', async () => {
  const db = fakeMesas({ mesa: filaMesa({ token_qr: 'token-vigente-de-la-mesa' }) });
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ capacidad: 6 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.token_qr, undefined, 'es la credencial de la mesa');
    assert.ok(!JSON.stringify(res.body).includes('token-vigente-de-la-mesa'));
    // Lo que el panel si necesita saber: si hay sesion abierta.
    assert.strictEqual(res.body.sesion_abierta, true);
  } finally {
    db.restaurar();
  }
});

test('d-16: lo que no se manda no se toca', async () => {
  const db = fakeMesas();
  try {
    await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ ubicacion: 'Terraza' });

    const update = db.buscar('UPDATE mesas');
    assert.strictEqual(update.params[1], null, 'el numero no se reescribe');
    assert.strictEqual(update.params[2], null, 'la capacidad no se reescribe');
    assert.strictEqual(update.params[3], 'Terraza');
  } finally {
    db.restaurar();
  }
});

test('d-16: renumerar una mesa libre si se puede', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'disponible' }) });
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ numero: 12 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.numero, 12);
  } finally {
    db.restaurar();
  }
});

test('d-16: todo va en una transaccion con la fila bloqueada', async () => {
  const db = fakeMesas();
  try {
    await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ numero: 12 });

    assert.ok(db.buscar('BEGIN'));
    assert.ok(db.buscar('FOR UPDATE'), 'sin el bloqueo, el estado podria cambiar entremedias');
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// PATCH — reglas de negocio
// ---------------------------------------------------------------------------

test('d-16: una mesa OCUPADA no se renumera (409)', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'ocupada' }) });
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ numero: 12 });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mesasService.MENSAJE_OCUPADA_NO_SE_RENUMERA);
    assert.ok(!db.buscar('UPDATE mesas'), 'no se escribio nada');
  } finally {
    db.restaurar();
  }
});

test('d-16: a una mesa ocupada SI se le corrige la capacidad', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'ocupada' }) });
  try {
    // Capacidad y ubicacion no identifican la mesa: corregirlas con gente
    // sentada no rompe nada.
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ capacidad: 6 });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16: mandar el MISMO numero que ya tiene no es renumerar', async () => {
  const db = fakeMesas({ mesa: filaMesa({ numero: 5, estado: 'ocupada' }) });
  try {
    // El panel reenvia el numero sin cambiarlo: no hay nada que bloquear.
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ numero: 5, capacidad: 6 });

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16: un numero repetido es 409 con un mensaje que lo dice', async () => {
  const db = fakeMesas({ errorUpdate: errorNumeroDuplicado() });
  try {
    const res = await request(app)
      .patch(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`)
      .send({ numero: 3 });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mesasService.MENSAJE_NUMERO_EN_USO);
    // Y no el generico del manejador central, que no dice que choca.
    assert.ok(!/registro con esos datos/i.test(res.body.error));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/mesas/:id
// ---------------------------------------------------------------------------

test('d-16: una mesa libre y sin pedidos se borra con 204, como antes', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'disponible' }), pedidos: 0 });
  try {
    const res = await request(app)
      .delete(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 204);
    assert.deepStrictEqual(res.body, {});
    assert.ok(db.buscar('DELETE FROM mesas'), 'se borro de verdad');
  } finally {
    db.restaurar();
  }
});

test('d-16: borrar una mesa que no existe sigue siendo 404', async () => {
  const db = fakeMesas({ mesa: null });
  try {
    const res = await request(app)
      .delete('/api/mesas/999')
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 404);
    assert.match(res.body.error, /no encontrada/i);
  } finally {
    db.restaurar();
  }
});

test('d-16: una mesa OCUPADA no se borra: 409 con mensaje claro', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'ocupada' }), pedidos: 0 });
  try {
    // Antes esto devolvia 204 si la mesa no tenia pedidos todavia (recien
    // abierta), y dejaba una sesion de QR viva apuntando a una mesa borrada.
    const res = await request(app)
      .delete(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mesasService.MENSAJE_OCUPADA_NO_SE_BORRA);
    assert.ok(!db.buscar('DELETE FROM mesas'), 'no se llego al DELETE');
  } finally {
    db.restaurar();
  }
});

test('d-16: una mesa CON PEDIDOS no se borra: 409 que explica por que', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'disponible' }), pedidos: 3 });
  try {
    // Antes salia el 409 generico del manejador central ("La operacion choca
    // con otro registro relacionado"), traducido del ON DELETE RESTRICT.
    const res = await request(app)
      .delete(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mesasService.MENSAJE_CON_PEDIDOS);
    assert.match(res.body.error, /historial/i, 'dice por que no se puede');
    assert.match(res.body.error, /mantenimiento/i, 'y que hacer en su lugar');
    assert.ok(!db.buscar('DELETE FROM mesas'));
  } finally {
    db.restaurar();
  }
});

test('d-16: cuentan TODOS los pedidos, no solo los abiertos', async () => {
  const db = fakeMesas({ pedidos: 1 });
  try {
    await request(app).delete(`/api/mesas/${MESA}`).set('Authorization', `Bearer ${tokenAdmin()}`);

    const conteo = db.buscar('count(*)::int AS pedidos');
    assert.ok(conteo, 'se contaron los pedidos');
    // El RESTRICT de la FK no distingue estados: uno pagado de hace un mes
    // impide el borrado igual que uno en curso.
    assert.ok(!conteo.sql.includes('estado'), 'el conteo no filtra por estado');
  } finally {
    db.restaurar();
  }
});

test('d-16: si el conteo no se puede leer, NO se borra', async () => {
  // Mas seguro negar el borrado que llevarse por delante el historial.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas m WHERE m.id_mesa')) return { rows: [filaMesa()] };
    if (sql.includes('count(*)::int AS pedidos')) return { rows: [] };
    return undefined;
  });
  try {
    const res = await request(app)
      .delete(`/api/mesas/${MESA}`)
      .set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.strictEqual(res.status, 409);
    assert.ok(!db.buscar('DELETE FROM mesas'));
  } finally {
    db.restaurar();
  }
});

test('d-16: el borrado tambien va en una transaccion con la fila bloqueada', async () => {
  const db = fakeMesas();
  try {
    await request(app).delete(`/api/mesas/${MESA}`).set('Authorization', `Bearer ${tokenAdmin()}`);

    assert.ok(db.buscar('BEGIN'));
    assert.ok(db.buscar('FOR UPDATE'), 'sin el bloqueo cabe un pedido entre el conteo y el DELETE');
    assert.ok(db.buscar('COMMIT'));
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La cache de usuario-activo si invalida de verdad cuando esta encendida
// ---------------------------------------------------------------------------

test('olvidar() borra la llave del usuario cuando la cache esta activa', async () => {
  // Dentro de las pruebas la cache esta apagada (igual que leerCache y
  // guardarCache), asi que para ver el DEL hay que pasarle un entorno de
  // produccion, como hacen las demas pruebas de la cache.
  const redisFalso = instalarFakeRedis();
  try {
    const borrada = await usuarioActivo.olvidar(7, { env: { NODE_ENV: 'production' } });

    assert.strictEqual(borrada, true);
    assert.deepStrictEqual(redisFalso.operaciones, [{ op: 'del', clave: usuarioActivo.llave(7) }]);
  } finally {
    redisFalso.restaurar();
  }
});

test('olvidar() no toca Redis dentro de las pruebas', async () => {
  // Sin esta guarda, cada cambio de usuario abriria un cliente de Redis que
  // nadie cierra y `npm test` no terminaria.
  const redisFalso = instalarFakeRedis();
  try {
    const borrada = await usuarioActivo.olvidar(7);

    assert.strictEqual(borrada, false);
    assert.deepStrictEqual(redisFalso.operaciones, [], 'ni una operacion');
  } finally {
    redisFalso.restaurar();
  }
});

test('olvidar() con Redis caido devuelve false y no lanza', async () => {
  const redisFalso = instalarFakeRedis({ caido: true });
  try {
    const borrada = await usuarioActivo.olvidar(7, { env: { NODE_ENV: 'production' } });
    assert.strictEqual(borrada, false, 'la cache nunca tumba la operacion');
  } finally {
    redisFalso.restaurar();
  }
});
