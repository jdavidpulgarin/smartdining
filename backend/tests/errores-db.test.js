const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');

/** Simula el error que node-postgres entrega ante un RAISE EXCEPTION. */
function errorTrigger(mensaje) {
  const err = new Error(mensaje);
  err.code = 'P0001';
  return err;
}

/** Simula una violación de CHECK: no debe filtrarse al cliente. */
function errorCheck() {
  const err = new Error(
    'el nuevo registro para la relación «transacciones» viola la restricción «check» «transacciones_metodo_pago_check»'
  );
  err.code = '23514';
  return err;
}

test('una transicion no permitida por el trigger responde 409 con el mensaje del trigger', async () => {
  const mensaje = 'Transición de estado no autorizada: de "en_preparacion" hacia "pagado"';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'en_preparacion' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorTrigger(mensaje);
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/pedidos/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ estado: 'pagado' });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un plato no disponible responde 409 con el mensaje del trigger', async () => {
  const mensaje = 'El plato "Hamburguesa Smart Angus" no se encuentra disponible actualmente en la cocina';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO pedidos')) return { rows: [{ id_pedido: 87, id_mesa: 5 }] };
    if (sql.includes('INSERT INTO detalles_pedido')) throw errorTrigger(mensaje);
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(5)}`)
      .send({ items: [{ id_plato: 3, cantidad: 1, apodo: 'Ana' }] });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un error de CHECK responde 422 y no expone el mensaje interno', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: 1, id_mesa: 5, estado: 'entregado' }] };
    if (sql.includes('INSERT INTO transacciones')) throw errorCheck();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 56000, metodo_pago: 'efectivo' });

    // Antes era un 500: el cuerpo pasó el esquema de zod, pero el valor no
    // cumple un CHECK de la base. No es una caída y reintentar no ayuda.
    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.error, MENSAJE_422);
    assert.ok(!/restricción|check|transacciones_metodo_pago/i.test(JSON.stringify(res.body)));
  } finally {
    db.restaurar();
  }
});

test('metodo_pago solo acepta los valores del CHECK del schema', async () => {
  // El doble de base es necesario desde H-09: el middleware comprueba en cada
  // peticion del personal que la cuenta siga activa, antes de mirar el rol. Sin
  // el, la consulta va a PostgreSQL de verdad y en un entorno sin base (el CI)
  // la peticion falla con 500 en vez de llegar al control de roles.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 1000, metodo_pago: 'tarjeta' });

    assert.strictEqual(res.status, 400, "'tarjeta' no existe en el schema: se rechaza en el body");
  } finally {
    db.restaurar();
  }
});

test('el pago libera la mesa desde el backend (el trigger tr_regenerar_token_qr ya no existe)', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM pedidos')) return { rows: [{ id_pedido: 1, id_mesa: 5, estado: 'entregado' }] };
    if (sql.includes('INSERT INTO transacciones')) return { rows: [{ id_transaccion: 1 }] };
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${tokenStaff(4, 'cajero')}`)
      .send({ id_pedido: 1, monto: 56000, metodo_pago: 'tarjeta_credito' });

    assert.strictEqual(res.status, 201);

    // Jarrison retiró el trigger, así que el ciclo de vida de token_qr es del
    // backend: al cobrar, la mesa queda disponible y sin token.
    const liberacion = db.buscar('UPDATE mesas SET estado = $1, token_qr = NULL');
    assert.ok(liberacion, 'el backend debe liberar la mesa');
    assert.strictEqual(liberacion.params[1], 5);

    // Y con la fila de la mesa bloqueada, para no competir con otro cierre.
    assert.ok(db.buscar('FROM mesas WHERE id_mesa = $1 FOR UPDATE'));
  } finally {
    db.restaurar();
  }
});

test('el codigo_pedido generado cabe en el VARCHAR(16) del schema', () => {
  const { generarCodigoPedido } = require('../src/services/pedidos.service');
  for (let i = 0; i < 200; i++) {
    const codigo = generarCodigoPedido();
    assert.ok(codigo.length <= 16, `"${codigo}" mide ${codigo.length}`);
  }
});

// ---------------------------------------------------------------------------
// Clase 22 de SQLSTATE: errores de datos -> 422, no 500
// ---------------------------------------------------------------------------

/**
 * Simula el 22003 real que lanza fn_tr_calcular_tiempo_preparacion() cuando una
 * comanda lleva dias en preparacion: la variacion porcentual no cabe en
 * NUMERIC(6,2). El texto es el de PostgreSQL, con el nombre de la funcion
 * dentro, que es justo lo que NO debe salir al cliente.
 */
