const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { instalarFakeClientes, agregarZona } = require('./helpers/fake-clientes');
const app = require('../server');

// D-19 parte B: perfil, direcciones y zonas del cliente (solo /api/v1). El
// cliente sale SIEMPRE del JWT; una dirección de otro es un 404 igual al de
// una que no existe.

const V1 = '/api/v1';
const CLAVE = 'una-clave-buena';

/** Doble puesto y dos clientes (Ana y Beto), con sus JWT. */
async function escenario(fn) {
  const fake = instalarFakeClientes();
  try {
    const registrar = async (nombre, email) => {
      const r = await request(app).post(`${V1}/auth/clientes/registro`).send({ nombre, email, password: CLAVE });
      assert.strictEqual(r.status, 201);
      return r.body;
    };
    const ana = await registrar('Ana', 'ana@mail.com');
    const beto = await registrar('Beto', 'beto@mail.com');
    const como = (sesion) => ({
      get: (ruta) => request(app).get(`${V1}${ruta}`).set('Authorization', `Bearer ${sesion.token}`),
      post: (ruta, cuerpo) => request(app).post(`${V1}${ruta}`).set('Authorization', `Bearer ${sesion.token}`).send(cuerpo),
      patch: (ruta, cuerpo) => request(app).patch(`${V1}${ruta}`).set('Authorization', `Bearer ${sesion.token}`).send(cuerpo),
      delete: (ruta) => request(app).delete(`${V1}${ruta}`).set('Authorization', `Bearer ${sesion.token}`),
    });
    return await fn({ ...fake, ana: como(ana), beto: como(beto) });
  } finally {
    fake.restaurar();
  }
}

const DIRECCION = { direccion: 'Calle 10 # 5-20', barrio: 'Los Álamos' };

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

test('perfil: GET /clientes/yo devuelve { cliente } del JWT, sin hash', () =>
  escenario(async ({ ana, beto }) => {
    const res = await ana.get('/clientes/yo');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      cliente: { id_cliente: 1, nombre: 'Ana', email: 'ana@mail.com', telefono: null, verificado: false },
    });
    assert.strictEqual((await beto.get('/clientes/yo')).body.cliente.email, 'beto@mail.com');
  }));

test('perfil: PATCH cambia nombre y teléfono (recortando el nombre); telefono null lo borra', () =>
  escenario(async ({ ana, estado }) => {
    const r1 = await ana.patch('/clientes/yo', { nombre: '  Ana María ', telefono: '3001234567' });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
    assert.strictEqual(r1.body.cliente.nombre, 'Ana María');
    assert.strictEqual(r1.body.cliente.telefono, '3001234567');

    const r2 = await ana.patch('/clientes/yo', { telefono: null });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.body.cliente.telefono, null);
    assert.strictEqual(r2.body.cliente.nombre, 'Ana María', 'lo que no viene no cambia');
    assert.strictEqual(estado.clientes[1].nombre, 'Beto', 'el otro cliente no se toca');
  }));

for (const [caso, cuerpo] of [
  ['vacío', {}],
  ['un campo que no se cambia aquí (email)', { email: 'otro@mail.com' }],
  ['id_cliente en el cuerpo', { id_cliente: 2, nombre: 'X' }],
  ['nombre vacío', { nombre: '  ' }],
  ['nombre de 81 caracteres', { nombre: 'a'.repeat(81) }],
  ['teléfono fuera del CHECK', { telefono: '12-34' }],
  ['teléfono de 16 dígitos', { telefono: '1'.repeat(16) }],
]) {
  test(`perfil: PATCH ${caso} -> 400 cuerpo_invalido`, () =>
    escenario(async ({ ana }) => {
      const res = await ana.patch('/clientes/yo', cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }));
}

// ---------------------------------------------------------------------------
// Direcciones
// ---------------------------------------------------------------------------

test('direcciones: la primera nace principal aunque llegue con principal: false', () =>
  escenario(async ({ ana }) => {
    const res = await ana.post('/clientes/yo/direcciones', { ...DIRECCION, principal: false });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.direccion.principal, true);
    assert.deepStrictEqual(Object.keys(res.body.direccion).sort(), [
      'barrio', 'creado_en', 'direccion', 'id_direccion', 'lat', 'lng', 'principal', 'referencia',
    ]);
    assert.strictEqual(res.body.direccion.id_cliente, undefined, 'no se expone');
  }));

