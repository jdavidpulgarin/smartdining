const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { instalarFakeDb } = require('./helpers/fake-db');
const { COSTO_BCRYPT, MENSAJE_CREDENCIALES } = require('../src/controllers/auth.controller');
const app = require('../server');

// H-12: enumeracion de usuarios en POST /api/auth/login.
//
// La auditoria midio que un email inexistente respondia en ~3 ms y uno
// existente en ~70 ms, porque solo el segundo llegaba a bcrypt. Con esa
// diferencia se puede recorrer una lista de correos y quedarse con los que si
// tienen cuenta, sin acertar ni una contraseña. Ademas "Usuario inactivo"
// confirmaba la cuenta ANTES de validar la contraseña, y con otro codigo (403).
//
// Aqui NO se miden milisegundos: un umbral en ms es fragil (el CI comparte CPU)
// y mediria la maquina, no el codigo. Lo que se comprueba es la causa: que
// bcrypt.compare se invoque en los TRES casos y siempre con un hash del mismo
// costo, que es lo que hace que los tiempos sean comparables.

const RUTA = '/api/auth/login';
const EMAIL = 'ana@smartdining.com';
const PASSWORD = 'secreta123';

// Hash real de PASSWORD, con el mismo costo que register y que el seed.
const HASH_REAL = bcrypt.hashSync(PASSWORD, COSTO_BCRYPT);

const USUARIO = {
  id_usuario: 3,
  nombre: 'Ana Rios',
  email: EMAIL,
  rol: 'cajero',
  password_hash: HASH_REAL,
  activo: true,
};

/**
 * Doble de la base para el login.
 *
 * @param {object|null} usuario Fila de usuarios que devuelve la busqueda por
 *        email, o null para simular que ese email no existe.
 */
function dbLogin(usuario) {
  return (sql) => {
    // Alias no hace falta aqui, pero si ser especifico: la consulta del
    // middleware (H-09) es por id_usuario y la contesta el propio fake-db.
    if (sql.includes('FROM usuarios WHERE email')) {
      return { rows: usuario ? [usuario] : [] };
    }
    return { rows: [] };
  };
}

/** Envuelve bcrypt.compare para anotar con que se llamo, sin cambiar su logica. */
function espiarCompare() {
  const original = bcrypt.compare;
  const llamadas = [];
  bcrypt.compare = (dato, hash, ...resto) => {
    llamadas.push({ dato, hash });
    return original.call(bcrypt, dato, hash, ...resto);
  };
  return {
    llamadas,
    restaurar() {
      bcrypt.compare = original;
    },
  };
}

const entrar = (cuerpo) => request(app).post(RUTA).send(cuerpo);

// Los tres casos que antes se distinguian entre si.
const CASOS = [
  {
    nombre: 'el email no existe',
    usuario: null,
    cuerpo: { email: 'nadie@smartdining.com', password: PASSWORD },
  },
  {
    nombre: 'la cuenta esta inactiva (con la contraseña CORRECTA)',
    usuario: { ...USUARIO, activo: false },
    cuerpo: { email: EMAIL, password: PASSWORD },
  },
  {
    nombre: 'la contraseña es incorrecta',
    usuario: USUARIO,
    cuerpo: { email: EMAIL, password: 'otra-cosa-999' },
  },
];

for (const caso of CASOS) {
  test(`h-12: ${caso.nombre} -> 401 con el mensaje generico`, async () => {
    const db = instalarFakeDb(dbLogin(caso.usuario));
    try {
      const res = await entrar(caso.cuerpo);

      assert.strictEqual(res.status, 401, 'un solo codigo para los tres casos');
      assert.deepStrictEqual(
        res.body,
        { error: MENSAJE_CREDENCIALES },
        'un solo cuerpo: nada que permita distinguir el caso'
      );
      assert.strictEqual(res.body.token, undefined, 'y sin token, obviamente');
    } finally {
      db.restaurar();
    }
  });

  test(`h-12: ${caso.nombre} -> pasa igual por bcrypt, al mismo costo`, async () => {
    const db = instalarFakeDb(dbLogin(caso.usuario));
    const espia = espiarCompare();
    try {
      await entrar(caso.cuerpo);

      assert.strictEqual(espia.llamadas.length, 1, 'se compara una vez, ni cero ni dos');
      // El costo va dentro del propio hash ($2<variante>$<costo>$...). Que sea
      // el mismo en los tres casos es lo que iguala el tiempo de respuesta; es
      // la causa del hallazgo, y se comprueba sin cronometro.
      const { hash } = espia.llamadas[0];
      assert.match(
        hash,
        new RegExp(`^\\$2[aby]?\\$${String(COSTO_BCRYPT).padStart(2, '0')}\\$`),
        `el hash comparado debe costar ${COSTO_BCRYPT}`
      );
    } finally {
      espia.restaurar();
      db.restaurar();
    }
  });
}

