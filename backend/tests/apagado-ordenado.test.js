const test = require('node:test');
const assert = require('node:assert');

const pool = require('../src/config/db');
const { redisClient } = require('../src/config/redis');
const { apagadoOrdenado } = require('../server');

// H-25: cierre ordenado ante SIGTERM/SIGINT.
//
// Se prueba con dobles y no con senales de verdad: el proceso que corre las
// pruebas es el del runner, y mandarle un SIGTERM lo mataria. apagadoOrdenado
// recibe el servidor y acepta `log` y `salir` inyectados justamente para esto.

/** Servidor HTTP falso. Registra cuando se le cierra y en que orden. */
function fakeServidor(traza, { error = null, demora = 0 } = {}) {
  return {
    close(cb) {
      setTimeout(() => {
        traza.push('http');
        cb(error);
      }, demora);
    },
  };
}

/**
 * Sustituye pool.end y redisClient.quit por dobles que anotan su turno.
 * Devuelve el restaurador, igual que instalarFakeDb.
 */
function instalarDobles(traza, { redisAbierto = true, fallaPool = null } = {}) {
  const endReal = pool.end;
  const quitReal = redisClient.quit;
  const abiertoReal = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(redisClient) || {},
    'isOpen'
  );

  pool.end = async () => {
    traza.push('pool');
    if (fallaPool) throw fallaPool;
  };
  redisClient.quit = async () => {
    traza.push('redis');
  };
  Object.defineProperty(redisClient, 'isOpen', {
    get: () => redisAbierto,
    configurable: true,
  });

  return function restaurar() {
    pool.end = endReal;
    redisClient.quit = quitReal;
    delete redisClient.isOpen;
    if (abiertoReal) Object.defineProperty(redisClient, 'isOpen', abiertoReal);
  };
}

/** Recoge lo que apagadoOrdenado pasaria a process.exit, sin salir de verdad. */
function recogerSalida() {
  const codigos = [];
  return { codigos, salir: (codigo) => codigos.push(codigo) };
}

const silencio = () => {};

test('cierra en orden: primero el HTTP, luego Redis y el pool de ultimo', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza);
  const { codigos, salir } = recogerSalida();
  try {
    const alApagar = apagadoOrdenado(fakeServidor(traza), { log: silencio, salir });

    await alApagar('SIGTERM');

    // El HTTP primero para no cerrarle la base a una peticion en vuelo; el pool
    // de ultimo porque es el que puede tener transacciones a medias.
    assert.deepStrictEqual(traza, ['http', 'redis', 'pool']);
    assert.deepStrictEqual(codigos, [0]);
  } finally {
    restaurar();
  }
});

test('espera a que el servidor HTTP termine antes de tocar la base', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza);
  const { salir } = recogerSalida();
  try {
    // Con demora, un cierre que no esperara al callback dejaria 'http' al final.
    const alApagar = apagadoOrdenado(fakeServidor(traza, { demora: 30 }), {
      log: silencio,
      salir,
    });

    await alApagar('SIGTERM');

    assert.strictEqual(traza[0], 'http', 'las peticiones en vuelo terminan primero');
  } finally {
    restaurar();
  }
});

test('si Redis nunca se conecto, no se le llama a quit', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza, { redisAbierto: false });
  const { codigos, salir } = recogerSalida();
  try {
    const alApagar = apagadoOrdenado(fakeServidor(traza), { log: silencio, salir });

    await alApagar('SIGINT');

    // Se conecta de forma perezosa: en un proceso que no uso la cache, quit
    // sobre un cliente cerrado lanza.
    assert.deepStrictEqual(traza, ['http', 'pool']);
    assert.deepStrictEqual(codigos, [0]);
  } finally {
    restaurar();
  }
});