test('direcciones: una sola principal; marcar otra desmarca la anterior, y GET pone la principal primero', () =>
  escenario(async ({ ana, db }) => {
    const a = (await ana.post('/clientes/yo/direcciones', DIRECCION)).body.direccion;
    const b = (await ana.post('/clientes/yo/direcciones', { direccion: 'Cra 1', barrio: 'Centro' })).body.direccion;
    assert.strictEqual(b.principal, false, 'la segunda no, si no se pide');
    const c = (await ana.post('/clientes/yo/direcciones', { direccion: 'Cra 2', barrio: 'Norte', principal: true })).body.direccion;
    assert.strictEqual(c.principal, true);

    let lista = (await ana.get('/clientes/yo/direcciones')).body.direcciones;
    assert.deepStrictEqual(lista.filter((d) => d.principal).map((d) => d.id_direccion), [c.id_direccion]);
    assert.strictEqual(lista[0].id_direccion, c.id_direccion, 'la principal primero');

    const r = await ana.patch(`/clientes/yo/direcciones/${a.id_direccion}`, { principal: true });
    assert.strictEqual(r.status, 200);
    lista = (await ana.get('/clientes/yo/direcciones')).body.direcciones;
    assert.deepStrictEqual(lista.filter((d) => d.principal).map((d) => d.id_direccion), [a.id_direccion]);

    // Cada escritura bloquea la fila del cliente y desmarca antes de marcar.
    const bloqueos = db.todas('SELECT id_cliente FROM clientes WHERE id_cliente = $1::int FOR UPDATE');
    assert.ok(bloqueos.length >= 4);
    assert.ok(b.id_direccion);
  }));

test('direcciones: principal: false sobre LA principal -> 409 principal_requerida (siempre hay una)', () =>
  escenario(async ({ ana }) => {
    const a = (await ana.post('/clientes/yo/direcciones', DIRECCION)).body.direccion;
    const res = await ana.patch(`/clientes/yo/direcciones/${a.id_direccion}`, { principal: false });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.motivo, 'principal_requerida');
    assert.strictEqual((await ana.get('/clientes/yo/direcciones')).body.direcciones[0].principal, true);
  }));

test('direcciones: borrar la principal pasa la marca a la más reciente de las que quedan; borrar la última deja 0', () =>
  escenario(async ({ ana }) => {
    const a = (await ana.post('/clientes/yo/direcciones', DIRECCION)).body.direccion;
    const b = (await ana.post('/clientes/yo/direcciones', { direccion: 'Cra 1', barrio: 'Centro' })).body.direccion;
    const c = (await ana.post('/clientes/yo/direcciones', { direccion: 'Cra 2', barrio: 'Norte' })).body.direccion;

    const res = await ana.delete(`/clientes/yo/direcciones/${a.id_direccion}`);
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.text, '');
    let lista = (await ana.get('/clientes/yo/direcciones')).body.direcciones;
    assert.deepStrictEqual(lista.map((d) => [d.id_direccion, d.principal]), [[c.id_direccion, true], [b.id_direccion, false]]);

    // Borrar una que no es la principal no cambia la principal.
    assert.strictEqual((await ana.delete(`/clientes/yo/direcciones/${b.id_direccion}`)).status, 204);
    assert.strictEqual((await ana.delete(`/clientes/yo/direcciones/${c.id_direccion}`)).status, 204);
    lista = (await ana.get('/clientes/yo/direcciones')).body.direcciones;
    assert.deepStrictEqual(lista, []);
  }));