function errorDesbordamiento() {
  const err = new Error('desbordamiento de campo numeric');
  err.code = '22003';
  err.detail = 'Un campo con precisión 6, escala 2 debe redondear a un valor absoluto menor que 10^4.';
  err.where = 'función PL/pgSQL fn_tr_calcular_tiempo_preparacion() en la línea 28 en asignación';
  return err;
}

const MENSAJE_422 =
  'No se pudo registrar esta operación: un dato está fuera del rango permitido. Avisa al equipo.';

test('un 22003 al avanzar la comanda responde 422 con un mensaje util', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'en_preparacion' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorDesbordamiento();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'listo' });

    assert.strictEqual(res.status, 422, 'no es un fallo del servidor: el dato no cabe');
    assert.strictEqual(res.body.error, MENSAJE_422);
  } finally {
    db.restaurar();
  }
});

test('el 422 no filtra el texto interno de postgres', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'en_preparacion' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorDesbordamiento();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'listo' });

    const cuerpo = JSON.stringify(res.body);
    for (const fuga of [
      'fn_tr_calcular_tiempo_preparacion',
      'PL/pgSQL',
      'NUMERIC',
      'precisión 6',
      'numeric',
      '22003',
      'línea 28',
    ]) {
      assert.ok(!cuerpo.includes(fuga), `no debe aparecer "${fuga}" en la respuesta`);
    }
  } finally {
    db.restaurar();
  }
});

for (const [codigo, caso] of [
  ['22003', 'desbordamiento numerico'],
  ['22001', 'texto demasiado largo'],
  ['22007', 'formato de fecha invalido'],
  ['22012', 'division por cero'],
  ['22P02', 'sintaxis de entrada invalida'],
]) {
  test(`${codigo} (${caso}) responde 422`, async () => {
    const db = instalarFakeDb((sql) => {
      if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
      if (sql.includes('UPDATE pedidos SET estado')) {
        const err = new Error(`fallo de datos ${codigo}`);
        err.code = codigo;
        throw err;
      }
      return { rows: [] };
    });
    try {
      const res = await request(app)
        .patch('/api/kds/comandas/1/estado')
        .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
        .send({ estado: 'en_preparacion' });

      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error, MENSAJE_422);
    } finally {
      db.restaurar();
    }
  });
}

test('un P0001 sigue dando 409 con el mensaje del trigger', async () => {
  const mensaje = 'Transición de estado no autorizada: de "listo" hacia "en_preparacion"';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'listo' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorTrigger(mensaje);
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    assert.strictEqual(res.status, 409, 'las reglas de negocio no se vuelven 422');
    assert.strictEqual(res.body.error, mensaje);
  } finally {
    db.restaurar();
  }
});

test('un error que no está en ninguna tabla de traducción sigue dando 500', async () => {
  // Antes este caso usaba un 23514, que ya tiene su propio 422. Un 23502
  // (NOT NULL) no está traducido y sí es un fallo nuestro: la columna es
  // obligatoria y el backend no la mandó.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      const err = new Error('el valor null para la columna «estado» viola la restricción no nula');
      err.code = '23502';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
  } finally {
    db.restaurar();
  }
});

test('un codigo que empieza por 22 pero no es un SQLSTATE no se confunde', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      // Un error de red de Node, por ejemplo: 'ECONNRESET' o un '22' suelto.
      const err = new Error('fallo raro');
      err.code = '22';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    assert.strictEqual(res.status, 500, 'un SQLSTATE tiene 5 caracteres: esto no lo es');
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Choques de concurrencia: 40P01 y 40001 -> 409, no 500
// ---------------------------------------------------------------------------

/**
 * Simula el 40P01 real de PostgreSQL. El texto nombra procesos, transacciones y
 * modos de bloqueo, que es justo lo que NO debe salir al cliente.
 */
function errorDeadlock() {
  const err = new Error('se ha detectado un deadlock');
  err.code = '40P01';
  err.detail =
    'El proceso 12345 espera ShareLock en la transacción 678; bloqueado por el proceso 12346.';
  err.where = 'sentencia SQL «UPDATE pedidos SET estado = $1 WHERE id_pedido = $2»';
  return err;
}

/** Simula el 40001: la transaccion no se pudo serializar con otra. */
function errorSerializacion() {
  const err = new Error(
    'no se pudo serializar el acceso debido a una actualización concurrente'
  );
  err.code = '40001';
  err.detail = 'La transacción podría tener éxito si se reintenta.';
  return err;
}

const MENSAJE_409_CONCURRENCIA = 'La operación chocó con otra en curso, vuelve a intentarlo';

for (const [codigo, lanzar, caso] of [
  ['40P01', errorDeadlock, 'deadlock detectado'],
  ['40001', errorSerializacion, 'fallo de serializacion'],
]) {
  test(`${codigo} (${caso}) responde 409 invitando a reintentar`, async () => {
    const db = instalarFakeDb((sql) => {
      if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
      if (sql.includes('UPDATE pedidos SET estado')) throw lanzar();
      return { rows: [] };
    });
    try {
      const res = await request(app)
        .patch('/api/kds/comandas/1/estado')
        .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
        .send({ estado: 'en_preparacion' });

      assert.strictEqual(res.status, 409, 'no es una caida del servidor: reintentar sirve');
      assert.strictEqual(res.body.error, MENSAJE_409_CONCURRENCIA);
    } finally {
      db.restaurar();
    }
  });
}

test('el 409 de concurrencia no filtra el texto interno de postgres', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorDeadlock();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    const cuerpo = JSON.stringify(res.body);
    for (const fuga of [
      'deadlock',
      'ShareLock',
      '12345',
      '12346',
      'transacción 678',
      'UPDATE pedidos',
      '40P01',
    ]) {
      assert.ok(!cuerpo.includes(fuga), `no debe aparecer "${fuga}" en la respuesta`);
    }
  } finally {
    db.restaurar();
  }
});

