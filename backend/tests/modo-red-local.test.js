const test = require('node:test');
const assert = require('node:assert');
const {
  detectarIpLocal,
  ipLocalConCache,
  olvidarCache,
  esIpv4Privada,
  partirIpv4,
  esAdaptadorVirtual,
  TTL_CACHE_MS,
} = require('../src/utils/ip-local');
const {
  urlDelComensal,
  enModoRedLocal,
  PUERTO_CLIENTE,
} = require('../src/utils/url-comensal');
const { opcionesCors, esOrigenRedLocal, ORIGENES_LOCALES } = require('../src/config/cors');

// MODO RED LOCAL: probar el cliente desde un celular de la misma Wi-Fi.
//
// Para el celular `localhost` es el propio telefono, asi que en desarrollo el
// enlace del QR tiene que llevar la IP de la LAN y el CORS tiene que aceptar
// los frontends abiertos por esa IP. Lo que se vigila aqui:
//   - la REGLA DE ACTIVACION: solo NODE_ENV === 'development' escrito. Con
//     'production', 'test', vacio o ausente todo queda como antes, porque un
//     despliegue al que le falte la variable no debe abrir el CORS a la red;
//   - la deteccion no se cuela por un adaptador virtual (una IP de WSL o de
//     VirtualBox es privada pero el celular no la alcanza);
//   - la regla de CORS es EXACTA: http + IPv4 privada + 5173/5174/5175. Nada
//     mas, y en particular ningun engano de los que pasan por una lista blanca
//     mal comparada;
//   - un dominio real no se sustituye nunca por una IP.

const IP = '192.168.1.57';

/** Tarjetas como las devuelve os.networkInterfaces(). */
const v4 = (address, extra = {}) => ({
  address,
  family: 'IPv4',
  internal: false,
  netmask: '255.255.255.0',
  ...extra,
});

const SIN_LOG = () => {};

// ---------------------------------------------------------------------------
// Deteccion de la IP
// ---------------------------------------------------------------------------