test('direcciones: la de OTRO cliente es 404 no_encontrado, igual que una que no existe, y no se toca', () =>
  escenario(async ({ ana, beto, estado }) => {
    const deBeto = (await beto.post('/clientes/yo/direcciones', DIRECCION)).body.direccion;
    const ajena = `/clientes/yo/direcciones/${deBeto.id_direccion}`;

    const patch = await ana.patch(ajena, { direccion: 'Mía ahora' });
    const borrar = await ana.delete(ajena);
    const inexistente = await ana.patch('/clientes/yo/direcciones/999999', { direccion: 'x' });
    for (const res of [patch, borrar, inexistente]) {
      assert.strictEqual(res.status, 404);
      assert.deepStrictEqual(res.body, { error: 'Dirección no encontrada', motivo: 'no_encontrado' });
    }
    assert.deepStrictEqual((await ana.get('/clientes/yo/direcciones')).body.direcciones, [], 'Ana no ve las de Beto');
    assert.strictEqual(estado.direcciones[0].direccion, DIRECCION.direccion);
  }));

for (const id of ['abc', '0', '-3', '1.5', '99999999999']) {
  test(`direcciones: un :id que no es entero positivo (${id}) es 404 sin tocar la base`, () =>
    escenario(async ({ ana, db }) => {
      const desde = db.ejecutadas.length;
      const res = await ana.patch(`/clientes/yo/direcciones/${id}`, { direccion: 'x' });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.motivo, 'no_encontrado');
      assert.ok(!db.ejecutadas.slice(desde).some((q) => q.sql.includes('direcciones')));
    }));
}

test('direcciones: PATCH cambia solo lo que viene; lat y lng juntos, y null en los dos los borra', () =>
  escenario(async ({ ana }) => {
    const a = (await ana.post('/clientes/yo/direcciones', { ...DIRECCION, referencia: ' Portón azul ', lat: 4.6, lng: -74.08 })).body.direccion;
    assert.strictEqual(a.referencia, 'Portón azul');
    assert.strictEqual(a.lat, 4.6);

    const r1 = await ana.patch(`/clientes/yo/direcciones/${a.id_direccion}`, { barrio: 'Centro' });
    assert.strictEqual(r1.body.direccion.barrio, 'Centro');
    assert.strictEqual(r1.body.direccion.direccion, DIRECCION.direccion);

    const r2 = await ana.patch(`/clientes/yo/direcciones/${a.id_direccion}`, { lat: null, lng: null, referencia: '' });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual(r2.body.direccion.lat, null);
    assert.strictEqual(r2.body.direccion.lng, null);
    assert.strictEqual(r2.body.direccion.referencia, null, 'vacía se guarda como null');
  }));

