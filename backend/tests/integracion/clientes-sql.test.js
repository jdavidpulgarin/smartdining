const test = require('node:test');
const assert = require('node:assert');

/**
 * D-19 parte B: las rutas de clientes contra PostgreSQL REAL (scripts 36 y 37).
 *
 * Lo que el doble de base no puede probar y aquí sí:
 *   - la rotación en la base de verdad (rotado_en, reemplazado_por) y que el
 *     trigger tr_refresh_rotacion y ck_refresh_rotado la aceptan;
 *   - la ventana de gracia medida con now() de la base;
 *   - dos /refresh SIMULTÁNEOS con el mismo token: el FOR UPDATE los pone en fila
 *     y no quedan dos ramas vivas;
 *   - una sola dirección principal con dos marcadas a la vez (uq_direcciones_principal);
 *   - cotizar con fn_clave_barrio de la base ("  Los   Álamos " = "los alamos");
 *   - dos registros a la vez con el mismo email (uq_clientes_email -> 409).
 *
 * DATOS PROPIOS (patrón del #218): cada cliente lleva un email con un sufijo
 * aleatorio de esta corrida, las zonas un nombre y barrios aleatorios (el
 * trigger de zonas no deja repetir un barrio en dos zonas activas). El `after`
 * borra los clientes de esta corrida (direcciones y refresh tokens caen en
 * cascada) y sus zonas. No depende del seed ni de otra suite.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

// Sin socket-server real y sin Redis (la caché de cliente activo no se usa en pruebas).
process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { SQL_BLOQUEADOS_POR_MI } = require('../helpers/bloqueos');
const { hashDeRefresh } = require('../../src/utils/refresh-token');
const app = require('../../server');
const pool = require('../../src/config/db');

const V1 = '/api/v1';
const CLAVE = 'clave-de-prueba-1';
/** Sufijo de ESTA corrida: todo lo que se crea lo lleva. */
const CORRIDA = crypto.randomBytes(5).toString('hex');
const DOMINIO = `prueba-clientes-${CORRIDA}.test`;
const PREFIJO_ZONA = `prueba-clientes-${CORRIDA}`;

let sonda = null;
let hayBase = false;
let siguiente = 0;

const emailNuevo = () => `cliente${++siguiente}@${DOMINIO}`;

async function limpiar() {
  await sonda.query('DELETE FROM clientes WHERE email LIKE $1::text', [`%@${DOMINIO}`]);
  await sonda.query('DELETE FROM zonas_envio WHERE nombre LIKE $1::text', [`${PREFIJO_ZONA}%`]);
}

test.before(async () => {
  sonda = await abrirSonda();
  hayBase = sonda !== null;
  if (hayBase) await limpiar();
});

