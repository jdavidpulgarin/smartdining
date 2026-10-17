const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { tokenStaff } = require('./helpers/fake-db');
const { pedir } = require('./helpers/catalogo-rutas');
const app = require('../server');

// D-11: validación de los cuerpos, ruta por ruta.
//
// Nueve de los once controllers validan con zod, cada uno su esquema, y cada
// archivo de pruebas comprobaba los casos de SU ruta. Lo que no había era la
// comprobación transversal: que en TODA ruta con cuerpo un campo que falta, un
// tipo que no es y una clave de más se queden en la puerta, y —sobre todo— que
// la clave de más no llegue nunca a una sentencia.
//
// Lo último es lo que importa de verdad: zod DESCARTA las claves desconocidas
// en vez de rechazarlas (salvo en `PATCH /ingredientes/:id/disponible`, el
// único `.strict()` del backend). Descartar está bien, pero solo vale si lo que
// se le pasa al service es el resultado de zod y no `req.body`. Si alguien
// escribiera `{ ...req.body }`, la clave de más entraría en el INSERT y eso es
// una asignación masiva. Estas pruebas lo cierran.

const ADMIN = () => tokenStaff(1, 'admin');
const CAJERO = () => tokenStaff(4, 'cajero');
const COCINA = () => tokenStaff(7, 'cocina');

const MESA = { id_mesa: 5, numero: 5, capacidad: 4, ubicacion: 'Terraza', estado: 'disponible' };
const CATEGORIA = { id_categoria: 2, nombre: 'Entradas', activo: true };
const PLATO = { id_plato: 7, nombre: 'Arepa', precio: '12000.00', id_categoria: 2, disponible: true };
const PASO = { id_paso: 3, id_plato: 7, nombre: 'Punto', orden: 1, min_sel: 0, max_sel: 1, obligatorio: false };
const INGREDIENTE = { id_ingrediente: 11, id_paso: 3, nombre: 'Panceta', precio_extra: '0.00', disponible: true };
const PEDIDO = { id_pedido: 87, id_mesa: 5, estado: 'entregado', total: '56000.00' };

/**
 * Doble de base que contesta con filas plausibles a lo que piden estos
 * controllers.
 *
 * Hace falta porque varios validan DESPUÉS de leer la fila que van a tocar
 * (`PUT /categorias/:id` consulta y responde 404 si no existe, antes de mirar
 * el cuerpo) y porque los que crean algo formatean la fila devuelta. Con un
 * doble que responde sin filas, la ruta contesta 404 o revienta al formatear y
 * la prueba del cuerpo no llega a probar el cuerpo.
 *
 * No es complacencia con el código: lo que se quiere observar es qué hace el
 * esquema con un cuerpo malo, y para eso el resto del camino tiene que estar
 * despejado.
 */
function responderGenerico(sql) {
  if (sql.includes('FROM categorias') || sql.includes('INTO categorias') || sql.includes('UPDATE categorias')) {
    return { rows: [CATEGORIA] };
  }
  if (sql.includes('FROM platos') || sql.includes('INTO platos') || sql.includes('UPDATE platos')) {
    return { rows: [PLATO] };
  }
  if (sql.includes('pasos_constructor')) return { rows: [PASO] };
  if (sql.includes('ingredientes')) return { rows: [INGREDIENTE] };
  if (sql.includes('FROM mesas') || sql.includes('INTO mesas') || sql.includes('UPDATE mesas')) {
    return { rows: [MESA] };
  }
  if (sql.includes('pedidos')) return { rows: [PEDIDO] };
  if (sql.includes('transacciones')) {
    return { rows: [{ id_transaccion: 1, id_pedido: 87, monto: '10000.00', estado_transaccion: 'completada' }] };
  }
  return { rows: [] };
}

/**
 * Rutas con cuerpo.
 *
 * `valido` es un cuerpo que pasa el esquema. `obligatorios` son los campos sin
 * los que el esquema debe rechazar; se dejan fuera los que tienen `.default()`
 * o `.optional()`, porque omitirlos es legítimo. `estricta` marca el esquema
 * que además rechaza las claves de más en vez de descartarlas.
 */