test('el 409 de concurrencia tiene la misma forma de JSON que el resto', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorSerializacion();
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    assert.deepStrictEqual(Object.keys(res.body), ['error'], 'una sola clave: error');
    assert.strictEqual(typeof res.body.error, 'string');
  } finally {
    db.restaurar();
  }
});

for (const [codigo, caso] of [
  ['40002', 'violacion de integridad diferida'],
  ['40003', 'resultado de la transaccion desconocido'],
  ['40000', 'rollback de la transaccion a secas'],
]) {
  test(`${codigo} (${caso}) sigue dando 500: reintentarlo no es seguro`, async () => {
    // La lista es explicita, no la clase 40 entera. Reintentar a ciegas un
    // 40002 o un 40003 seria cobrar dos veces o guardar basura.
    const db = instalarFakeDb((sql) => {
      if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
      if (sql.includes('UPDATE pedidos SET estado')) {
        const err = new Error(`fallo de transaccion ${codigo}`);
        err.code = codigo;
        throw err;
      }
      return { rows: [] };
    });
    try {
      const res = await request(app)
        .patch('/api/kds/comandas/1/estado')
        .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
        .send({ estado: 'en_preparacion' });

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error, 'Error interno del servidor');
    } finally {
      db.restaurar();
    }
  });
}

test('un codigo desconocido sigue dando 500', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) {
      const err = new Error('la conexion se cerro');
      err.code = 'ECONNRESET';
      throw err;
    }
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .patch('/api/kds/comandas/1/estado')
      .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
      .send({ estado: 'en_preparacion' });

    assert.strictEqual(res.status, 500);
  } finally {
    db.restaurar();
  }
});

test('el clasificador reconoce solo esos dos codigos', () => {
  const { esErrorDeConcurrencia } = require('../src/middleware/errores.middleware');

  assert.strictEqual(esErrorDeConcurrencia('40P01'), true);
  assert.strictEqual(esErrorDeConcurrencia('40001'), true);
  for (const otro of ['40002', '40003', '40000', '22003', 'P0001', '', null, undefined, 40001]) {
    assert.strictEqual(esErrorDeConcurrencia(otro), false, `${otro} no es un choque de concurrencia`);
  }
});

// ---------------------------------------------------------------------------
// H-11: integridad (23505, 23503, 23514) y cancelacion (57014)
//
// Hasta ahora los cuatro salian como 500 generico, que es indistinguible de
// una caida: el cliente no sabia si corregir, reintentar o avisar al equipo.
// ---------------------------------------------------------------------------

const {
  MENSAJE_REGISTRO_DUPLICADO,
  MENSAJE_REFERENCIA_RELACIONADA,
  MENSAJE_CONSULTA_CANCELADA,
  traduccionDeSqlstate,
} = require('../src/middleware/errores.middleware');

/**
 * Error de PostgreSQL tal como lo entrega pg, con el texto real: nombra el
 * constraint, la relacion y la fila, que es justo lo que NO debe salir.
 */
function errorIntegridad(codigo, constraint, mensaje) {
  const err = new Error(mensaje);
  err.code = codigo;
  err.constraint = constraint;
  err.detail = `La llave (id_pedido)=(1) ya existe en la relación «${constraint}».`;
  err.where = 'sentencia SQL «UPDATE pedidos SET estado = $1 WHERE id_pedido = $2»';
  return err;
}

/** Ruta que no pasa por constructor.service: su error llega crudo al manejador. */
function avanzarComanda(db) {
  return request(app)
    .patch('/api/kds/comandas/1/estado')
    .set('Authorization', `Bearer ${tokenStaff(2, 'cocina')}`)
    .send({ estado: 'en_preparacion' });
}