test.after(async () => {
  try {
    if (hayBase) await limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

const saltar = (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return true;
  }
  return false;
};

const registrar = (email = emailNuevo()) =>
  request(app).post(`${V1}/auth/clientes/registro`).send({ nombre: 'Cliente de prueba', email, password: CLAVE });
const refrescar = (token) => request(app).post(`${V1}/auth/clientes/refresh`).send({ refresh_token: token });

/** La fila del token en la base. */
async function fila(token) {
  const { rows } = await sonda.query(
    `SELECT id, id_cliente, familia, rotado_en, reemplazado_por, revocado_en, expira_en, creado_en
       FROM refresh_tokens_cliente WHERE hash = $1::char(64)`,
    [hashDeRefresh(token)]
  );
  return rows[0];
}

/** Tokens vigentes (sin revocar y sin rotar) de una familia. */
async function vigentes(familia) {
  const { rows } = await sonda.query(
    `SELECT id FROM refresh_tokens_cliente
      WHERE familia = $1::uuid AND revocado_en IS NULL AND reemplazado_por IS NULL`,
    [familia]
  );
  return rows.map((r) => r.id);
}

/** Espera a ver `cuantas` conexiones esperando el bloqueo que retiene `conexion`. */
async function esperarBloqueados(conexion, cuantas) {
  for (let i = 0; i < 20000; i++) {
    // Solo las que cuelgan de ESTE bloqueo (tests/helpers/bloqueos.js): en
    // paralelo, otras suites tienen sus propias esperas de bloqueo.
    const { rows } = await conexion.query(SQL_BLOQUEADOS_POR_MI);
    if (rows[0].n >= cuantas) return;
  }
  assert.fail(`no se vieron ${cuantas} peticiones esperando el bloqueo`);
}

/**
 * Retiene una fila con FOR UPDATE, lanza las peticiones, espera a verlas
 * bloqueadas y suelta: así las dos llegan de verdad a la vez a la fila.
 */
async function aLaVez(sqlBloqueo, params, lanzar) {
  // Conexiones del pool de la app ya abiertas: si no, una petición se queda
  // abriendo conexión y no llega a la cola.
  await Promise.all([1, 2, 3, 4].map(() => pool.query('SELECT 1')));
  const reten = await sonda.connect();
  let promesas;
  try {
    await reten.query('BEGIN');
    await reten.query(sqlBloqueo, params);
    // supertest no manda la petición hasta que alguien llama a .then(): se
    // arrancan aquí, si no nunca llegarían a la cola del bloqueo.
    promesas = lanzar().map((p) => p.then((r) => r));
    await esperarBloqueados(reten, promesas.length);
  } finally {
    await reten.query('ROLLBACK');
    reten.release();
  }
  return Promise.all(promesas);
}

test('registro -> login -> refresh: rotación real en la base, con rotado_en y reemplazado_por', async (t) => {
  if (saltar(t)) return;
  const email = emailNuevo();
  const reg = await registrar(` ${email.toUpperCase()} `);
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));
  assert.strictEqual(reg.body.cliente.email, email, 'guardado en minúsculas');

  const { rows: guardado } = await sonda.query('SELECT email, password_hash FROM clientes WHERE id_cliente = $1::int', [reg.body.cliente.id_cliente]);
  assert.strictEqual(guardado[0].email, email);
  assert.match(guardado[0].password_hash, /^\$2[aby]\$10\$/);

  const login = await request(app).post(`${V1}/auth/clientes/login`).send({ email: `  ${email.toUpperCase()}`, password: CLAVE });
  assert.strictEqual(login.status, 200, JSON.stringify(login.body));
  const tokenLogin = await fila(login.body.refresh_token);
  assert.notStrictEqual(tokenLogin.familia, (await fila(reg.body.refresh_token)).familia, 'familia nueva por login');
  const dias = (tokenLogin.expira_en - tokenLogin.creado_en) / 86400000;
  assert.ok(Math.abs(dias - 30) < 0.01, `30 días: ${dias}`);

  const r = await refrescar(login.body.refresh_token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const viejo = await fila(login.body.refresh_token);
  const nuevo = await fila(r.body.refresh_token);
  assert.ok(viejo.rotado_en instanceof Date, 'rotado_en puesto');
  assert.strictEqual(viejo.reemplazado_por, nuevo.id);
  assert.strictEqual(viejo.revocado_en, null);
  assert.strictEqual(nuevo.familia, viejo.familia);
  assert.deepStrictEqual(await vigentes(viejo.familia), [nuevo.id]);
});

test('gracia: reusar el viejo dentro de 30 s da par nuevo y anula el reemplazo; rotado_en no se mueve', async (t) => {
  if (saltar(t)) return;
  const reg = await registrar();
  const perdido = (await refrescar(reg.body.refresh_token)).body.refresh_token;
  const rotadoAntes = (await fila(reg.body.refresh_token)).rotado_en;

  const r = await refrescar(reg.body.refresh_token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  const viejo = await fila(reg.body.refresh_token);
  const anulado = await fila(perdido);
  const nuevo = await fila(r.body.refresh_token);
  assert.ok(anulado.revocado_en instanceof Date, 'el reemplazo no usado quedó revocado');
  assert.strictEqual(viejo.reemplazado_por, nuevo.id, 'el viejo apunta al nuevo');
  assert.strictEqual(viejo.rotado_en.getTime(), rotadoAntes.getTime(), 'rotado_en intacto (el trigger lo exige)');
  assert.deepStrictEqual(await vigentes(viejo.familia), [nuevo.id], 'una sola rama viva');

  // Y después del logout, el viejo es reuso: familia revocada.
  assert.strictEqual((await request(app).post(`${V1}/auth/clientes/logout`).send({ refresh_token: r.body.refresh_token })).status, 204);
  assert.ok((await fila(r.body.refresh_token)).revocado_en instanceof Date, 'logout revoca ese token');
  const reuso = await refrescar(r.body.refresh_token);
  assert.strictEqual(reuso.status, 401);
  assert.strictEqual(reuso.body.motivo, 'sesion_revocada');
  assert.deepStrictEqual(await vigentes(viejo.familia), []);
});

test('gracia: fuera de la ventana (medida con now() de la base) el reuso revoca la familia', async (t) => {
  if (saltar(t)) return;
  const antes = process.env.REFRESH_CLIENTE_GRACIA_SEGUNDOS;
  process.env.REFRESH_CLIENTE_GRACIA_SEGUNDOS = '1';
  try {
    const reg = await registrar();
    const reemplazo = (await refrescar(reg.body.refresh_token)).body.refresh_token;
    await new Promise((r) => setTimeout(r, 1500));

    const res = await refrescar(reg.body.refresh_token);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.motivo, 'sesion_revocada');
    assert.ok((await fila(reemplazo)).revocado_en instanceof Date, 'toda la familia');
    assert.strictEqual((await refrescar(reemplazo)).body.motivo, 'sesion_revocada');
  } finally {
    if (antes === undefined) delete process.env.REFRESH_CLIENTE_GRACIA_SEGUNDOS;
    else process.env.REFRESH_CLIENTE_GRACIA_SEGUNDOS = antes;
  }
});

test('dos /refresh SIMULTÁNEOS con el mismo token: se ponen en fila y queda UNA sola rama viva', async (t) => {
  if (saltar(t)) return;
  const reg = await registrar();
  const token = reg.body.refresh_token;
  const { familia } = await fila(token);

  const respuestas = await aLaVez(
    'SELECT id FROM refresh_tokens_cliente WHERE hash = $1::char(64) FOR UPDATE',
    [hashDeRefresh(token)],
    () => [refrescar(token), refrescar(token)]
  );

  // El primero rota; el segundo espera, ve el token rotado y cae en la gracia:
  // anula el reemplazo del primero y emite el suyo.
  assert.deepStrictEqual(respuestas.map((r) => r.status), [200, 200], JSON.stringify(respuestas.map((r) => r.body)));
  const vivas = await vigentes(familia);
  assert.strictEqual(vivas.length, 1, `ramas vivas: ${vivas}`);
  const tokensDevueltos = await Promise.all(respuestas.map((r) => fila(r.body.refresh_token)));
  assert.strictEqual(tokensDevueltos.filter((f) => f.revocado_en === null).length, 1, 'solo uno de los dos sirve');
});

test('registro: dos a la vez con el mismo email -> uno 201 y el otro 409 email_registrado', async (t) => {
  if (saltar(t)) return;
  const email = emailNuevo();
  const [a, b] = await Promise.all([registrar(email), registrar(email.toUpperCase())]);
  assert.deepStrictEqual([a.status, b.status].sort(), [201, 409]);
  const conflicto = a.status === 409 ? a : b;
  assert.strictEqual(conflicto.body.motivo, 'email_registrado');
  const { rows } = await sonda.query('SELECT count(*)::int AS n FROM clientes WHERE lower(email) = $1::text', [email]);
  assert.strictEqual(rows[0].n, 1);
});

test('direcciones: dos marcadas como principal A LA VEZ -> queda exactamente una principal', async (t) => {
  if (saltar(t)) return;
  const reg = await registrar();
  const auth = { Authorization: `Bearer ${reg.body.token}` };
  const crear = (cuerpo) => request(app).post(`${V1}/clientes/yo/direcciones`).set(auth).send(cuerpo);
  const a = (await crear({ direccion: 'Calle 1', barrio: 'Uno' })).body.direccion;
  const b = (await crear({ direccion: 'Calle 2', barrio: 'Dos' })).body.direccion;
  const c = (await crear({ direccion: 'Calle 3', barrio: 'Tres' })).body.direccion;
  assert.strictEqual(a.principal, true, 'la primera nace principal');

  const respuestas = await aLaVez(
    'SELECT id_cliente FROM clientes WHERE id_cliente = $1::int FOR UPDATE',
    [reg.body.cliente.id_cliente],
    () => [
      request(app).patch(`${V1}/clientes/yo/direcciones/${b.id_direccion}`).set(auth).send({ principal: true }),
      request(app).patch(`${V1}/clientes/yo/direcciones/${c.id_direccion}`).set(auth).send({ principal: true }),
      crear({ direccion: 'Calle 4', barrio: 'Cuatro', principal: true }),
    ]
  );
  assert.deepStrictEqual(respuestas.map((r) => r.status), [200, 200, 201], JSON.stringify(respuestas.map((r) => r.body)));

  const { rows } = await sonda.query(
    'SELECT count(*) FILTER (WHERE principal)::int AS principales, count(*)::int AS total FROM direcciones WHERE id_cliente = $1::int',
    [reg.body.cliente.id_cliente]
  );
  assert.deepStrictEqual(rows[0], { principales: 1, total: 4 });

  // Borrar la principal pasa la marca a otra.
  const lista = (await request(app).get(`${V1}/clientes/yo/direcciones`).set(auth)).body.direcciones;
  assert.strictEqual(lista[0].principal, true);
  assert.strictEqual((await request(app).delete(`${V1}/clientes/yo/direcciones/${lista[0].id_direccion}`).set(auth)).status, 204);
  const { rows: tras } = await sonda.query(
    'SELECT count(*) FILTER (WHERE principal)::int AS principales FROM direcciones WHERE id_cliente = $1::int',
    [reg.body.cliente.id_cliente]
  );
  assert.strictEqual(tras[0].principales, 1);
});

test('direcciones: la de otro cliente es 404 y no se toca', async (t) => {
  if (saltar(t)) return;
  const ana = await registrar();
  const beto = await registrar();
  const deBeto = (await request(app).post(`${V1}/clientes/yo/direcciones`).set('Authorization', `Bearer ${beto.body.token}`).send({ direccion: 'Calle B', barrio: 'B' })).body.direccion;

  const res = await request(app).delete(`${V1}/clientes/yo/direcciones/${deBeto.id_direccion}`).set('Authorization', `Bearer ${ana.body.token}`);
  assert.strictEqual(res.status, 404);
  const { rows } = await sonda.query('SELECT count(*)::int AS n FROM direcciones WHERE id_direccion = $1::int', [deBeto.id_direccion]);
  assert.strictEqual(rows[0].n, 1);
});

test('cotizar: "  Los   Álamos " encuentra la zona de "los alamos" (fn_clave_barrio); otro barrio, 422', async (t) => {
  if (saltar(t)) return;
  const barrio = `los alamos ${CORRIDA}`;
  const { rows: zona } = await sonda.query(
    `INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min)
     VALUES ($1::varchar, $2::text[], $3::numeric, $4::int) RETURNING id_zona`,
    [`${PREFIJO_ZONA} norte`, [barrio, `centro ${CORRIDA}`], 4500, 35]
  );
  await sonda.query(
    `INSERT INTO zonas_envio (nombre, barrios, costo_envio, tiempo_estimado_min, activa)
     VALUES ($1::varchar, $2::text[], $3::numeric, $4::int, FALSE)`,
    [`${PREFIJO_ZONA} inactiva`, [`sur ${CORRIDA}`], 3000, 20]
  );

  const reg = await registrar();
  const auth = { Authorization: `Bearer ${reg.body.token}` };
  const crear = (b) => request(app).post(`${V1}/clientes/yo/direcciones`).set(auth).send({ direccion: 'Calle 1', barrio: b });
  const cerca = (await crear(`  Los   Álamos ${CORRIDA.toUpperCase()} `)).body.direccion;
  const lejos = (await crear(`Sur ${CORRIDA}`)).body.direccion; // solo en una zona INACTIVA

  const ok = await request(app).get(`${V1}/zonas/cotizar?id_direccion=${cerca.id_direccion}`).set(auth);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.deepStrictEqual(ok.body, {
    zona: { id_zona: zona[0].id_zona, nombre: `${PREFIJO_ZONA} norte`, tiempo_estimado_min: 35 },
    costo_envio: 4500,
  });

  const fuera = await request(app).get(`${V1}/zonas/cotizar?id_direccion=${lejos.id_direccion}`).set(auth);
  assert.strictEqual(fuera.status, 422);
  assert.strictEqual(fuera.body.motivo, 'fuera_de_cobertura');

  // GET /zonas (público) trae la activa y no la inactiva.
  const zonas = (await request(app).get(`${V1}/zonas`)).body.zonas.filter((z) => z.nombre.startsWith(PREFIJO_ZONA));
  assert.deepStrictEqual(zonas, [
    { id_zona: zona[0].id_zona, nombre: `${PREFIJO_ZONA} norte`, barrios: [barrio, `centro ${CORRIDA}`], costo_envio: 4500, tiempo_estimado_min: 35 },
  ]);
});

test('cliente inactivo: no entra a sus rutas, no inicia sesión y no renueva', async (t) => {
  if (saltar(t)) return;
  const email = emailNuevo();
  const reg = await registrar(email);
  await sonda.query('UPDATE clientes SET activo = FALSE WHERE id_cliente = $1::int', [reg.body.cliente.id_cliente]);

  const yo = await request(app).get(`${V1}/clientes/yo`).set('Authorization', `Bearer ${reg.body.token}`);
  assert.strictEqual(yo.status, 401);
  assert.strictEqual(yo.body.motivo, 'no_autenticado');

  const login = await request(app).post(`${V1}/auth/clientes/login`).send({ email, password: CLAVE });
  assert.strictEqual(login.status, 401);
  assert.strictEqual(login.body.motivo, 'credenciales_invalidas');

  const r = await refrescar(reg.body.refresh_token);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.motivo, 'refresh_invalido');
  assert.strictEqual((await fila(reg.body.refresh_token)).revocado_en, null, 'no se revoca nada');
});

test('perfil: PATCH contra la base respeta sus CHECK y devuelve el cliente', async (t) => {
  if (saltar(t)) return;
  const reg = await registrar();
  const auth = { Authorization: `Bearer ${reg.body.token}` };
  const res = await request(app).patch(`${V1}/clientes/yo`).set(auth).send({ nombre: ' Nombre Nuevo ', telefono: '+573001112233' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.cliente.nombre, 'Nombre Nuevo');
  assert.strictEqual(res.body.cliente.telefono, '+573001112233');
  const { rows } = await sonda.query('SELECT nombre, telefono FROM clientes WHERE id_cliente = $1::int', [reg.body.cliente.id_cliente]);
  assert.deepStrictEqual(rows[0], { nombre: 'Nombre Nuevo', telefono: '+573001112233' });
});
