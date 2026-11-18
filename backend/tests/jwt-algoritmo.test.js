const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { instalarFakeDb, tokenStaff } = require('./helpers/fake-db');
const { ALGORITMO_JWT } = require('../src/middleware/auth.middleware');
const app = require('../server');

// R2: `jwt.verify` no fijaba el algoritmo.
//
// Antes de este arreglo, `jwt.verify(token, JWT_SECRET)` sin `algorithms`
// aceptaba cualquier algoritmo de la familia HMAC: un token firmado con HS384 o
// HS512 y el MISMO secreto pasaba el control. No era escalable a un ataque —hay
// que tener el secreto, y con el secreto ya se puede firmar un HS256— pero
// dejaba abierta la confusión de algoritmo para el día en que se introduzca una
// clave asimétrica: un `alg: RS256` verificado con la clave pública usada como
// secreto HMAC.
//
// El socket-server ya lo hacía bien (src/auth.js pasa { algorithms: ['HS256'] }).
// Este backend era el único de los dos que no.

/** Rutas de tres familias, para que el rechazo no dependa del controller. */
const RUTAS = ['/api/reportes?rango=hoy', '/api/kds/comandas', '/api/pedidos/activos'];

const PAYLOAD = { id_usuario: 1, rol: 'admin' };
const b64 = (objeto) => Buffer.from(JSON.stringify(objeto)).toString('base64url');

/** Algoritmos HMAC que NO son el del backend, firmados con el secreto bueno. */
const ALGORITMOS_AJENOS = ['HS384', 'HS512'];

test('d-11: el backend declara HS256 como su único algoritmo', () => {
  assert.strictEqual(ALGORITMO_JWT, 'HS256');
});

for (const algoritmo of ALGORITMOS_AJENOS) {
  for (const ruta of RUTAS) {
    test(`d-11: un token ${algoritmo} con el secreto bueno se rechaza en ${ruta}`, async () => {
      // Lo importante de este caso: el secreto es el CORRECTO. Lo único
      // distinto es el algoritmo, así que si la ruta contesta algo que no sea
      // 401 es porque no se está comprobando.
      const token = jwt.sign(PAYLOAD, process.env.JWT_SECRET, {
        algorithm: algoritmo,
        expiresIn: '1h',
      });

      const res = await request(app).get(ruta).set('Authorization', `Bearer ${token}`);

      assert.strictEqual(res.status, 401, `${algoritmo} entró con ${res.status}`);
      assert.strictEqual(res.body.error, 'Token inválido o expirado');
    });
  }
}

for (const ruta of RUTAS) {
  test(`d-11: un token alg none se rechaza en ${ruta}`, async () => {
    // Ya se rechazaba antes del arreglo (jsonwebtoken no acepta `none` cuando
    // se le pasa un secreto), pero es el caso que todo el mundo busca al leer
    // esto, así que queda escrito.
    const sinFirma = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(PAYLOAD)}.`;

    const res = await request(app).get(ruta).set('Authorization', `Bearer ${sinFirma}`);

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, 'Token inválido o expirado');
  });
}

test('d-11: un token HS256 válido sigue pasando', async () => {
  // Control imprescindible: fijar el algoritmo no puede haber cerrado la puerta
  // a los tokens que el propio backend emite.
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

test('d-11: el token que firma el login es HS256 y lo acepta el middleware', async () => {
  // De punta a punta: se pide un login de verdad, se mira la cabecera del JWT
  // que sale y se comprueba que ese token abre una ruta. Si alguien cambiara el
  // algoritmo al firmar y no al verificar (o al revés), esto se rompe.
  const bcrypt = require('bcrypt');
  const hash = await bcrypt.hash('secreta123', 10);
  const USUARIO = {
    id_usuario: 1,
    nombre: 'Jarrison',
    email: 'admin@smartdining.com',
    password_hash: hash,
    rol: 'admin',
    activo: true,
  };

  const db = instalarFakeDb((sql) =>
    sql.includes('FROM usuarios WHERE email') ? { rows: [USUARIO] } : { rows: [] }
  );
  try {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: USUARIO.email, password: 'secreta123' });

    assert.strictEqual(login.status, 200);
    assert.ok(login.body.token, 'el login no devolvió token');

    const cabecera = JSON.parse(
      Buffer.from(login.body.token.split('.')[0], 'base64url').toString('utf8')
    );
    assert.strictEqual(cabecera.alg, ALGORITMO_JWT);

    const conEseToken = await request(app)
      .get('/api/pedidos/activos')
      .set('Authorization', `Bearer ${login.body.token}`);

    assert.notStrictEqual(conEseToken.status, 401, 'el token recién emitido no fue aceptado');
  } finally {
    db.restaurar();
  }
});

test('d-11: la sesión del comensal también se firma con HS256', async () => {
  // El otro jwt.sign del backend: el de POST /mesas/qr/:token/sesion. Se mira
  // la cabecera del token sin pasar por la ruta (que necesita el socket-server
  // para validar el QR), firmando con la misma opción que usa el controller.
  const token = jwt.sign({ id_mesa: 5, sid: 'x', rol: 'comensal' }, process.env.JWT_SECRET, {
    algorithm: ALGORITMO_JWT,
    expiresIn: '3h',
  });

  const cabecera = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));

  assert.strictEqual(cabecera.alg, 'HS256');
  assert.doesNotThrow(() =>
    jwt.verify(token, process.env.JWT_SECRET, { algorithms: [ALGORITMO_JWT] })
  );
});

test('d-11: ningún jwt.sign ni jwt.verify de src/ se queda sin algoritmo', () => {
  // Complemento estático: una ruta futura que firme o verifique por su cuenta
  // no tiene por qué pasar por las pruebas de arriba. Esto la ve igual.
  const fs = require('node:fs');
  const path = require('node:path');

  const raiz = path.join(__dirname, '..', 'src');
  const archivos = [];
  (function recorrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.endsWith('.js')) archivos.push(completo);
    }
  })(raiz);

  const sinAlgoritmo = [];
  for (const archivo of archivos) {
    const texto = fs.readFileSync(archivo, 'utf8');
    // Se mira la llamada completa, que ocupa varias líneas en los tres sitios.
    for (const coincidencia of texto.matchAll(/jwt\.(sign|verify)\s*\(/g)) {
      const desde = coincidencia.index;
      const trozo = texto.slice(desde, desde + 400);
      const cierre = trozo.indexOf(');');
      const llamada = cierre === -1 ? trozo : trozo.slice(0, cierre);
      const declara = llamada.includes('algorithm: ') || llamada.includes('algorithms: ');
      if (!declara) {
        sinAlgoritmo.push(`${path.relative(raiz, archivo)}: ${llamada.split('\n')[0].trim()}`);
      }
    }
  }

  assert.deepStrictEqual(
    sinAlgoritmo,
    [],
    'Hay llamadas a jwt.sign/verify sin algoritmo declarado:\n' + sinAlgoritmo.join('\n')
  );
});
