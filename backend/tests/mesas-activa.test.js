const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../server');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { instalarFakeSocket } = require('./helpers/fake-socket');
const mesasService = require('../src/services/mesas.service');

// D-16 parte B: mesas.activa (ADR-06, database/scripts/26_configuracion.sql).
//
// Desactivar en vez de borrar: una mesa con pedidos no se puede borrar (el
// DELETE da 409), asi que retirarla del servicio es la unica salida real.
//
// Lo que se vigila aqui:
//   - desactivar una mesa OCUPADA es 409 con motivo mesa_ocupada, y se corta
//     en el servicio ANTES de llegar al trigger: asi el mensaje dice que pasa
//     y no se gasta un viaje a la base. Un token en una mesa 'disponible' no
//     bloquea: es resto de una sesion terminada, y al desactivar se borra;
//   - si el trigger igual lanza su 23514 (por un camino que la guarda no ve),
//     sale 409 y no el 422 generico del manejador central;
//   - una mesa inactiva no se abre ni recibe QR: tambien 409.

const MESA = 5;
const admin = () => tokenStaff(1, 'admin');
const mesero = () => tokenStaff(3, 'mesero');

const filaMesa = (extra = {}) => ({
  id_mesa: MESA,
  numero: 5,
  capacidad: 4,
  ubicacion: 'Terraza',
  estado: 'disponible',
  token_qr: null,
  activa: true,
  sesion_iniciada_en: null,
  version_control: 1,
  actualizado_en: '2026-11-08T10:00:00.000Z',
  ...extra,
});

/** El 23514 con el que tr_validar_mesa_activa rechaza. */
function errorDelTrigger(mensaje) {
  const err = new Error(mensaje);
  err.code = '23514';
  return err;
}

/** @param {{mesa?: object|null, errorUpdate?: object}} opciones */
function fakeMesas({ mesa = filaMesa(), errorUpdate = null } = {}) {
  return instalarFakeDb((sql, params) => {
    if (sql.includes('FROM mesas m WHERE m.id_mesa') && sql.includes('FOR UPDATE')) {
      return { rows: mesa ? [mesa] : [] };
    }
    // GET /api/mesas/:id usa obtenerPorId, que es un SELECT * sin alias.
    if (sql.includes('SELECT * FROM mesas WHERE id_mesa')) {
      return { rows: mesa ? [mesa] : [] };
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
            activa: params[4] ?? mesa.activa,
            // El CASE del UPDATE: solo al desactivar se borra el token.
            token_qr: params[4] === false ? null : mesa.token_qr,
          }),
        ],
      };
    }
    return undefined;
  });
}

const patch = (cuerpo, token = admin()) => request(app)
  .patch(`/api/mesas/${MESA}`)
  .set('Authorization', `Bearer ${token}`)
  .send(cuerpo);

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

test('d-16b: se puede desactivar una mesa libre y sin sesion', async () => {
  const db = fakeMesas();
  try {
    const res = await patch({ activa: false });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.activa, false);
  } finally {
    db.restaurar();
  }
});

test('d-16b: y volver a activarla', async () => {
  const db = fakeMesas({ mesa: filaMesa({ activa: false }) });
  try {
    const res = await patch({ activa: true });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.activa, true);
  } finally {
    db.restaurar();
  }
});

test('d-16b: activar una mesa OCUPADA si se puede', async () => {
  // Reactivar no quita nada a nadie: la guarda solo mira el camino de apagar.
  const db = fakeMesas({ mesa: filaMesa({ activa: false, estado: 'ocupada', token_qr: 'tok' }) });
  try {
    assert.strictEqual((await patch({ activa: true })).status, 200);
  } finally {
    db.restaurar();
  }
});

