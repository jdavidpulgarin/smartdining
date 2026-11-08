const test = require('node:test');
const assert = require('node:assert');
const { tokenStaff } = require('./helpers/fake-db');
const { TABLA, claveDe, pedir, protegidas, publicas } = require('./helpers/catalogo-rutas');

// D-11: que ninguna respuesta de error cuente de más, en NINGUNA ruta.
//
// errores-db.test.js ya prueba esto caso por caso y muy bien (24 pruebas: que
// el 422 no lleve el texto de PostgreSQL, que el 409 de concurrencia no nombre
// procesos ni bloqueos, que el constraint no salga). Lo que no había era la
// versión general: recorrer TODAS las rutas, hacer estallar la consulta de cada
// una y comprobar que lo que sale al cliente no contiene un rastro de pila, SQL,
// nombres internos del esquema ni datos de otra persona.
//
// La diferencia importa porque la fuga no la introduce quien escribió el
// manejador de errores, sino la ruta que se añade después.

/**
 * Error de PostgreSQL como lo entrega `pg`: con `code`, y con `detail`,
 * `where`, `constraint`, `table` y `schema` llenos de nombres internos.
 *
 * Los textos son los de verdad: así se ven los mensajes de Postgres cuando
 * revienta un trigger del esquema de Jarrison.
 */
function errorPg(code, extra = {}) {
  const err = new Error('error interno de postgres que nadie debe leer');
  err.code = code;
  err.detail = 'Key (email)=(victima@gmail.com) already exists.';
  err.where = 'función PL/pgSQL fn_tr_calcular_tiempo_preparacion() en la línea 28 en RETURN';
  err.constraint = 'usuarios_email_key';
  err.table = 'usuarios';
  err.schema = 'public';
  err.severity = 'ERROR';
  err.routine = 'errorMissingColumn';
  return Object.assign(err, extra);
}

/**
 * Trozos que NO pueden aparecer en el cuerpo de una respuesta, con el motivo.
 *
 * Se busca sobre el JSON completo, no solo sobre `error`: un campo extra que
 * alguien añada al responder también cuenta como fuga.
 */
const PROHIBIDO = [
  ['node_modules', 'rastro de pila'],
  ['.js:', 'rastro de pila con archivo y línea'],
  ['at Object.', 'rastro de pila'],
  ['at async', 'rastro de pila'],
  ['backend\\src', 'ruta del servidor'],
  ['backend/src', 'ruta del servidor'],
  ['SELECT ', 'SQL'],
  ['INSERT INTO', 'SQL'],
  ['UPDATE pedidos', 'SQL'],
  ['DELETE FROM', 'SQL'],
  ['pg_', 'nombre interno de PostgreSQL'],
  ['PL/pgSQL', 'interior de un trigger'],
  ['fn_tr_', 'nombre de función del esquema'],
  ['usuarios_email_key', 'nombre de constraint'],
  ['victima@gmail.com', 'dato de otra persona'],
  ['password_hash', 'columna de credenciales'],
  ['$2b$', 'hash de bcrypt'],
  ['errorMissingColumn', 'routine interna de PostgreSQL'],
  ['error interno de postgres', 'mensaje interno del error'],
];

/** Afirma que el cuerpo de la respuesta no contiene nada prohibido. */
function sinFuga(res, contexto) {
  const cuerpo = JSON.stringify(res.body || {});
  for (const [trozo, motivo] of PROHIBIDO) {
    assert.ok(
      !cuerpo.includes(trozo),
      `${contexto} filtró ${motivo} ("${trozo}") respondiendo ${res.status}: ${cuerpo}`
    );
  }
  // El texto de la pila tampoco puede viajar en el cuerpo crudo, que es lo que
  // se vería si alguien respondiera con el error entero en vez de con JSON.
  assert.ok(!String(res.text || '').includes('    at '), `${contexto} filtró una pila en el cuerpo`);
}

/** Credenciales con las que la petición llega al controller de cada familia. */
function credencialesDe(fila) {
  if (fila.acceso === 'interna') return { cabeceras: { 'x-internal-key': 'clave-interna-de-prueba' } };
  if (fila.acceso === 'publica') return {};
  // Admin entra en todas las protegidas menos las del comensal; para esas el
  // 403 llega antes del controller y la respuesta tampoco filtra nada, que es
  // lo único que se afirma aquí.
  return { token: tokenStaff(1, 'admin') };
}

/**
 * Fallos con los que se bombardea cada ruta.
 *
 * `codigo` null es un error de JavaScript corriente (un TypeError, un bug):
 * el que trae una pila de verdad y acaba en el 500 genérico.
 */