test('h-12: los tres casos responden exactamente lo mismo', async () => {
  const respuestas = [];
  for (const caso of CASOS) {
    const db = instalarFakeDb(dbLogin(caso.usuario));
    try {
      const res = await entrar(caso.cuerpo);
      respuestas.push({ status: res.status, cuerpo: res.body });
    } finally {
      db.restaurar();
    }
  }

  assert.deepStrictEqual(respuestas[1], respuestas[0], 'inactivo == inexistente');
  assert.deepStrictEqual(respuestas[2], respuestas[0], 'password mala == inexistente');
});

test('h-12: ya no hay un 403 ni un mensaje de cuenta inactiva en el login', async () => {
  const db = instalarFakeDb(dbLogin({ ...USUARIO, activo: false }));
  try {
    const res = await entrar({ email: EMAIL, password: PASSWORD });

    assert.notStrictEqual(res.status, 403, 'el 403 delataba que la cuenta existe');
    assert.ok(
      !/inactiv|desactivad/i.test(JSON.stringify(res.body)),
      'ni el cuerpo lo puede insinuar'
    );
  } finally {
    db.restaurar();
  }
});

test('h-12: sin usuario se rechaza aunque la comparacion diera true', async () => {
  const db = instalarFakeDb(dbLogin(null));
  const original = bcrypt.compare;
  // El hash ficticio sale de una cadena aleatoria, asi que en la practica no
  // hay contraseña que lo acierte. Se fuerza el caso imposible para fijar la
  // regla: la decision NO se apoya en el resultado de esa comparacion.
  bcrypt.compare = async () => true;
  try {
    const res = await entrar({ email: 'nadie@smartdining.com', password: PASSWORD });

    assert.strictEqual(res.status, 401, 'sin usuario no se entra, pase lo que pase');
    assert.strictEqual(res.body.token, undefined);
  } finally {
    bcrypt.compare = original;
    db.restaurar();
  }
});

test('h-12: el login correcto sigue funcionando', async () => {
  const db = instalarFakeDb(dbLogin(USUARIO));
  try {
    const res = await entrar({ email: EMAIL, password: PASSWORD });

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token, 'devuelve el JWT');
    assert.strictEqual(res.body.usuario.email, EMAIL);
    assert.strictEqual(res.body.usuario.rol, 'cajero');
    assert.strictEqual(res.body.usuario.password_hash, undefined, 'el hash nunca sale en la respuesta');
  } finally {
    db.restaurar();
  }
});

test('h-12: el hash ficticio se calcula una vez, no en cada login', async () => {
  // Si se hashease por peticion, un login contra un email inexistente costaria
  // dos bcrypt (hash + compare) y tardaria el DOBLE que uno real: el canal de
  // tiempo volveria a abrirse, al reves.
  const original = bcrypt.hash;
  const originalSync = bcrypt.hashSync;
  let hasheos = 0;
  bcrypt.hash = (...a) => { hasheos += 1; return original.call(bcrypt, ...a); };
  bcrypt.hashSync = (...a) => { hasheos += 1; return originalSync.call(bcrypt, ...a); };
  const db = instalarFakeDb(dbLogin(null));
  try {
    await entrar({ email: 'nadie@smartdining.com', password: PASSWORD });
    assert.strictEqual(hasheos, 0, 'el login no hashea nada: el ficticio ya estaba hecho');
  } finally {
    bcrypt.hash = original;
    bcrypt.hashSync = originalSync;
    db.restaurar();
  }
});