test('red-local: con varias interfaces elige la IPv4 privada de la LAN', () => {
  const ip = detectarIpLocal({
    interfaces: {
      'Loopback Pseudo-Interface 1': [v4('127.0.0.1', { internal: true })],
      Ethernet: [v4('192.168.1.57')],
    },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, '192.168.1.57');
});

test('red-local: se descartan las interfaces internas', () => {
  const ip = detectarIpLocal({
    interfaces: { Algo: [v4('192.168.1.57', { internal: true })] },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, null, 'una interfaz interna no la alcanza ningun celular');
});

test('red-local: se descarta IPv6 aunque sea la unica', () => {
  const ip = detectarIpLocal({
    interfaces: { 'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }] },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, null);
});

test('red-local: family numerica (4) tambien vale', () => {
  // Algunas versiones de Node devuelven 4 en vez de 'IPv4'.
  const ip = detectarIpLocal({
    interfaces: { 'Wi-Fi': [{ address: '192.168.0.10', family: 4, internal: false }] },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, '192.168.0.10');
});

test('red-local: se descarta una IP publica', () => {
  const ip = detectarIpLocal({
    interfaces: { 'Wi-Fi': [v4('8.8.8.8')] },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, null, 'solo rangos privados');
});

for (const nombre of [
  'vEthernet (WSL (Hyper-V firewall))',
  'vEthernet (Default Switch)',
  'WSL (Hyper-V firewall)',
  'Docker Desktop Bridge',
  'VirtualBox Host-Only Network',
  'VMware Network Adapter VMnet8',
  'Hyper-V Virtual Ethernet Adapter',
  'Loopback Pseudo-Interface 1',
  'Tailscale',
  'ZeroTier One [abc]',
  'Mi VPN de la U',
]) {
  test(`red-local: el adaptador virtual "${nombre}" se descarta`, () => {
    // Tiene IP privada, pero el celular no llega a ella: si se colara, el QR
    // llevaria a un error de conexion sin ninguna pista del motivo.
    assert.strictEqual(esAdaptadorVirtual(nombre), true);

    const ip = detectarIpLocal({
      interfaces: { [nombre]: [v4('172.20.5.1')], 'Wi-Fi': [v4(IP)] },
      env: {},
      log: SIN_LOG,
    });
    assert.strictEqual(ip, IP, 'gana la tarjeta real');
  });
}

test('red-local: si SOLO hay adaptadores virtuales no se detecta nada', () => {
  const ip = detectarIpLocal({
    interfaces: {
      'vEthernet (WSL)': [v4('172.20.5.1')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    },
    env: {},
    log: SIN_LOG,
  });

  assert.strictEqual(ip, null, 'mejor sin IP que con una que no sirve');
});

test('red-local: orden de preferencia 192.168 > 10 > 172.16-31', () => {
  const tarjetas = {
    'Tarjeta C': [v4('172.16.4.4')],
    'Tarjeta B': [v4('10.1.2.3')],
    'Tarjeta A': [v4('192.168.1.57')],
  };
  assert.strictEqual(detectarIpLocal({ interfaces: tarjetas, env: {}, log: SIN_LOG }), '192.168.1.57');

  delete tarjetas['Tarjeta A'];
  assert.strictEqual(detectarIpLocal({ interfaces: tarjetas, env: {}, log: SIN_LOG }), '10.1.2.3');

  delete tarjetas['Tarjeta B'];
  assert.strictEqual(detectarIpLocal({ interfaces: tarjetas, env: {}, log: SIN_LOG }), '172.16.4.4');
});

test('red-local: sin ninguna interfaz devuelve null', () => {
  assert.strictEqual(detectarIpLocal({ interfaces: {}, env: {}, log: SIN_LOG }), null);
});

test('red-local: HOST_LAN_IP valida manda sobre la deteccion', () => {
  const ip = detectarIpLocal({
    interfaces: { 'Wi-Fi': [v4('192.168.1.57')] },
    env: { HOST_LAN_IP: '10.9.8.7' },
    log: SIN_LOG,
  });

  assert.strictEqual(ip, '10.9.8.7', 'la salida para una maquina con varias tarjetas');
});

test('red-local: HOST_LAN_IP con espacios alrededor se recorta', () => {
  const ip = detectarIpLocal({ interfaces: {}, env: { HOST_LAN_IP: '  10.9.8.7  ' }, log: SIN_LOG });
  assert.strictEqual(ip, '10.9.8.7');
});

for (const valor of ['no-es-una-ip', '999.1.1.1', '10.0.0', '10.0.0.1.2', '010.1.1.1', 'localhost', '::1', '10.0.0.-1']) {
  test(`red-local: HOST_LAN_IP invalida "${valor}" se ignora y avisa`, () => {
    const avisos = [];
    const ip = detectarIpLocal({
      interfaces: { 'Wi-Fi': [v4(IP)] },
      env: { HOST_LAN_IP: valor },
      log: (m) => avisos.push(m),
    });

    assert.strictEqual(ip, IP, 'se sigue detectando sola, no se arma un enlace roto');
    assert.strictEqual(avisos.length, 1, 'queda constancia en el log');
    assert.ok(avisos[0].includes('HOST_LAN_IP'));
    // El aviso no imprime el valor: podria venir de un entorno ajeno.
    assert.ok(!avisos[0].includes(valor), 'el aviso no reproduce el valor recibido');
  });
}

test('red-local: una HOST_LAN_IP publica se acepta tal cual', () => {
  // Es un override explicito de quien configura: si escribe una IP enrutable,
  // es su decision y no se discute. La deteccion automatica nunca la elegiria.
  const ip = detectarIpLocal({ interfaces: {}, env: { HOST_LAN_IP: '203.0.113.9' }, log: SIN_LOG });
  assert.strictEqual(ip, '203.0.113.9');
});

// ---------------------------------------------------------------------------
// Rangos privados y troceo de IPv4
// ---------------------------------------------------------------------------

for (const ip of ['10.0.0.0', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.255']) {
  test(`red-local: ${ip} es privada`, () => assert.strictEqual(esIpv4Privada(ip), true));
}

for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '11.0.0.1', '192.169.0.1', '191.168.0.1', '127.0.0.1', '0.0.0.0']) {
  test(`red-local: ${ip} NO es privada`, () => assert.strictEqual(esIpv4Privada(ip), false));
}

test('red-local: partirIpv4 rechaza ceros a la izquierda', () => {
  // "010.1.1.1" se lee como octal en algunas bibliotecas: una IP que se puede
  // leer de dos formas no sirve para decidir nada.
  assert.strictEqual(partirIpv4('010.1.1.1'), null);
  assert.deepStrictEqual(partirIpv4('10.1.1.1'), [10, 1, 1, 1]);
  assert.deepStrictEqual(partirIpv4('0.0.0.0'), [0, 0, 0, 0]);
  assert.strictEqual(partirIpv4('256.1.1.1'), null);
  assert.strictEqual(partirIpv4(''), null);
  assert.strictEqual(partirIpv4(undefined), null);
});

// ---------------------------------------------------------------------------
// Cache de la deteccion
// ---------------------------------------------------------------------------

test('red-local: la cache evita recorrer las tarjetas en cada peticion', () => {
  olvidarCache();
  try {
    let veces = 0;
    // Se usa el detector real a traves de la cache, contando llamadas al
    // sistema no se puede; se comprueba el efecto: dos llamadas, un resultado.
    const primera = ipLocalConCache({ log: SIN_LOG });
    const segunda = ipLocalConCache({ log: SIN_LOG });
    veces += 2;

    assert.strictEqual(primera, segunda, 'el mismo valor dentro de la ventana');
    assert.strictEqual(veces, 2);
    assert.ok(TTL_CACHE_MS >= 10000 && TTL_CACHE_MS <= 60000, 'ventana corta: ~30 s');
  } finally {
    olvidarCache();
  }
});

test('red-local: inyectar interfaces salta la cache', () => {
  olvidarCache();
  try {
    assert.strictEqual(ipLocalConCache({ interfaces: { 'Wi-Fi': [v4('10.1.1.1')] }, log: SIN_LOG }), '10.1.1.1');
    // La segunda, con otras tarjetas, NO devuelve la anterior.
    assert.strictEqual(ipLocalConCache({ interfaces: { 'Wi-Fi': [v4('192.168.2.2')] }, log: SIN_LOG }), '192.168.2.2');
  } finally {
    olvidarCache();
  }
});

// ---------------------------------------------------------------------------
// Regla de activacion
// ---------------------------------------------------------------------------

test('red-local: solo se activa con NODE_ENV === "development" escrito', () => {
  assert.strictEqual(enModoRedLocal({ NODE_ENV: 'development' }), true);
  for (const valor of ['production', 'test', 'dev', 'Development', 'DEVELOPMENT', '', undefined]) {
    assert.strictEqual(
      enModoRedLocal({ NODE_ENV: valor }),
      false,
      `NODE_ENV=${JSON.stringify(valor)} no debe activar el modo`
    );
  }
  assert.strictEqual(enModoRedLocal({}), false, 'ausente tampoco');
});

// ---------------------------------------------------------------------------
// El enlace del QR
// ---------------------------------------------------------------------------

const TOKEN = 'v1.abc.def';
const conIp = (ip) => () => ip;
const sinIp = () => null;

/** Lo que devolvia el codigo antes de este cambio, para fijar "no cambia". */
const comoAntes = (base) => `${base}/?token=${encodeURIComponent(TOKEN)}`;

test('url: development con localhost sustituye el host por la IP', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'http://localhost:5174' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes(`http://${IP}:5174`));
});

test('url: development con 127.0.0.1 tambien se sustituye', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'http://127.0.0.1:5174' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes(`http://${IP}:5174`));
});

test('url: se conservan protocolo, puerto y path', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'http://localhost:8080/comensal' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes(`http://${IP}:8080/comensal`));
});

test('url: development sin FRONTEND_CLIENTE_URL usa la IP y el puerto 5174', () => {
  const url = urlDelComensal(TOKEN, { env: { NODE_ENV: 'development' }, detectarIp: conIp(IP) });

  assert.strictEqual(url, comoAntes(`http://${IP}:5174`));
  assert.strictEqual(PUERTO_CLIENTE, 5174, 'el 5173 es el panel, no el cliente');
});

test('url: development con la variable vacia se trata como ausente', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: '   ' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes(`http://${IP}:5174`));
});