const FALLOS = [
  { nombre: 'error de JavaScript con pila', construir: () => new Error('algo se rompió en backend/src/services') },
  { nombre: 'TypeError con pila', construir: () => new TypeError("Cannot read properties of undefined (reading 'rows')") },
  { nombre: 'desbordamiento numérico (22003)', construir: () => errorPg('22003') },
  { nombre: 'formato inválido (22P02)', construir: () => errorPg('22P02') },
  { nombre: 'unicidad (23505)', construir: () => errorPg('23505') },
  { nombre: 'clave ajena (23503)', construir: () => errorPg('23503') },
  { nombre: 'CHECK (23514)', construir: () => errorPg('23514') },
  { nombre: 'deadlock (40P01)', construir: () => errorPg('40P01') },
  { nombre: 'consulta cancelada (57014)', construir: () => errorPg('57014') },
  { nombre: 'columna inexistente (42703)', construir: () => errorPg('42703') },
  { nombre: 'NOT NULL (23502)', construir: () => errorPg('23502') },
];

for (const fallo of FALLOS) {
  test(`d-11: ningún endpoint filtra nada con un ${fallo.nombre}`, async () => {
    for (const fila of TABLA) {
      const res = await pedir(fila, {
        ...credencialesDe(fila),
        responder: () => {
          throw fallo.construir();
        },
      });

      sinFuga(res, `${claveDe(fila)} con ${fallo.nombre}`);
      assert.ok(res.status >= 200 && res.status < 600, `${claveDe(fila)} respondió ${res.status}`);
    }
  });
}

test('d-11: un fallo de la base nunca responde 200', async () => {
  // Si una consulta estalla y la ruta contesta 200, el cliente se queda con un
  // cuerpo a medias creyendo que todo salió bien. Se mira solo en las rutas
  // protegidas con admin, que son las que llegan al controller.
  const saltar = ['/api/pedidos/mesa', '/api/pedidos/mesa/cuenta'];

  for (const fila of protegidas.filter((f) => !saltar.includes(f.patron))) {
    const res = await pedir(fila, {
      ...credencialesDe(fila),
      responder: () => {
        throw errorPg('22003');
      },
    });

    assert.notStrictEqual(res.status, 200, `${claveDe(fila)} respondió 200 con la base caída`);
  }
});

test('d-11: el 500 genérico dice lo mismo en todas las rutas', async () => {
  // Un mensaje distinto por ruta es un mapa de lo que hay detrás. El manejador
  // central responde siempre igual, y esto lo fija.
  const mensajes = new Set();

  for (const fila of protegidas) {
    const res = await pedir(fila, {
      ...credencialesDe(fila),
      responder: () => {
        throw new Error('detalle que no debe salir');
      },
    });
    if (res.status === 500) mensajes.add(res.body.error);
  }

  assert.ok(mensajes.size > 0, 'ninguna ruta llegó al 500, la prueba no probó nada');
  assert.deepStrictEqual([...mensajes], ['Error interno del servidor']);
});

test('d-11: el mensaje de un trigger SÍ sale, pero sin su contorno técnico', async () => {
  // Excepción deliberada y documentada: los RAISE EXCEPTION del esquema
  // (P0001) están redactados para que los lea quien está delante de la pantalla
  // ("El plato X no se encuentra disponible"), así que su `message` se reenvía.
  // Lo que NO puede salir es el resto del error: el `where` con la función
  // PL/pgSQL, el `detail` con datos de otra persona ni el `constraint`.
  const aviso = 'El plato Hamburguesa Smart Angus no se encuentra disponible';

  const res = await pedir(
    { metodo: 'PATCH', url: '/api/pedidos/87/estado', cuerpo: { estado: 'listo' } },
    {
      token: tokenStaff(1, 'admin'),
      responder: () => {
        throw errorPg('P0001', { message: aviso });
      },
    }
  );

  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error, aviso);
  sinFuga(res, 'el 409 de un trigger');
});

test('d-11: una ruta que no existe no delata el enrutador', async () => {
  const res = await pedir({ metodo: 'GET', url: '/api/no-existe/de/verdad' });

  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.body, { error: 'Ruta no encontrada' });
  sinFuga(res, 'el 404 del enrutador');
});

test('d-11: un JSON mal formado no devuelve el error del parser', async () => {
  // express.json() lanza un SyntaxError con el cuerpo recibido dentro del
  // mensaje. Si saliera tal cual, el cliente vería su propio payload de vuelta
  // y, peor, la pila del parser.
  const request = require('supertest');
  const app = require('../server');

  const res = await request(app)
    .post('/api/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email": "roto",,,}');

  assert.ok(res.status >= 400, `respondió ${res.status}`);
  sinFuga(res, 'el error de JSON mal formado');
});

test('d-11: las rutas públicas tampoco filtran con la base caída', async () => {
  for (const fila of publicas) {
    const res = await pedir(fila, {
      responder: () => {
        throw errorPg('42703');
      },
    });
    sinFuga(res, `${claveDe(fila)} (pública)`);
  }
});