test('es idempotente: un Ctrl+C doble no cierra el pool dos veces', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza);
  const { codigos, salir } = recogerSalida();
  try {
    const alApagar = apagadoOrdenado(fakeServidor(traza), { log: silencio, salir });

    await Promise.all([alApagar('SIGINT'), alApagar('SIGINT'), alApagar('SIGTERM')]);

    assert.deepStrictEqual(traza, ['http', 'redis', 'pool'], 'una sola pasada');
    assert.deepStrictEqual(codigos, [0], 'una sola salida');
  } finally {
    restaurar();
  }
});

test('si algo falla al cerrar, sale con codigo 1 y no se queda colgado', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza, { fallaPool: new Error('el pool no responde') });
  const { codigos, salir } = recogerSalida();
  try {
    const alApagar = apagadoOrdenado(fakeServidor(traza), { log: silencio, salir });

    await alApagar('SIGTERM');

    assert.deepStrictEqual(codigos, [1]);
  } finally {
    restaurar();
  }
});

test('un error al cerrar el servidor HTTP tambien sale con 1', async () => {
  const traza = [];
  const restaurar = instalarDobles(traza);
  const { codigos, salir } = recogerSalida();
  try {
    const servidor = fakeServidor(traza, { error: new Error('no estaba escuchando') });
    const alApagar = apagadoOrdenado(servidor, { log: silencio, salir });

    await alApagar('SIGTERM');

    assert.deepStrictEqual(codigos, [1]);
    assert.ok(!traza.includes('pool'), 'no sigue cerrando si el primer paso fallo');
  } finally {
    restaurar();
  }
});

test('el temporizador de rendicion fuerza la salida si el cierre se cuelga', async () => {
  const traza = [];
  const endReal = pool.end;
  const { codigos, salir } = recogerSalida();
  const anterior = process.env.APAGADO_TIMEOUT_MS;
  try {
    process.env.APAGADO_TIMEOUT_MS = '40';
    // Un pool que nunca resuelve: es justo el caso que el timeout cubre.
    pool.end = () => new Promise(() => {});

    const alApagar = apagadoOrdenado(fakeServidor(traza), { log: silencio, salir });
    alApagar('SIGTERM');

    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.deepStrictEqual(codigos, [1], 'un apagado colgado es peor que uno brusco');
  } finally {
    pool.end = endReal;
    if (anterior === undefined) delete process.env.APAGADO_TIMEOUT_MS;
    else process.env.APAGADO_TIMEOUT_MS = anterior;
  }
});

test('el temporizador no mantiene vivo el proceso por si solo', () => {
  // Sin .unref(), un setTimeout de 10 s dejaria el event loop ocupado y
  // `node --test` reportaria pruebas canceladas al no poder terminar.
  const fuente = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'server.js'),
    'utf8'
  );
  assert.match(fuente, /rendirse\.unref\(\)/);
});

test('nodemon reinicia con SIGUSR2: el backend no la intercepta', () => {
  // Si apagaramos ordenadamente ante SIGUSR2, `npm run dev` dejaria de
  // reiniciar: cada guardado apagaria el backend en vez de recargarlo.
  //
  // No se comprueba sobre process.listeners porque `node --test` instala su
  // propio manejador de SIGUSR2; lo que se puede afirmar es que no sale de
  // aqui. Que importar la app no registre NADA lo cubre la prueba siguiente.
  const fuente = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'server.js'),
    'utf8'
  );
  assert.ok(!/process\.on\(\s*['"]SIGUSR2/.test(fuente), 'SIGUSR2 es de nodemon');
  assert.match(fuente, /process\.on\(\s*'SIGTERM'/, 'las que si se atienden');
  assert.match(fuente, /process\.on\(\s*'SIGINT'/);
});

test('importar la app no instala manejadores de senal', () => {
  // Se registran solo bajo require.main === module. Una prueba que importa
  // `app` con supertest no debe poder matar el proceso del runner ni cerrarle
  // el pool a los demas archivos.
  assert.deepStrictEqual(process.listeners('SIGTERM'), []);
  assert.deepStrictEqual(process.listeners('SIGINT'), []);
});