const RUTAS = [
  {
    nombre: 'POST /api/auth/register',
    metodo: 'POST',
    url: '/api/auth/register',
    token: ADMIN,
    valido: { nombre: 'Ana Ríos', email: 'ana@mail.com', password: 'secreta123', rol: 'mesero' },
    obligatorios: ['nombre', 'email', 'password', 'rol'],
  },
  {
    nombre: 'POST /api/auth/login',
    metodo: 'POST',
    url: '/api/auth/login',
    valido: { email: 'ana@mail.com', password: 'secreta123' },
    obligatorios: ['email', 'password'],
  },
  {
    nombre: 'POST /api/categorias',
    metodo: 'POST',
    url: '/api/categorias',
    token: ADMIN,
    valido: { nombre: 'Postres' },
    obligatorios: ['nombre'],
  },
  {
    nombre: 'PUT /api/categorias/:id',
    metodo: 'PUT',
    url: '/api/categorias/2',
    token: ADMIN,
    valido: { nombre: 'Postres' },
    // categoriaSchema.partial(): el panel manda solo los campos que tocó.
    obligatorios: [],
  },
  {
    nombre: 'POST /api/platos',
    metodo: 'POST',
    url: '/api/platos',
    token: ADMIN,
    valido: { nombre: 'Arepa', precio: 12000, id_categoria: 1 },
    obligatorios: ['nombre', 'precio', 'id_categoria'],
  },
  {
    nombre: 'PUT /api/platos/:id',
    metodo: 'PUT',
    url: '/api/platos/7',
    token: ADMIN,
    valido: { nombre: 'Arepa', precio: 12000, id_categoria: 1 },
    // platoSchema.partial(), igual que la de categorías.
    obligatorios: [],
  },
  {
    nombre: 'POST /api/platos/:id/pasos',
    metodo: 'POST',
    url: '/api/platos/7/pasos',
    token: ADMIN,
    // min_sel, max_sel y obligatorio tienen .default(): no son obligatorios.
    valido: { nombre: 'Punto de la carne', orden: 1 },
    obligatorios: ['nombre', 'orden'],
  },
  {
    nombre: 'POST /api/pasos/:id/ingredientes',
    metodo: 'POST',
    url: '/api/pasos/3/ingredientes',
    token: ADMIN,
    valido: { nombre: 'Panceta Crujiente' },
    obligatorios: ['nombre'],
  },
  {
    nombre: 'PATCH /api/ingredientes/:id/disponible',
    metodo: 'PATCH',
    url: '/api/ingredientes/11/disponible',
    token: ADMIN,
    valido: { disponible: false },
    obligatorios: ['disponible'],
    estricta: true,
  },
  {
    nombre: 'POST /api/mesas',
    metodo: 'POST',
    url: '/api/mesas',
    token: ADMIN,
    valido: { numero: 9 },
    obligatorios: ['numero'],
  },
  {
    nombre: 'PATCH /api/mesas/:id/estado',
    metodo: 'PATCH',
    url: '/api/mesas/5/estado',
    token: ADMIN,
    valido: { estado: 'disponible' },
    // mesaSchema.partial(): `estado` llega como opcional.
    obligatorios: [],
  },
  {
    nombre: 'POST /api/transacciones',
    metodo: 'POST',
    url: '/api/transacciones',
    token: CAJERO,
    valido: { id_pedido: 87, monto: 10000, metodo_pago: 'efectivo' },
    obligatorios: ['id_pedido', 'monto', 'metodo_pago'],
  },
  {
    // No usa zod: valida a mano contra una lista blanca. Entra igual, porque lo
    // que se prueba es el contrato, no cómo está escrito.
    nombre: 'PATCH /api/kds/comandas/:id/estado',
    metodo: 'PATCH',
    url: '/api/kds/comandas/87/estado',
    token: COCINA,
    valido: { estado: 'listo' },
    obligatorios: ['estado'],
  },
  {
    nombre: 'PATCH /api/pedidos/:id/estado',
    metodo: 'PATCH',
    url: '/api/pedidos/87/estado',
    token: ADMIN,
    valido: { estado: 'listo' },
    obligatorios: ['estado'],
  },
];