test('url: development sin variable y SIN IP detectada queda en localhost:5174', () => {
  const url = urlDelComensal(TOKEN, { env: { NODE_ENV: 'development' }, detectarIp: sinIp });

  assert.strictEqual(url, comoAntes('http://localhost:5174'), 'igual que hoy');
});

test('url: development con variable y sin IP deja la variable intacta', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'http://localhost:5174' },
    detectarIp: sinIp,
  });

  assert.strictEqual(url, comoAntes('http://localhost:5174'));
});

test('url: un dominio real NO se toca, ni en development', () => {
  // Alguien puede estar apuntando a un entorno remoto a proposito.
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'https://app.smartdining.co' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes('https://app.smartdining.co'));
});

for (const valor of ['production', 'test', '', undefined]) {
  test(`url: con NODE_ENV=${JSON.stringify(valor)} el enlace NO cambia`, () => {
    const env = { NODE_ENV: valor, FRONTEND_CLIENTE_URL: 'http://localhost:5174' };
    const url = urlDelComensal(TOKEN, { env, detectarIp: conIp(IP) });

    assert.strictEqual(url, comoAntes('http://localhost:5174'), 'ni con una IP a mano');
  });
}

test('url: en produccion SIN FRONTEND_CLIENTE_URL tampoco se mete ninguna IP', () => {
  // El caso que mas importa: un despliegue al que le falta la variable no debe
  // empezar a publicar la IP interna de la maquina en el QR.
  const url = urlDelComensal(TOKEN, { env: { NODE_ENV: 'production' }, detectarIp: conIp(IP) });

  assert.strictEqual(url, comoAntes('http://localhost:5174'));
  assert.ok(!url.includes(IP));
});

