// Los 6 criterios de aceptación de la propuesta de Roberto sobre el QR de mesa.
// Cada criterio es una prueba, recorriendo el flujo completo de punta a punta.
//
// A diferencia del resto de la suite, aquí el doble de base de datos y el del
// socket-server GUARDAN ESTADO: así una prueba puede abrir la mesa, abrir
// sesión, pedir, liberar y volver a intentar, y cada paso ve lo que dejó el
// anterior. Sigue sin tocar la red ni PostgreSQL.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

const pool = require('../src/config/db');
const app = require('../server');

const URL_SOCKET = 'http://socket-de-prueba:4001';
const CLAVE_INTERNA = 'clave-interna-de-prueba';
const ID_MESA = 5;

/**
 * Levanta el escenario: una mesa, un socket-server que firma y revoca tokens, y
 * el registro de lo que fue pasando. Devuelve helpers para actuar como cada rol.
 */
function instalarEscenario() {
  const queryOriginal = pool.query;
  const connectOriginal = pool.connect;
  const fetchOriginal = globalThis.fetch;
  const envPrevio = { SOCKET_URL: process.env.SOCKET_URL, INTERNAL_API_KEY: process.env.INTERNAL_API_KEY };

  process.env.SOCKET_URL = URL_SOCKET;
  process.env.INTERNAL_API_KEY = CLAVE_INTERNA;

  const estado = {
    mesa: {
      id_mesa: ID_MESA,
      numero: ID_MESA,
      capacidad: 4,
      ubicacion: 'Terraza',
      estado: 'disponible',
      token_qr: null,
    },
    pedidos: [],
    siguienteIdPedido: 1,
    // Tokens que el socket-server emitió (los da por bien firmados) y los que
    // revocó al recibir /internal/mesa-liberada.
    emitidos: new Set(),
    revocados: new Set(),
    avisos: [],
  };

  // ---------------------------- base de datos ----------------------------
  const query = async (sql, params = []) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i.test(sql)) return { rows: [] };

    if (sql.includes('FROM mesas WHERE id_mesa') && sql.includes('token_qr')
        && sql.trim().startsWith('SELECT token_qr')) {
      return { rows: [{ token_qr: estado.mesa.token_qr }] };
    }
    if (sql.includes('FROM mesas WHERE id_mesa')) {
      return { rows: [{ ...estado.mesa }] };
    }
    if (sql.includes('UPDATE mesas SET token_qr = $1')) {
      estado.mesa.token_qr = params[0];
      estado.mesa.estado = 'ocupada';
      return { rows: [{ ...estado.mesa }] };
    }
    if (sql.includes('UPDATE mesas SET estado = $1, token_qr = NULL')) {
      const yaLiberada = estado.mesa.estado === 'disponible' && estado.mesa.token_qr === null;
      estado.mesa.estado = 'disponible';
      estado.mesa.token_qr = null;
      return yaLiberada ? { rows: [] } : { rows: [{ ...estado.mesa }] };
    }

    if (sql.includes('count(*)::int AS n FROM pedidos')) {
      const abiertos = estado.pedidos.filter((p) => !['pagado', 'cancelado'].includes(p.estado));
      return { rows: [{ n: abiertos.length }] };
    }
    if (sql.includes('INSERT INTO pedidos')) {
      const pedido = {
        id_pedido: estado.siguienteIdPedido++,
        id_mesa: params[0],
        codigo_pedido: params[1],
        estado: 'recibido',
        total: 0,
        notas_generales: params[2] ?? null,
      };
      estado.pedidos.push(pedido);
      return { rows: [{ ...pedido }] };
    }
    if (sql.includes('SELECT * FROM pedidos WHERE id_pedido')) {
      const p = estado.pedidos.find((x) => x.id_pedido === Number(params[0]));
      return { rows: p ? [{ ...p, total: 34000 }] : [] };
    }
    if (sql.includes('SELECT estado FROM pedidos WHERE id_pedido')) {
      const p = estado.pedidos.find((x) => x.id_pedido === Number(params[0]));
      return { rows: p ? [{ estado: p.estado }] : [] };
    }
    if (sql.includes('UPDATE pedidos SET estado')) {
      // Dos formas reales: "SET estado = $1 WHERE id_pedido = $2" (cambio de
      // estado) y "SET estado = 'pagado' WHERE id_pedido = $1" (cobro).
      const conEstadoEnParam = sql.includes('SET estado = $1');
      const id = Number(conEstadoEnParam ? params[1] : params[0]);
      const nuevo = conEstadoEnParam ? params[0] : 'pagado';
      const p = estado.pedidos.find((x) => x.id_pedido === id);
      if (!p) return { rows: [] };
      p.estado = nuevo;
      return { rows: [{ ...p }] };
    }
    if (sql.includes('FROM pedidos WHERE id_mesa')) {
      return { rows: estado.pedidos.filter((p) => p.id_mesa === Number(params[0])).map((p) => ({ ...p })) };
    }
    if (sql.includes('INSERT INTO transacciones')) {
      return {
        rows: [{
          id_transaccion: 1,
          id_pedido: params[0],
          metodo_pago: params[1],
          monto: params[2],
          estado_transaccion: params[3],
        }],
      };
    }
    if (sql.includes('FROM detalles_pedido dp')) {
      return { rows: [{ id_detalle: 1, id_plato: 3, cantidad: 1, notas_especiales: 'Ana', plato_nombre: 'Hamburguesa Smart Angus' }] };
    }
    return { rows: [] };
  };

  pool.query = query;
  pool.connect = async () => ({ query, release() {} });

  // --------------------------- socket-server ---------------------------
  globalThis.fetch = async (url, opciones = {}) => {
    if (!String(url).startsWith(URL_SOCKET)) throw new Error(`salida a la red: ${url}`);
    const ruta = String(url).slice(URL_SOCKET.length);
    const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
    estado.avisos.push({ ruta, cuerpo });

    const json = (status, datos) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(datos),
    });

    if (ruta === '/qr/generar') {
      // Mismo formato que socket-server/src/qr.js: v1.<datos>.<firma>
      const ahora = Date.now();
      const datos = { m: cuerpo.id_mesa, iat: ahora, exp: ahora + 6 * 3600 * 1000, sid: crypto.randomBytes(12).toString('base64url') };
      const base = `v1.${Buffer.from(JSON.stringify(datos)).toString('base64url')}`;
      const token = `${base}.${crypto.createHmac('sha256', 'socket').update(base).digest('base64url')}`;
      estado.emitidos.add(token);
      return json(201, { token, id_mesa: cuerpo.id_mesa, emitido_en: datos.iat, expira_en: datos.exp });
    }

    if (ruta === '/qr/validar') {
      const t = cuerpo.token;
      if (!estado.emitidos.has(t)) return json(401, { valido: false, motivo: 'firma' });
      if (estado.revocados.has(t)) return json(401, { valido: false, motivo: 'revocado' });
      return json(200, { valido: true, id_mesa: ID_MESA, expira_en: Date.now() + 3600000 });
    }

    if (ruta === '/internal/mesa-liberada') {
      // Igual que ctx.liberarMesa del socket-server: revoca los QR de la mesa.
      for (const t of estado.emitidos) estado.revocados.add(t);
      return json(200, { ok: true });
    }

    return json(200, { ok: true });
  };

  // ------------------------------ helpers ------------------------------
  const jwtStaff = (rol) => jwt.sign({ id_usuario: 3, rol }, process.env.JWT_SECRET, { expiresIn: '1h' });

  return {
    estado,
    jwtMesero: jwtStaff('mesero'),
    jwtCajero: jwtStaff('cajero'),

    abrirMesa: () =>
      request(app).post(`/api/mesas/${ID_MESA}/abrir`).set('Authorization', `Bearer ${jwtStaff('mesero')}`),

    liberarMesa: () =>
      request(app).post(`/api/mesas/${ID_MESA}/liberar`).set('Authorization', `Bearer ${jwtStaff('mesero')}`),

    abrirSesion: (token) => request(app).post(`/api/mesas/qr/${encodeURIComponent(token)}/sesion`),

    crearPedido: (jwtComensal, apodo = 'Ana') =>
      request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${jwtComensal}`)
        .send({ items: [{ id_plato: 3, cantidad: 1, apodo }] }),

    verPedidosDeLaMesa: (jwtComensal) =>
      request(app).get('/api/pedidos/mesa').set('Authorization', `Bearer ${jwtComensal}`),

    avisos: (ruta) => estado.avisos.filter((a) => a.ruta === ruta),

    restaurar() {
      pool.query = queryOriginal;
      pool.connect = connectOriginal;
      globalThis.fetch = fetchOriginal;
      for (const [k, v] of Object.entries(envPrevio)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

// ===========================================================================
// Criterio 1
// ===========================================================================

test('CA1: el QR generado desde la tablet permite abrir sesión y hacer un pedido', async () => {
  const e = instalarEscenario();
  try {
    const abierta = await e.abrirMesa();
    assert.strictEqual(abierta.status, 201);
    assert.ok(abierta.body.token, 'la tablet recibe el token del QR');
    assert.ok(abierta.body.url.includes(encodeURIComponent(abierta.body.token)), 'y la url para mostrarlo');
    assert.strictEqual(e.estado.mesa.estado, 'ocupada');

    const sesion = await e.abrirSesion(abierta.body.token);
    assert.strictEqual(sesion.status, 201, 'el QR abre sesión');

    const pedido = await e.crearPedido(sesion.body.token);
    assert.strictEqual(pedido.status, 201, 'y con esa sesión se puede pedir');
    assert.strictEqual(pedido.body.id_mesa, ID_MESA);

    // La comanda salió al KDS por el socket-server.
    assert.strictEqual(e.avisos('/internal/order-created').length, 1);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Criterio 2
// ===========================================================================

test('CA2: varios comensales pueden escanear el mismo QR dentro de la misma sesión', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();

    // Tres personas de la mesa escanean el MISMO QR impreso.
    const sesiones = [];
    for (const quien of ['Ana', 'Pipe', 'Sofi']) {
      const s = await e.abrirSesion(mesa.token);
      assert.strictEqual(s.status, 201, `${quien} debe poder escanear el mismo QR`);
      sesiones.push({ quien, jwt: s.body.token });
    }

    // Todos comparten la misma mesa y el mismo sid: es una sola sesión de mesa.
    const payloads = sesiones.map((s) => jwt.verify(s.jwt, process.env.JWT_SECRET));
    assert.deepStrictEqual([...new Set(payloads.map((p) => p.id_mesa))], [ID_MESA]);
    assert.strictEqual(new Set(payloads.map((p) => p.sid)).size, 1, 'un solo sid: la misma sesión');

    // Y cada uno puede pedir por su cuenta, con su apodo.
    for (const s of sesiones) {
      const pedido = await e.crearPedido(s.jwt, s.quien);
      assert.strictEqual(pedido.status, 201, `${s.quien} debe poder pedir`);
    }
    assert.strictEqual(e.estado.pedidos.length, 3);

    // Y todos ven los pedidos de la mesa (carrito/cuenta compartida).
    const vista = await e.verPedidosDeLaMesa(sesiones[0].jwt);
    assert.strictEqual(vista.status, 200);
    assert.strictEqual(vista.body.pedidos.length, 3);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Criterio 3
// ===========================================================================

test('CA3: después de liberar la mesa, ese mismo QR da error al abrir sesión', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();
    const qrImpreso = mesa.token;

    // Antes de liberar, ese QR sirve.
    assert.strictEqual((await e.abrirSesion(qrImpreso)).status, 201);

    const liberada = await e.liberarMesa();
    assert.strictEqual(liberada.status, 200);
    assert.strictEqual(e.estado.mesa.token_qr, null);

    // El MISMO QR ya no abre sesión.
    const reintento = await e.abrirSesion(qrImpreso);
    assert.strictEqual(reintento.status, 401);
    assert.strictEqual(reintento.body.token, undefined, 'no se emite ningún JWT');
    // El socket-server lo revocó al recibir /internal/mesa-liberada.
    assert.strictEqual(reintento.body.motivo, 'revocado');
  } finally {
    e.restaurar();
  }
});

test('CA3 (defensa en profundidad): aunque el socket-server no revoque, el backend rechaza el QR viejo', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();
    const qrImpreso = mesa.token;

    // Se libera la mesa SIN que el socket-server llegue a revocar nada (aviso
    // perdido): el token sigue bien firmado y vigente para él.
    await e.liberarMesa();
    e.estado.revocados.clear();

    const reintento = await e.abrirSesion(qrImpreso);
    assert.strictEqual(reintento.status, 401, 'la columna en NULL basta para rechazarlo');
    assert.strictEqual(reintento.body.motivo, 'mesa_sin_sesion');
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Criterio 4
// ===========================================================================

test('CA4: después de liberar la mesa, un JWT de la sesión anterior no puede crear pedidos (401)', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();
    const sesion = await e.abrirSesion(mesa.token);
    const jwtViejo = sesion.body.token;

    // Con la mesa abierta, ese JWT pide sin problema.
    assert.strictEqual((await e.crearPedido(jwtViejo)).status, 201);
    const pedidosAntes = e.estado.pedidos.length;

    await e.liberarMesa();

    const intento = await e.crearPedido(jwtViejo);
    assert.strictEqual(intento.status, 401);
    assert.match(intento.body.error, /Sesión de mesa cerrada/);
    assert.strictEqual(e.estado.pedidos.length, pedidosAntes, 'no se creó ningún pedido');

    // Tampoco puede consultar la mesa.
    assert.strictEqual((await e.verPedidosDeLaMesa(jwtViejo)).status, 401);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Criterio 5
// ===========================================================================

test('CA5: el siguiente grupo recibe un QR nuevo que funciona con normalidad', async () => {
  const e = instalarEscenario();
  try {
    // Grupo 1: abre, pide y se va (la mesa se libera).
    const primera = await e.abrirMesa();
    const sesion1 = await e.abrirSesion(primera.body.token);
    await e.crearPedido(sesion1.body.token, 'Ana');
    await e.liberarMesa();

    // Grupo 2: el mesero vuelve a abrir la mesa.
    const segunda = await e.abrirMesa();
    assert.strictEqual(segunda.status, 201);
    assert.notStrictEqual(segunda.body.token, primera.body.token, 'el QR debe ser nuevo');
    assert.strictEqual(segunda.body.reutilizado, false);

    const sesion2 = await e.abrirSesion(segunda.body.token);
    assert.strictEqual(sesion2.status, 201, 'el QR nuevo abre sesión con normalidad');

    const p1 = jwt.verify(sesion1.body.token, process.env.JWT_SECRET);
    const p2 = jwt.verify(sesion2.body.token, process.env.JWT_SECRET);
    assert.notStrictEqual(p2.sid, p1.sid, 'es otra sesión de mesa');

    const pedido = await e.crearPedido(sesion2.body.token, 'Carlos');
    assert.strictEqual(pedido.status, 201, 'y el grupo nuevo puede pedir');

    // Y el JWT del grupo anterior sigue sin servir.
    assert.strictEqual((await e.crearPedido(sesion1.body.token)).status, 401);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Criterio 6
// ===========================================================================

test('CA6: un grupo que se va sin pedir queda cerrado con "Liberar mesa"', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();
    const sesion = await e.abrirSesion(mesa.token);
    assert.strictEqual(e.estado.mesa.estado, 'ocupada');
    assert.strictEqual(e.estado.pedidos.length, 0, 'el grupo no pidió nada');

    // No hay pedidos que cerrar, así que nada la libera automáticamente:
    // el mesero la cierra a mano.
    const liberada = await e.liberarMesa();
    assert.strictEqual(liberada.status, 200);
    assert.strictEqual(liberada.body.estado, 'disponible');
    assert.strictEqual(liberada.body.token_qr, null);
    assert.strictEqual(e.estado.mesa.estado, 'disponible');

    // Se avisó al socket-server para que limpie carrito y suscripciones.
    assert.strictEqual(e.avisos('/internal/mesa-liberada').length, 1);

    // Y la sesión que había quedado abierta ya no vale.
    assert.strictEqual((await e.verPedidosDeLaMesa(sesion.body.token)).status, 401);

    // La mesa queda lista para el grupo siguiente.
    const siguiente = await e.abrirMesa();
    assert.strictEqual(siguiente.status, 201);
    assert.notStrictEqual(siguiente.body.token, mesa.token);
  } finally {
    e.restaurar();
  }
});

// ===========================================================================
// Cierre automático: el equivalente de CA6 cuando sí hubo pedidos
// ===========================================================================

test('si el grupo pidió y pagó, la mesa se cierra sola sin pulsar "Liberar mesa"', async () => {
  const e = instalarEscenario();
  try {
    const { body: mesa } = await e.abrirMesa();
    const sesion = await e.abrirSesion(mesa.token);
    const pedido = await e.crearPedido(sesion.body.token);

    // recibido -> en_preparacion -> listo -> entregado -> pagado
    const id = pedido.body.id_pedido;
    for (const estado of ['en_preparacion', 'listo', 'entregado']) {
      const r = await request(app)
        .patch(`/api/pedidos/${id}/estado`)
        .set('Authorization', `Bearer ${e.jwtMesero}`)
        .send({ estado });
      assert.strictEqual(r.status, 200, `debe pasar a ${estado}`);
    }

    const cobro = await request(app)
      .post('/api/transacciones')
      .set('Authorization', `Bearer ${e.jwtCajero}`)
      .send({ id_pedido: id, monto: 34000, metodo_pago: 'efectivo' });
    assert.strictEqual(cobro.status, 201);

    assert.strictEqual(e.estado.mesa.estado, 'disponible', 'la mesa se liberó sola');
    assert.strictEqual(e.estado.mesa.token_qr, null);
    assert.strictEqual(e.avisos('/internal/mesa-liberada').length, 1);
    assert.strictEqual((await e.crearPedido(sesion.body.token)).status, 401);
  } finally {
    e.restaurar();
  }
});