test('d-16b: activa se puede cambiar junto con los demas datos', async () => {
  const db = fakeMesas();
  try {
    const res = await patch({ activa: false, capacidad: 8, ubicacion: 'Bodega' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.activa, false);
    assert.strictEqual(res.body.capacidad, 8);
  } finally {
    db.restaurar();
  }
});

test('d-16b: lo que no se manda no se toca', async () => {
  const db = fakeMesas();
  try {
    await patch({ activa: false });

    const update = db.buscar('UPDATE mesas');
    // $5 es activa; numero, capacidad y ubicacion van en null y el COALESCE
    // deja el valor de la base.
    assert.strictEqual(update.params[1], null, 'el numero no se reescribe');
    assert.strictEqual(update.params[2], null);
    assert.strictEqual(update.params[3], null);
    assert.strictEqual(update.params[4], false);
  } finally {
    db.restaurar();
  }
});

test('d-16b: la vista de la mesa expone activa', async () => {
  const db = fakeMesas();
  try {
    const res = await request(app).get(`/api/mesas/${MESA}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.activa, true);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// Permisos y validacion
// ---------------------------------------------------------------------------

test('d-16b: cambiar activa es solo de admin', async () => {
  const db = fakeMesas();
  try {
    assert.strictEqual((await request(app).patch(`/api/mesas/${MESA}`).send({ activa: false })).status, 401);
    for (const rol of ['mesero', 'cajero', 'cocina']) {
      assert.strictEqual((await patch({ activa: false }, tokenStaff(4, rol))).status, 403, rol);
    }
  } finally {
    db.restaurar();
  }
});

test('d-16b: activa tiene que ser booleano', async () => {
  const db = fakeMesas();
  try {
    for (const valor of ['false', 0, 1, null, 'si']) {
      const res = await patch({ activa: valor });
      assert.strictEqual(res.status, 400, JSON.stringify(valor));
    }
    assert.ok(!db.buscar('UPDATE mesas'), 'no se escribio nada');
  } finally {
    db.restaurar();
  }
});

test('d-16b: una mesa que no existe es 404', async () => {
  const db = fakeMesas({ mesa: null });
  try {
    assert.strictEqual((await patch({ activa: false })).status, 404);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// La regla: una mesa ocupada no se desactiva
// ---------------------------------------------------------------------------

test('d-16b: desactivar una mesa OCUPADA es 409 con motivo mesa_ocupada', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'ocupada', token_qr: 'tok' }) });
  try {
    const res = await patch({ activa: false });

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'mesa_ocupada');
    assert.strictEqual(res.body.error, mesasService.MENSAJE_OCUPADA_NO_SE_DESACTIVA);
    // La guarda corta ANTES de la base: no se gasta un viaje para que el
    // trigger lo rechace, y el mensaje dice que hacer.
    assert.ok(!db.buscar('UPDATE mesas'), 'no se llego a escribir');
  } finally {
    db.restaurar();
  }
});

test('d-16b: una mesa DISPONIBLE con token si se desactiva', async () => {
  // Un token en una mesa 'disponible' es el resto de una sesion que ya
  // termino: no hay nadie sentado, asi que no bloquea (ajuste de Jarrison).
  const db = fakeMesas({ mesa: filaMesa({ estado: 'disponible', token_qr: 'tok-viejo' }) });
  try {
    const res = await patch({ activa: false });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.activa, false);
  } finally {
    db.restaurar();
  }
});

test('d-16b: al desactivar, el token queda en NULL', async () => {
  // Una mesa inactiva no conserva un QR: quedaria un codigo que escanea a una
  // mesa fuera de servicio. Se borra en la MISMA sentencia del UPDATE.
  const db = fakeMesas({ mesa: filaMesa({ estado: 'disponible', token_qr: 'tok-viejo' }) });
  try {
    const mesa = await mesasService.actualizarDatos(MESA, { activa: false });

    assert.strictEqual(mesa.token_qr, null);

    const update = db.buscar('UPDATE mesas');
    assert.ok(update, 'se escribio');
    assert.ok(
      update.sql.includes('token_qr  = CASE WHEN $5 IS FALSE THEN NULL ELSE token_qr END'),
      'el token se borra en el mismo UPDATE, no en una segunda sentencia'
    );
    assert.strictEqual(update.params[4], false);
  } finally {
    db.restaurar();
  }
});

test('d-16b: cambiar otros campos NO toca el token', async () => {
  // Sin `activa` en el cuerpo, el parametro va en null y el CASE no dispara.
  const db = fakeMesas({ mesa: filaMesa({ token_qr: 'tok-viejo' }) });
  try {
    const mesa = await mesasService.actualizarDatos(MESA, { ubicacion: 'Salon' });

    assert.strictEqual(mesa.token_qr, 'tok-viejo');
    assert.strictEqual(db.buscar('UPDATE mesas').params[4], null);
  } finally {
    db.restaurar();
  }
});

test('d-16b: activar una mesa tampoco toca el token', async () => {
  const db = fakeMesas({ mesa: filaMesa({ activa: false, token_qr: 'tok-viejo' }) });
  try {
    const mesa = await mesasService.actualizarDatos(MESA, { activa: true });

    assert.strictEqual(mesa.token_qr, 'tok-viejo');
    assert.strictEqual(db.buscar('UPDATE mesas').params[4], true);
  } finally {
    db.restaurar();
  }
});

test('d-16b: el 409 trae el formato { error, motivo } del backend', async () => {
  const db = fakeMesas({ mesa: filaMesa({ estado: 'ocupada' }) });
  try {
    const res = await patch({ activa: false });

    assert.deepStrictEqual(Object.keys(res.body).sort(), ['error', 'motivo']);
    // La convencion es `motivo`, no `codigo`.
    assert.strictEqual(res.body.codigo, undefined);
  } finally {
    db.restaurar();
  }
});

test('d-16b: desactivar una mesa YA inactiva no choca con la guarda', async () => {
  // La guarda mira el paso de activa a inactiva; reafirmar el valor no lo es.
  const db = fakeMesas({ mesa: filaMesa({ activa: false, estado: 'ocupada' }) });
  try {
    assert.strictEqual((await patch({ activa: false })).status, 200);
  } finally {
    db.restaurar();
  }
});

// ---------------------------------------------------------------------------
// El 23514 del trigger sale como 409, no como 422
// ---------------------------------------------------------------------------

test('d-16b: si el trigger rechaza el cambio, sale 409 y no 422', async () => {
  // Red de seguridad: el trigger cubre caminos que la guarda no ve (una
  // consulta a mano, o una carrera entre el SELECT y el UPDATE).
  const db = fakeMesas({
    errorUpdate: errorDelTrigger('La mesa 5 está ocupada: libérala antes de desactivarla'),
  });
  try {
    const res = await patch({ activa: false });

    assert.strictEqual(res.status, 409, 'el manejador central lo habria dejado en 422');
    assert.strictEqual(res.body.motivo, 'mesa_ocupada');
    // Y no se filtra el texto del trigger, que nombra la tabla y la funcion.
    assert.strictEqual(res.body.error, mesasService.MENSAJE_OCUPADA_NO_SE_DESACTIVA);
  } finally {
    db.restaurar();
  }
});

test('d-16b: otro error de la base NO se disfraza de 409', async () => {
  const err = new Error('duplicate key');
  err.code = '23505';
  const db = fakeMesas({ errorUpdate: err });
  try {
    const res = await patch({ numero: 9 });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, mesasService.MENSAJE_NUMERO_EN_USO, 'el 23505 sigue siendo el suyo');
  } finally {
    db.restaurar();
  }
});

test('d-16b: traducirMesaActiva solo traduce el 23514', () => {
  const traducido = mesasService.traducirMesaActiva(
    errorDelTrigger('x'),
    'mesa_inactiva',
    mesasService.MENSAJE_INACTIVA
  );
  assert.strictEqual(traducido.status, 409);
  assert.strictEqual(traducido.motivo, 'mesa_inactiva');

  // Cualquier otro sube como venia, para no tapar un CHECK distinto.
  const otro = new Error('fuera de rango');
  otro.code = '22003';
  assert.strictEqual(mesasService.traducirMesaActiva(otro, 'x', 'y'), otro);
  const sinCodigo = new Error('cualquier cosa');
  assert.strictEqual(mesasService.traducirMesaActiva(sinCodigo, 'x', 'y'), sinCodigo);
});

// ---------------------------------------------------------------------------
// Una mesa inactiva no se abre ni recibe QR
// ---------------------------------------------------------------------------

test('d-16b: abrir una mesa inactiva es 409 con motivo mesa_inactiva', async () => {
  // Lo rechaza tr_validar_mesa_activa con 23514; el servicio lo traduce.
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) return { rows: [filaMesa({ activa: false })] };
    if (sql.includes('UPDATE mesas')) {
      throw errorDelTrigger('La mesa 5 está inactiva y no se puede abrir');
    }
    return undefined;
  });
  const socket = instalarFakeSocket((ruta) =>
    (ruta === '/qr/generar'
      ? { __status: 201, token: 'tok-nuevo', id_mesa: MESA, expira_en: 123 }
      : { ok: true })
  );
  try {
    const res = await request(app)
      .post(`/api/mesas/${MESA}/abrir`)
      .set('Authorization', `Bearer ${mesero()}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'mesa_inactiva');
    assert.strictEqual(res.body.error, mesasService.MENSAJE_INACTIVA);
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});

test('d-16b: rotarle el QR a una mesa inactiva tambien es 409', async () => {
  const db = instalarFakeDb((sql) => {
    if (sql.includes('FROM mesas WHERE id_mesa')) {
      return { rows: [filaMesa({ activa: false, estado: 'ocupada', token_qr: 'viejo' })] };
    }
    if (sql.includes('UPDATE mesas')) {
      throw errorDelTrigger('La mesa 5 está inactiva y no puede recibir un QR');
    }
    return undefined;
  });
  const socket = instalarFakeSocket((ruta) =>
    (ruta === '/qr/generar'
      ? { __status: 201, token: 'tok-nuevo', id_mesa: MESA, expira_en: 123 }
      : { ok: true })
  );
  try {
    const res = await request(app)
      .post(`/api/mesas/${MESA}/rotar-qr`)
      .set('Authorization', `Bearer ${mesero()}`);

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'mesa_inactiva');
  } finally {
    socket.restaurar();
    db.restaurar();
  }
});