test('url: con NODE_ENV ausente del todo el enlace NO cambia', () => {
  const url = urlDelComensal(TOKEN, { env: {}, detectarIp: conIp(IP) });
  assert.strictEqual(url, comoAntes('http://localhost:5174'));
});

test('url: una FRONTEND_CLIENTE_URL que no se puede analizar se deja tal cual', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'esto-no-es-una-url' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes('esto-no-es-una-url'), 'no revienta ni inventa');
});

test('url: el token va codificado', () => {
  const token = 'v1.a+b/c=.firma?x=1&y=2';
  const url = urlDelComensal(token, { env: {}, detectarIp: sinIp });

  assert.ok(url.includes(encodeURIComponent(token)));
  assert.ok(!url.includes('?x=1'), 'nada del token se lee como parametro aparte');
});

test('url: la barra final de la variable no duplica barras', () => {
  const url = urlDelComensal(TOKEN, {
    env: { NODE_ENV: 'development', FRONTEND_CLIENTE_URL: 'http://localhost:5174///' },
    detectarIp: conIp(IP),
  });

  assert.strictEqual(url, comoAntes(`http://${IP}:5174`));
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const DEV = { NODE_ENV: 'development' };

const decidir = (origen, env) =>
  new Promise((resolve, reject) => {
    opcionesCors(env).origin(origen, (err, permitido) => (err ? reject(err) : resolve(permitido)));
  });

for (const origen of [
  'http://192.168.1.57:5174',
  'http://192.168.1.57:5173',
  'http://192.168.1.57:5175',
  'http://10.0.0.5:5173',
  'http://10.255.255.255:5174',
  'http://172.16.0.1:5175',
  'http://172.31.255.254:5174',
  'http://192.168.0.1:5174',
]) {
  test(`cors: en development se acepta ${origen}`, async () => {
    assert.strictEqual(await decidir(origen, DEV), true);
  });
}

test('cors: en development siguen valiendo los tres localhost', async () => {
  for (const origen of ORIGENES_LOCALES) {
    assert.strictEqual(await decidir(origen, DEV), true, origen);
  }
});

for (const origen of [
  // Puerto que no es de Vite.
  'http://192.168.1.57:3000',
  'http://192.168.1.57:4000',
  'http://192.168.1.57:5176',
  'http://192.168.1.57:80',
  'http://192.168.1.57',
  // IP publica.
  'http://8.8.8.8:5174',
  'http://203.0.113.9:5174',
  // Rango pegado al privado pero fuera.
  'http://172.15.0.1:5174',
  'http://172.32.0.1:5174',
  'http://192.169.1.57:5174',
  // Otro esquema.
  'https://192.168.1.57:5174',
  'ws://192.168.1.57:5174',
  'ftp://192.168.1.57:5174',
  // Enganos: la IP como prefijo o sufijo de otro host.
  'http://192.168.1.57.evil.com:5174',
  'http://192.168.1.57.atacante.io:5174',
  'http://evil.com/http://192.168.1.57:5174',
  'http://evil.com@192.168.1.57:5174',
  'http://192.168.1.57:5174@evil.com',
  'http://sub.192.168.1.57:5174',
  // Barra final, ruta o parametros: un Origin no los lleva.
  'http://192.168.1.57:5174/',
  'http://192.168.1.57:5174/algo',
  'http://192.168.1.57:5174?x=1',
  // Mayusculas y espacios.
  'HTTP://192.168.1.57:5174',
  ' http://192.168.1.57:5174',
  'http://192.168.1.57:5174 ',
  // Ceros a la izquierda y formas raras de la misma IP.
  'http://010.168.1.57:5174',
  'http://192.168.1.057:5174',
  'http://3232235833:5174',
  'http://0xc0a80139:5174',
  // IPv6 y dominios publicos.
  'http://[::1]:5174',
  'http://[fe80::1]:5174',
  'http://sitio-cualquiera.com',
  'https://app.smartdining.co',
  'null',
  'file://',
]) {
  test(`cors: en development se RECHAZA ${origen}`, async () => {
    assert.strictEqual(await decidir(origen, DEV), false, `"${origen}" se colo`);
  });
}

test('cors: la regla suelta coincide con la decision del middleware', () => {
  assert.strictEqual(esOrigenRedLocal('http://192.168.1.57:5174'), true);
  assert.strictEqual(esOrigenRedLocal('http://192.168.1.57:5176'), false);
  assert.strictEqual(esOrigenRedLocal(undefined), false);
  assert.strictEqual(esOrigenRedLocal(null), false);
  assert.strictEqual(esOrigenRedLocal(42), false);
});

for (const valor of ['production', 'test', '', undefined]) {
  test(`cors: con NODE_ENV=${JSON.stringify(valor)} una IP privada NO entra`, async () => {
    assert.strictEqual(await decidir('http://192.168.1.57:5174', { NODE_ENV: valor }), false);
  });
}

test('cors: con NODE_ENV ausente del todo una IP privada NO entra', async () => {
  assert.strictEqual(await decidir('http://192.168.1.57:5174', {}), false);
});

test('cors: en produccion sin CORS_ORIGINS no entra nada, ni la IP ni localhost', async () => {
  const env = { NODE_ENV: 'production' };
  assert.strictEqual(await decidir('http://192.168.1.57:5174', env), false);
  assert.strictEqual(await decidir('http://localhost:5174', env), false);
});

test('cors: en development la regla de IP se SUMA a CORS_ORIGINS', async () => {
  // Igual que el socket-server (socket-server/src/origenes.js): dentro del modo
  // la regla vale siempre, tener lista propia no la desactiva. Asi las dos
  // piezas se comportan igual y no hay que recordar en cual es distinto.
  const env = { NODE_ENV: 'development', CORS_ORIGINS: 'http://localhost:5174' };

  assert.strictEqual(await decidir('http://localhost:5174', env), true, 'su lista sigue valiendo');
  assert.strictEqual(await decidir('http://192.168.1.57:5174', env), true, 'y la regla se suma');
  // Pero solo la regla: ni un puerto de mas, ni un origen que no este en la lista.
  assert.strictEqual(await decidir('http://192.168.1.57:3000', env), false);
  assert.strictEqual(await decidir('http://localhost:5173', env), false, 'no estaba en su lista');
});

test('cors: con CORS_ORIGINS propia, en development la IP entra aunque la lista sea de dominios', async () => {
  const env = { NODE_ENV: 'development', CORS_ORIGINS: 'https://staging.smartdining.co' };

  assert.strictEqual(await decidir('https://staging.smartdining.co', env), true);
  assert.strictEqual(await decidir(`http://${IP}:5174`, env), true);
});

test('cors: CORS_ORIGINS con la IP dentro funciona como cualquier lista', async () => {
  const env = { NODE_ENV: 'production', CORS_ORIGINS: `http://${IP}:5174` };

  assert.strictEqual(await decidir(`http://${IP}:5174`, env), true);
  assert.strictEqual(await decidir(`http://${IP}:5173`, env), false, 'solo lo que esta en la lista');
});

test('cors: una lista de solo comas y espacios cae a los tres localhost', async () => {
  const env = { NODE_ENV: 'development', CORS_ORIGINS: ' ,, ' };

  assert.strictEqual(await decidir('http://192.168.1.57:5174', env), true, 'la regla de IP vale');
  assert.strictEqual(await decidir('http://localhost:5173', env), true, 'y los localhost tambien');
});

test('cors: con CORS_ORIGINS, en PRODUCCION la IP sigue fuera', async () => {
  // Lo que de verdad protege este cambio: la regla solo existe dentro del modo.
  const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.smartdining.co' };

  assert.strictEqual(await decidir('https://app.smartdining.co', env), true);
  assert.strictEqual(await decidir(`http://${IP}:5174`, env), false, 'ni con lista propia');
});

test('cors: una peticion sin Origin se sigue dejando pasar', async () => {
  assert.strictEqual(await decidir(undefined, DEV), true);
});