/**
 * Valores con los que se sustituye un campo para comprobar que el esquema mira
 * el tipo.
 *
 * Se eligen SEGÚN el tipo que el campo tiene de verdad: un texto cualquiera es
 * un valor legítimo para un `z.string()` y `true` lo es para un `z.boolean()`,
 * así que esperar un 400 ahí sería esperar que el esquema rechace algo
 * correcto. Lo que se manda es siempre de otro tipo que el bueno.
 */
function tiposAjenosPara(valorBueno) {
  const candidatos = [
    { nombre: 'un objeto', valor: { a: 1 } },
    { nombre: 'un array', valor: [1, 2] },
    { nombre: 'null', valor: null },
    { nombre: 'un booleano', valor: true },
    { nombre: 'un texto', valor: 'texto-cualquiera' },
    { nombre: 'un número', valor: 12345 },
  ];

  const tipoBueno = valorBueno === null ? 'null' : typeof valorBueno;
  return candidatos.filter((c) => {
    const tipo = c.valor === null ? 'null' : typeof c.valor;
    // Un array es typeof 'object', pero para un campo que espera objeto sigue
    // siendo otra cosa; lo que se descarta es el mismo tipo exacto.
    if (Array.isArray(c.valor)) return !Array.isArray(valorBueno);
    return tipo !== tipoBueno;
  });
}

const credenciales = (ruta) => (ruta.token ? { token: ruta.token() } : {});

/** Lanza la petición de la ruta con el cuerpo dado, con los dobles puestos. */
const enviar = (ruta, cuerpo, extra = {}) =>
  pedir(
    { metodo: ruta.metodo, url: ruta.url },
    { ...credenciales(ruta), cuerpo, responder: responderGenerico, ...extra }
  );

// ---------------------------------------------------------------------------
// Campos obligatorios y tipos
// ---------------------------------------------------------------------------

for (const ruta of RUTAS) {
  test(`d-11: ${ruta.nombre} rechaza un cuerpo sin los campos obligatorios`, async () => {
    for (const campo of ruta.obligatorios) {
      const cuerpo = { ...ruta.valido };
      delete cuerpo[campo];

      const res = await enviar(ruta, cuerpo);

      assert.strictEqual(res.status, 400, `sin ${campo} respondió ${res.status}`);
    }
  });

  test(`d-11: ${ruta.nombre} rechaza los tipos que no son`, async () => {
    // Sobre TODOS los campos del cuerpo bueno, no solo los obligatorios: en un
    // esquema parcial el campo es opcional pero su tipo se sigue mirando.
    for (const [campo, valorBueno] of Object.entries(ruta.valido)) {
      for (const tipo of tiposAjenosPara(valorBueno)) {
        const res = await enviar(ruta, { ...ruta.valido, [campo]: tipo.valor });

        assert.strictEqual(
          res.status,
          400,
          `${campo} con ${tipo.nombre} respondió ${res.status}`
        );
      }
    }
  });

  test(`d-11: ${ruta.nombre} con un cuerpo vacío no revienta`, async () => {
    const res = await enviar(ruta, {});

    if (ruta.obligatorios.length > 0) {
      assert.strictEqual(res.status, 400, `respondió ${res.status}`);
    } else {
      // Esquema parcial a propósito (el panel manda solo lo que tocó): un
      // cuerpo vacío no es un error de validación. Lo que no puede es ser un
      // 500.
      assert.ok(res.status < 500, `respondió ${res.status}`);
    }
  });

  test(`d-11: ${ruta.nombre} rechaza un array en vez de un objeto`, async () => {
    const res = await enviar(ruta, [ruta.valido]);

    assert.strictEqual(res.status, 400, `respondió ${res.status}`);
  });

  test(`d-11: ${ruta.nombre} no deja pasar una clave de más a la base`, async () => {
    // La clave inventada no puede acabar en ninguna sentencia ni en ningún
    // parámetro. Da igual que el esquema la descarte (lo normal) o la rechace
    // con 400 (el .strict() de disponibilidad): lo que no vale es que viaje.
    const COLADO = 'campo_colado_por_el_atacante';
    const VALOR = 'valor-colado-1234';

    const res = await enviar(
      ruta,
      { ...ruta.valido, [COLADO]: VALOR, id_usuario: 999, rol: 'admin', activo: true },
      {
        espia: (db) => {
          for (const { sql, params } of db.ejecutadas) {
            assert.ok(!sql.includes(COLADO), `${ruta.nombre}: la clave de más entró en el SQL`);
            assert.ok(
              !(params || []).some((p) => String(p) === VALOR),
              `${ruta.nombre}: el valor de más viajó como parámetro`
            );
          }
        },
      }
    );

    if (ruta.estricta) {
      assert.strictEqual(res.status, 400, 'el esquema estricto debería rechazarla');
    }
  });

  test(`d-11: ${ruta.nombre} acepta su cuerpo bueno`, async () => {
    // Control: si los 400 de arriba vinieran de otra causa, esto lo delata.
    const res = await enviar(ruta, ruta.valido);

    assert.notStrictEqual(res.status, 400, `el cuerpo bueno recibió 400: ${JSON.stringify(res.body)}`);
  });
}