for (const [caso, cuerpo] of [
  ['sin barrio', { direccion: 'Calle 1' }],
  ['sin direccion', { barrio: 'Centro' }],
  ['direccion vacía', { direccion: '  ', barrio: 'Centro' }],
  ['barrio de 81', { direccion: 'Calle 1', barrio: 'b'.repeat(81) }],
  ['direccion de 201', { direccion: 'd'.repeat(201), barrio: 'Centro' }],
  ['referencia de 201', { ...DIRECCION, referencia: 'r'.repeat(201) }],
  ['solo lat', { ...DIRECCION, lat: 4.6 }],
  ['solo lng', { ...DIRECCION, lng: -74 }],
  ['lat con lng null', { ...DIRECCION, lat: 4.6, lng: null }],
  ['lat fuera de rango', { ...DIRECCION, lat: 91, lng: 0 }],
  ['lng fuera de rango', { ...DIRECCION, lat: 0, lng: -181 }],
  ['lat como texto', { ...DIRECCION, lat: '4.6', lng: '-74' }],
  ['principal como texto', { ...DIRECCION, principal: 'true' }],
  ['un campo de más (id_cliente)', { ...DIRECCION, id_cliente: 2 }],
]) {
  test(`direcciones: POST ${caso} -> 400 cuerpo_invalido`, () =>
    escenario(async ({ ana, estado }) => {
      const res = await ana.post('/clientes/yo/direcciones', cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
      assert.strictEqual(estado.direcciones.length, 0);
    }));
}

for (const [caso, cuerpo] of [
  ['vacío', {}],
  ['solo lat', { lat: 1 }],
  ['un campo de más', { id_direccion: 9 }],
]) {
  test(`direcciones: PATCH ${caso} -> 400 cuerpo_invalido`, () =>
    escenario(async ({ ana }) => {
      const a = (await ana.post('/clientes/yo/direcciones', DIRECCION)).body.direccion;
      const res = await ana.patch(`/clientes/yo/direcciones/${a.id_direccion}`, cuerpo);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }));
}

// ---------------------------------------------------------------------------
// Zonas
// ---------------------------------------------------------------------------

test('zonas: GET /zonas es público y lista SOLO las activas, con los campos del contrato', () =>
  escenario(async ({ estado }) => {
    agregarZona(estado, { nombre: 'Norte', barrios: ['Los Álamos', 'Centro'], costo_envio: 4500, tiempo_estimado_min: 35 });
    agregarZona(estado, { nombre: 'Vieja', barrios: ['Sur'], activa: false });

    const res = await request(app).get(`${V1}/zonas`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      zonas: [{ id_zona: 1, nombre: 'Norte', barrios: ['Los Álamos', 'Centro'], costo_envio: 4500, tiempo_estimado_min: 35 }],
    });
  }));

test('zonas: cotizar una dirección propia -> { zona, costo_envio } (la normalización la decide la base)', () =>
  escenario(async ({ ana, estado, db }) => {
    agregarZona(estado, { nombre: 'Norte', barrios: ['los alamos'], costo_envio: 4500, tiempo_estimado_min: 35 });
    const d = (await ana.post('/clientes/yo/direcciones', { direccion: 'Calle 1', barrio: '  Los   Álamos ' })).body.direccion;

    const res = await ana.get(`/zonas/cotizar?id_direccion=${d.id_direccion}`);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body, { zona: { id_zona: 1, nombre: 'Norte', tiempo_estimado_min: 35 }, costo_envio: 4500 });
    assert.ok(db.buscar('cotizar_zona(d.barrio::text)'), 'la llama a la función de la base, no compara aquí');
  }));

test('zonas: fuera de cobertura -> 422 fuera_de_cobertura; dirección ajena o inexistente -> 404', () =>
  escenario(async ({ ana, beto, estado }) => {
    agregarZona(estado, { nombre: 'Norte', barrios: ['Centro'] });
    const lejos = (await ana.post('/clientes/yo/direcciones', { direccion: 'Km 40', barrio: 'Vereda Lejana' })).body.direccion;
    const deBeto = (await beto.post('/clientes/yo/direcciones', { direccion: 'Calle 1', barrio: 'Centro' })).body.direccion;

    const fuera = await ana.get(`/zonas/cotizar?id_direccion=${lejos.id_direccion}`);
    assert.strictEqual(fuera.status, 422);
    assert.strictEqual(fuera.body.motivo, 'fuera_de_cobertura');

    for (const id of [deBeto.id_direccion, 424242]) {
      const res = await ana.get(`/zonas/cotizar?id_direccion=${id}`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.motivo, 'no_encontrado');
    }
  }));

for (const query of ['', '?id_direccion=', '?id_direccion=abc', '?id_direccion=0', '?id_direccion=1&id_direccion=2', '?id_direccion=1&otra=2']) {
  test(`zonas: cotizar con query inválida (${query || 'vacía'}) -> 400 cuerpo_invalido`, () =>
    escenario(async ({ ana }) => {
      const res = await ana.get(`/zonas/cotizar${query}`);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.motivo, 'cuerpo_invalido');
    }));
}

test('zonas: cotizar sin sesión es 401 no_autenticado', async () => {
  const res = await request(app).get(`${V1}/zonas/cotizar?id_direccion=1`);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.motivo, 'no_autenticado');
});
