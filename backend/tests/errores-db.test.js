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

test('un error de CHECK responde 500 genérico y no expone el mensaje interno', async () => {
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

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Error interno del servidor');
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

test('un error que no es de clase 22 ni P0001 sigue dando 500', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('SELECT estado FROM pedidos')) return { rows: [{ estado: 'recibido' }] };
    if (sql.includes('UPDATE pedidos SET estado')) throw errorCheck();
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