// ---------------------------------------------------------------------------
// Prototype pollution
// ---------------------------------------------------------------------------

/** Claves con las que se intenta tocar el prototipo. */
const CLAVES_DEL_PROTOTIPO = ['__proto__', 'constructor', 'prototype'];

test('d-11: ninguna clave del prototipo ensucia Object.prototype', async () => {
  for (const ruta of RUTAS) {
    for (const clave of CLAVES_DEL_PROTOTIPO) {
      // Se manda como texto crudo: con un objeto de JavaScript, '__proto__' no
      // sobrevive a JSON.stringify de la forma que interesa.
      const crudo = JSON.stringify({
        ...ruta.valido,
        [clave]: { contaminado: 'si', isAdmin: true },
      });

      const res = await enviar(ruta, JSON.parse(crudo));

      assert.ok(res.status < 500, `${ruta.nombre} con ${clave} respondió ${res.status}`);
      assert.strictEqual({}.contaminado, undefined, `${clave} ensució Object.prototype`);
      assert.strictEqual({}.isAdmin, undefined, `${clave} ensució Object.prototype`);
    }
  }
});

test('d-11: una clave del prototipo no se convierte en permiso', async () => {
  // El riesgo concreto: que `{ "__proto__": { "rol": "admin" } }` hiciera que
  // un mesero pasara por admin en el siguiente `req.user.rol`.
  const res = await request(app)
    .post('/api/categorias')
    .set('Authorization', `Bearer ${tokenStaff(3, 'mesero')}`)
    .set('Content-Type', 'application/json')
    .send('{"nombre":"Postres","__proto__":{"rol":"admin"}}');

  assert.strictEqual(res.status, 403);
  assert.strictEqual({}.rol, undefined);
});

test('d-11: la tabla de traducción de errores no se confunde con __proto__', async () => {
  // errores.middleware.js usa un Map justamente para esto. Un `code` que sea
  // '__proto__' o 'constructor' no puede encontrar nada heredado y tiene que
  // salir por el 500 genérico.
  const { traduccionDeSqlstate } = require('../src/middleware/errores.middleware');

  for (const clave of [...CLAVES_DEL_PROTOTIPO, 'toString', 'valueOf']) {
    assert.strictEqual(traduccionDeSqlstate(clave), null, `${clave} encontró una traducción`);
  }
});

test('d-11: Object.prototype sigue limpio al final de la batería', () => {
  assert.deepStrictEqual(Object.keys({}), []);
  assert.strictEqual({}.contaminado, undefined);
  assert.strictEqual({}.isAdmin, undefined);
  assert.strictEqual({}.rol, undefined);
});
