const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const app = require('../server');
const {
  MENSAJE_CUENTA_INACTIVA,
  MENSAJE_SESION_CERRADA,
} = require('../src/middleware/auth.middleware');

// D-11: el portón de las 35 rutas protegidas.
//
// Hasta ahora ninguna prueba comprobaba qué hace `requireAuth` con un token que
// NO sirve: se probaba el rol equivocado (403) y la cuenta desactivada (401 de
// H-09), pero nunca la verificación de la firma. Un fallo ahí no da un 403: da
// un 200 a quien se fabricó el token, y es el único camino de entrada de todas
// las rutas con JWT.
//
// Cada caso se prueba contra TRES rutas de familias distintas, para que el
// rechazo no dependa del controller que haya detrás:
//   - /api/reportes          (solo admin)
//   - /api/kds/comandas      (cocina y admin)
//   - /api/pedidos/activos   (admin, cajero, mesero)
const RUTAS = ['/api/reportes?rango=hoy', '/api/kds/comandas', '/api/pedidos/activos'];

const SECRETO_AJENO = 'otro-secreto-completamente-distinto-y-largo';
const PAYLOAD_STAFF = { id_usuario: 1, rol: 'admin' };

/** Trozo de un JWT codificado como lo hace la especificación: base64url. */
const b64 = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');

/**
 * Cabeceras que NO deben abrir ninguna ruta.
 *
 * `cabecera` es el valor literal de `Authorization`, para poder probar también
 * las formas que no llegan a `jwt.verify` (sin el prefijo `Bearer`, vacías).
 */
const CABECERAS_INVALIDAS = [
  {
    nombre: 'sin cabecera Authorization',
    cabecera: null,
    mensaje: 'Token no proporcionado',
  },
  {
    nombre: 'cabecera vacía',
    cabecera: '',
    mensaje: 'Token no proporcionado',
  },
  {
    nombre: 'sin el prefijo Bearer',
    cabecera: () => jwt.sign(PAYLOAD_STAFF, process.env.JWT_SECRET),
    mensaje: 'Token no proporcionado',
  },
  {
    nombre: 'prefijo en minúscula (bearer)',
    cabecera: () => `bearer ${jwt.sign(PAYLOAD_STAFF, process.env.JWT_SECRET)}`,
    mensaje: 'Token no proporcionado',
  },
  {
    // El espacio final se recorta al enviar la cabecera, así que llega como
    // 'Bearer' pelado y no pasa el startsWith('Bearer '). Sigue siendo 401,
    // solo cae en la primera rama en vez de en jwt.verify.
    nombre: 'Bearer sin token',
    cabecera: 'Bearer ',
    mensaje: 'Token no proporcionado',
  },
  {
    // Dos puntos y nada entre ellos: tiene la forma de un JWT y llega a
    // jwt.verify, que es la rama que interesa cubrir aquí.
    nombre: 'JWT con los tres trozos vacíos',
    cabecera: 'Bearer ..',
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'Basic en vez de Bearer',
    cabecera: 'Basic YWRtaW46YWRtaW4=',
    mensaje: 'Token no proporcionado',
  },
  {
    nombre: 'token que no es un JWT',
    cabecera: 'Bearer esto-no-es-un-jwt',
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'JWT con tres trozos pero basura dentro',
    cabecera: 'Bearer esto.no.es',
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'firmado con otro secreto',
    cabecera: () => `Bearer ${jwt.sign(PAYLOAD_STAFF, SECRETO_AJENO)}`,
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'expirado hace una hora',
    cabecera: () => `Bearer ${jwt.sign(PAYLOAD_STAFF, process.env.JWT_SECRET, { expiresIn: '-1h' })}`,
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'alg none sin firma',
    cabecera: () => `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64(PAYLOAD_STAFF)}.`,
    mensaje: 'Token inválido o expirado',
  },
  {
    nombre: 'alg none con una firma inventada',
    cabecera: () => `Bearer ${b64({ alg: 'none', typ: 'JWT' })}.${b64(PAYLOAD_STAFF)}.firma`,
    mensaje: 'Token inválido o expirado',
  },
];

/** Resuelve la cabecera del caso (algunas se firman al vuelo). */
const valorDeCabecera = (caso) =>
  typeof caso.cabecera === 'function' ? caso.cabecera() : caso.cabecera;

for (const caso of CABECERAS_INVALIDAS) {
  for (const ruta of RUTAS) {
    test(`d-11: ${caso.nombre} -> 401 en ${ruta}`, async () => {
      // Sin doble de base a propósito: un token que no sirve debe rebotar ANTES
      // de que se consulte nada. Si alguna de estas peticiones llegara a la
      // base, en un entorno sin PostgreSQL daría 500 y la prueba lo diría.
      const peticion = request(app).get(ruta);
      const valor = valorDeCabecera(caso);
      if (valor !== null) peticion.set('Authorization', valor);

      const res = await peticion;

      assert.strictEqual(res.status, 401, `${ruta} respondió ${res.status}`);
      assert.strictEqual(res.body.error, caso.mensaje);
    });
  }
}

test('d-11: un payload manipulado invalida la firma', async () => {
  // Cambiar el rol a mano es el ataque evidente: se toma un token de cocina y
  // se le pone rol admin. La firma cubre la cabecera y el payload, así que el
  // token deja de validar; esto lo deja fijado.
  const original = jwt.sign({ id_usuario: 7, rol: 'cocina' }, process.env.JWT_SECRET);
  const [cabecera, , firma] = original.split('.');
  const manipulado = `${cabecera}.${b64({ id_usuario: 7, rol: 'admin' })}.${firma}`;

  const res = await request(app)
    .get('/api/reportes?rango=hoy')
    .set('Authorization', `Bearer ${manipulado}`);

  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error, 'Token inválido o expirado');
});

test('d-11: un JWT bien firmado pero sin rol no abre ninguna ruta', async () => {
  // No es un 401: la firma es buena, así que `requireAuth` lo deja pasar y es
  // `requireRole` quien lo para. Lo que importa es que NO entre.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const sinRol = jwt.sign({ id_usuario: 4 }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/reportes?rango=hoy')
      .set('Authorization', `Bearer ${sinRol}`);

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});

test('d-11: un rol inventado tampoco abre ninguna ruta', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/reportes?rango=hoy')
      .set('Authorization', `Bearer ${tokenStaff(9, 'superadmin')}`);

    assert.strictEqual(res.status, 403);
  } finally {
    db.restaurar();
  }
});

test('d-11: el 401 del token no se confunde con los otros dos 401 del middleware', () => {
  // `requireAuth` responde 401 por tres motivos distintos y conviene que sigan
  // siendo distinguibles en el log y en el cliente: token inválido, cuenta
  // desactivada (H-09) y sesión de mesa cerrada.
  assert.notStrictEqual('Token inválido o expirado', MENSAJE_CUENTA_INACTIVA);
  assert.notStrictEqual('Token inválido o expirado', MENSAJE_SESION_CERRADA);
  assert.notStrictEqual(MENSAJE_CUENTA_INACTIVA, MENSAJE_SESION_CERRADA);
});

test('d-11: con un token bueno la misma ruta SÍ responde', async () => {
  // El control de la batería: si todo lo anterior diera 401 por un motivo
  // ajeno al token (una ruta mal escrita, por ejemplo), esta prueba lo delata.
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const res = await request(app)
      .get('/api/pedidos/activos')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);

    assert.strictEqual(res.status, 200);
  } finally {
    db.restaurar();
  }
});
