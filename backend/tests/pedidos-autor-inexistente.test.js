const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeDb, tokenStaff, tokenComensal } = require('./helpers/fake-db');
const app = require('../server');
const autorInexistente = require('../src/services/autor-inexistente');

// ---------------------------------------------------------------------------
// El 23503 del AUTOR en los pedidos: "tu usuario ya no existe".
//
// Un mesero crea un pedido o lo mueve de estado con un token todavia valido,
// pero su usuario ya se borro. El backend escribe historial_estados.id_usuario
// con el id del JWT y la columna tiene su fk_historial_usuario contra usuarios,
// asi que PostgreSQL devuelve 23503. Sin traducir eso salia como el 409
// generico de clave ajena -"La operacion choca con otro registro
// relacionado", sin motivo-, que no dice que el problema sea la propia sesion.
//
// La FK se confirmo contra PostgreSQL (pg_constraint sobre usuarios) y las
// rutas se sondearon una por una con un id_usuario inexistente. Lo que se
// comprueba aqui es la traduccion por la ruta; el comportamiento contra la base
// de verdad esta en tests/integracion/pedidos-sql.test.js.
// ---------------------------------------------------------------------------

/** El 23503 que manda PostgreSQL cuando el autor del historial no existe. */
function errorDeAutor() {
  const err = new Error(
    'inserción o actualización en la tabla «historial_estados» viola la llave foránea «fk_historial_usuario»'
  );
  err.code = '23503';
  err.constraint = 'fk_historial_usuario';
  return err;
}

/** Un 23503 de otra cosa: tiene que seguir su propio camino. */
function errorDeOtraFk() {
  const err = new Error('viola la llave foránea «fk_detalles_pedido_plato»');
  err.code = '23503';
  err.constraint = 'fk_detalles_pedido_plato';
  return err;
}

const PEDIDO = {
  id_pedido: 91,
  id_mesa: 5,
  codigo_pedido: 'SD-0091',
  estado: 'recibido',
  total: 28000,
};

const mesero = () => tokenStaff(7, 'mesero');

/**
 * Doble de la base para POST /pedidos. Por omision el pedido se crea bien; con
 * `error` + `fallaEn` el doble lo lanza en esa sentencia.
 */
function fakeCrear({ error = null, fallaEn = 'INSERT INTO historial_estados' } = {}) {
  return instalarFakeDb((sql) => {
    if (error && sql.includes(fallaEn)) throw error;
    // Los items van SIN apodo a proposito: asi no entra la resolucion de
    // alias (D-18b) y la prueba se queda en lo suyo. La mesa igual tiene que
    // existir para el resto de comprobaciones.
    if (sql.includes('SELECT 1 FROM mesas')) return { rows: [{ existe: 1 }] };
    if (sql.includes('obtener_cuenta_mesa_json')) {
      return { rows: [{ cuenta: { id_mesa: PEDIDO.id_mesa, comensales: [] } }] };
    }
    if (sql.includes('INSERT INTO pedidos')) return { rows: [PEDIDO] };
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 1 }] };
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [PEDIDO] };
    if (sql.includes('FROM detalles_pedido')) return { rows: [] };
    return { rows: [] };
  });
}

const crear = (db, token = mesero()) => request(app)
  .post('/api/pedidos')
  .set('Authorization', `Bearer ${token}`)
  .send({ id_mesa: PEDIDO.id_mesa, items: [{ id_plato: 3, cantidad: 1 }] });

// ---------------------------------------------------------------------------
// POST /pedidos
// ---------------------------------------------------------------------------

test('POST /pedidos: el autor borrado da 409 autor_inexistente', async () => {
  const db = fakeCrear({ error: errorDeAutor() });
  try {
    const res = await crear(db);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
    assert.strictEqual(res.body.error, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
    // La convencion del repo: { error, motivo }, nunca "codigo".
    assert.strictEqual(res.body.codigo, undefined);
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos: y el mensaje no filtra la tabla ni el constraint', async () => {
  const db = fakeCrear({ error: errorDeAutor() });
  try {
    const res = await crear(db);

    const cuerpo = JSON.stringify(res.body);
    assert.strictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
    assert.match(res.body.error, /vuelve a iniciar sesión/i, 'dice que hacer');
    assert.ok(!/historial_estados|fk_historial|23503/i.test(cuerpo), cuerpo);
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos: el ROLLBACK se hace y la transaccion no queda abierta', async () => {
  const db = fakeCrear({ error: errorDeAutor() });
  try {
    await crear(db);

    assert.ok(db.buscar('BEGIN'), 'abrio la transaccion');
    assert.ok(db.buscar('ROLLBACK'), 'y la deshizo');
    assert.strictEqual(db.todas('COMMIT').length, 0, 'no hubo COMMIT');
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos: un 23503 de OTRA clave ajena sigue dando el 409 generico', async () => {
  const db = fakeCrear({ error: errorDeOtraFk(), fallaEn: 'INSERT INTO detalles_pedido' });
  try {
    const res = await crear(db);

    assert.strictEqual(res.status, 409);
    assert.notStrictEqual(res.body.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
    assert.strictEqual(res.body.motivo, undefined, 'el 409 generico no lleva motivo');
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos: el 503 reintentar del deadlock no se pierde', async () => {
  // La traduccion del autor mira el nombre del constraint, asi que un 40P01
  // -que no trae ninguno- sigue llegando al controller con su err.code y
  // sale como 503 reintentar (D-17). Es la comprobacion de que una traduccion
  // no se come la otra.
  const deadlock = new Error('se ha detectado un bloqueo mutuo');
  deadlock.code = '40P01';
  const db = fakeCrear({ error: deadlock });
  try {
    const res = await crear(db);

    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.motivo, 'reintentar');
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos: el 23505 del codigo_pedido se sigue reintentando', async () => {
  // El reintento del codigo vive ANTES, dentro del SAVEPOINT, y la traduccion
  // del autor esta en el catch de toda la transaccion: no se cruzan.
  let intentos = 0;
  const db = instalarFakeDb((sql) => {
    if (sql.includes('INSERT INTO pedidos')) {
      intentos += 1;
      if (intentos === 1) {
        const err = new Error('llave duplicada');
        err.code = '23505';
        err.constraint = 'pedidos_codigo_pedido_key';
        throw err;
      }
      return { rows: [PEDIDO] };
    }
    if (sql.includes('INSERT INTO detalles_pedido')) return { rows: [{ id_detalle: 1 }] };
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) return { rows: [PEDIDO] };
    return { rows: [] };
  });
  try {
    const res = await crear(db);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(intentos, 2, 'lo reintento con otro codigo');
  } finally {
    db.restaurar();
  }
});

test('POST /pedidos de un comensal: no hay autor que pueda faltar', async () => {
  // El pedido de un comensal va con id_usuario en NULL -no existe en usuarios-
  // y un NULL no viola la clave ajena. Asi que por esta ruta el caso no existe.
  const db = fakeCrear({});
  try {
    const res = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${tokenComensal(PEDIDO.id_mesa)}`)
      .send({ items: [{ id_plato: 3, cantidad: 1 }] });

    assert.strictEqual(res.status, 201);
    const historial = db.buscar('INSERT INTO historial_estados');
    assert.ok(historial, 'escribe el historial');
    assert.strictEqual(historial.params[1], null, 'con el autor en NULL');
  } finally {
    db.restaurar();
  }
});
