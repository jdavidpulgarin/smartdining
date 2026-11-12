// HEAD = GET sin cuerpo (UptimeRobot y otros monitores usan HEAD).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const { levantar } = require('./helpers');
const { crearRouter, enviarJson } = require('../src/http');

/**
 * Petición HTTP cruda por TCP. fetch ignora cualquier cuerpo en una respuesta
 * a HEAD, así que no sirve para comprobar que el servidor NO lo envía: aquí se
 * leen los bytes tal cual llegan hasta que el servidor cierra.
 */
function pedirCrudo(url, metodo, ruta) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const s = net.connect(Number(port), hostname === 'localhost' ? '127.0.0.1' : hostname);
    const trozos = [];
    s.on('connect', () => s.write(`${metodo} ${ruta} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`));
    s.on('data', (t) => trozos.push(t));
    s.on('end', () => {
      const texto = Buffer.concat(trozos).toString('latin1');
      const fin = texto.indexOf('\r\n\r\n');
      const [linea, ...cabeceras] = texto.slice(0, fin).split('\r\n');
      resolve({
        status: Number(linea.split(' ')[1]),
        cabeceras: Object.fromEntries(cabeceras.map((c) => {
          const i = c.indexOf(':');
          return [c.slice(0, i).toLowerCase(), c.slice(i + 1).trim()];
        })),
        cuerpo: texto.slice(fin + 4),
      });
    });
    s.on('error', reject);
  });
}

async function servidorCon(rutas) {
  const servidor = http.createServer(crearRouter(rutas, { cerrando: false }));
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${servidor.address().port}`,
    cerrar: () => new Promise((r) => servidor.close(r)),
  };
}

test('router: HEAD usa el handler GET de cualquier ruta y responde sin cuerpo', async () => {
  const llamadas = [];
  const s = await servidorCon({
    'GET /uno': async (req, res) => { llamadas.push(`uno:${req.method}`); enviarJson(res, 200, { a: 1 }); },
    'GET /dos': async (req, res) => { llamadas.push(`dos:${req.method}`); enviarJson(res, 503, { b: 2 }); },
  });
  try {
    const get = await pedirCrudo(s.url, 'GET', '/uno');
    const head = await pedirCrudo(s.url, 'HEAD', '/uno');
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.cabeceras['content-type'], get.cabeceras['content-type']);
    assert.strictEqual(head.cuerpo, '');
    // El GET sí trae el cuerpo (crudo puede venir en chunked: "7\r\n{...}\r\n0\r\n\r\n").
    assert.match(get.cuerpo, /\{"a":1\}/);
    // El status del GET se respeta (no solo 200).
    const dos = await pedirCrudo(s.url, 'HEAD', '/dos?x=1');
    assert.strictEqual(dos.status, 503);
    assert.strictEqual(dos.cuerpo, '');
    assert.deepStrictEqual(llamadas, ['uno:GET', 'uno:HEAD', 'dos:HEAD']);
  } finally {
    await s.cerrar();
  }
});

test('router: HEAD a una ruta solo POST o DELETE da 404 y NO ejecuta el handler', async () => {
  let ejecutados = 0;
  const conEfecto = async (req, res) => { ejecutados += 1; enviarJson(res, 200, { ok: true }); };
  const s = await servidorCon({ 'POST /efecto': conEfecto, 'DELETE /efecto': conEfecto });
  try {
    const r = await pedirCrudo(s.url, 'HEAD', '/efecto');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.cuerpo, '');
    assert.strictEqual(ejecutados, 0);
  } finally {
    await s.cerrar();
  }
});

test('router: una ruta HEAD propia tiene prioridad sobre la de GET', async () => {
  const usados = [];
  const s = await servidorCon({
    'GET /x': async (req, res) => { usados.push('GET'); enviarJson(res, 200, {}); },
    'HEAD /x': async (req, res) => { usados.push('HEAD'); res.writeHead(204); res.end(); },
  });
  try {
    const r = await pedirCrudo(s.url, 'HEAD', '/x');
    assert.strictEqual(r.status, 204);
    assert.deepStrictEqual(usados, ['HEAD']);
  } finally {
    await s.cerrar();
  }
});

test('servidor: HEAD /health 200 sin cuerpo, GET /health sin cambios', async () => {
  const s = await levantar();
  try {
    const head = await pedirCrudo(s.url, 'HEAD', '/health');
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.cuerpo, '');
    assert.match(head.cabeceras['content-type'], /application\/json/);

    const get = await fetch(`${s.url}/health`);
    assert.strictEqual(get.status, 200);
    assert.deepStrictEqual(await get.json(), { estado: 'ok', redis: 'memoria' });
  } finally {
    await s.cerrar();
  }
});

test('servidor: HEAD /pagos/webhook (solo POST) da 404', async () => {
  const s = await levantar();
  try {
    const r = await pedirCrudo(s.url, 'HEAD', '/pagos/webhook');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.cuerpo, '');
  } finally {
    await s.cerrar();
  }
});

test('servidor: HEAD /push/clave-publica responde lo mismo que GET, sin cuerpo', async () => {
  const s = await levantar();
  try {
    const get = await pedirCrudo(s.url, 'GET', '/push/clave-publica');
    const head = await pedirCrudo(s.url, 'HEAD', '/push/clave-publica');
    assert.strictEqual(head.status, get.status);
    assert.notStrictEqual(get.cuerpo, '');
    assert.strictEqual(head.cuerpo, '');
  } finally {
    await s.cerrar();
  }
});