function dbQueFallaAlAvanzar(error) {
  return instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw error;
    return { rows: [] };
  });
}

for (const [codigo, constraint, texto, status, mensajeEsperado, caso] of [
  ['23505', 'uq_pedidos_codigo', 'llave duplicada viola restricción de unicidad', 409, MENSAJE_REGISTRO_DUPLICADO, 'unique_violation'],
  ['23503', 'fk_detalles_pedido_plato', 'inserción o actualización viola la llave ajena', 409, MENSAJE_REFERENCIA_RELACIONADA, 'foreign_key_violation'],
  ['23514', 'pedidos_estado_check', 'viola la restricción «check»', 422, MENSAJE_422, 'check_violation'],
  ['57014', null, 'cancelando sentencia por tiempo de espera agotado', 503, MENSAJE_CONSULTA_CANCELADA, 'query_canceled'],
]) {
  test(`${codigo} (${caso}) responde ${status} y no 500`, async () => {
    const db = dbQueFallaAlAvanzar(errorIntegridad(codigo, constraint, texto));
    try {
      const res = await avanzarComanda(db);

      assert.strictEqual(res.status, status);
      assert.strictEqual(res.body.error, mensajeEsperado);
    } finally {
      db.restaurar();
    }
  });

  test(`el ${status} de ${codigo} no filtra el constraint ni el detail`, async () => {
    const db = dbQueFallaAlAvanzar(errorIntegridad(codigo, constraint, texto));
    try {
      const res = await avanzarComanda(db);

      const cuerpo = JSON.stringify(res.body);
      for (const fuga of [codigo, 'UPDATE pedidos', 'llave', 'relación', constraint].filter(Boolean)) {
        assert.ok(!cuerpo.includes(fuga), `no debe aparecer "${fuga}" en la respuesta`);
      }
      assert.deepStrictEqual(Object.keys(res.body), ['error'], 'una sola clave: error');
    } finally {
      db.restaurar();
    }
  });
}

test('el 23514 reutiliza el mensaje de la clase 22: un solo 422 con un solo mensaje', () => {
  assert.strictEqual(traduccionDeSqlstate('23514').mensaje, MENSAJE_422);
  assert.strictEqual(traduccionDeSqlstate('23514').status, 422);
});

for (const [codigo, caso] of [
  ['23502', 'not_null_violation: la columna es obligatoria y el backend no la mandó'],
  ['23P01', 'exclusion_violation: no es ninguno de los tres casos de arriba'],
  ['23000', 'integrity_constraint_violation a secas'],
]) {
  test(`${codigo} sigue dando 500 (${caso})`, async () => {
    // La lista es explicita, no la clase 23 entera.
    const err = new Error(`fallo de integridad ${codigo}`);
    err.code = codigo;
    const db = dbQueFallaAlAvanzar(err);
    try {
      const res = await avanzarComanda(db);

      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.error, 'Error interno del servidor');
    } finally {
      db.restaurar();
    }
  });
}

test('la tabla de traduccion reconoce solo esos cuatro codigos', () => {
  for (const [codigo, status] of [['23505', 409], ['23503', 409], ['23514', 422], ['57014', 503]]) {
    assert.strictEqual(traduccionDeSqlstate(codigo).status, status);
  }

  for (const otro of [
    '23502', '23P01', '23000', '22003', '40P01', 'P0001', 'ECONNRESET', '',
    // Claves heredadas del prototipo: por eso la tabla es un Map y no un objeto.
    '__proto__', 'constructor', 'toString',
    null, undefined, 23505,
  ]) {
    assert.strictEqual(traduccionDeSqlstate(otro), null, `${otro} no debe traducirse`);
  }
});

test('lo que un service ya tradujo gana: el 23505 del constructor conserva su mensaje', async () => {
  // La primera rama del manejador es la del error de negocio ({ status,
  // message }), asi que constructor.service.js sigue diciendo QUE choca en vez
  // del mensaje generico. Es la prueba de que las ramas nuevas no le pisan nada.
  const err = new Error('simulado 23505');
  err.code = '23505';
  err.constraint = 'uq_pasos_plato_orden';
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT * FROM platos WHERE id_plato')) {
      return { rows: [{ id_plato: 7, nombre: 'Bowl', personalizable: true }] };
    }
    if (sql.includes('INSERT INTO pasos_constructor')) throw err;
    return { rows: [] };
  });
  try {
    const res = await request(app)
      .post('/api/platos/7/pasos')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`)
      .send({ nombre: 'Elige tu Base', orden: 1 });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'Ya hay otro paso de este plato en esa posición');
    assert.notStrictEqual(res.body.error, MENSAJE_REGISTRO_DUPLICADO);
  } finally {
    db.restaurar();
  }
});
